import type { DuplicateGroup, ParsedRequest, SegmentCategory } from "./types.js";
import { fnv1a } from "./json-utils.js";

const SHINGLE_SIZE = 5; // words
const MIN_CHARS = 200; // ignore short segments - near-duplicate detection on them is noisy and low-value
const SIMILARITY_THRESHOLD = 0.85;
const ELIGIBLE_CATEGORIES: ReadonlySet<SegmentCategory> = new Set(["tool_result", "user", "assistant", "system"]);

function shingles(text: string): Set<string> {
  const words = text.trim().split(/\s+/);
  const set = new Set<string>();
  if (words.length < SHINGLE_SIZE) {
    set.add(fnv1a(words.join(" ")));
    return set;
  }
  for (let i = 0; i + SHINGLE_SIZE <= words.length; i++) {
    set.add(fnv1a(words.slice(i, i + SHINGLE_SIZE).join(" ")));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Finds duplicate and near-duplicate content, via 5-word shingling and
 * Jaccard similarity (a lighter-weight stand-in for MinHash; at the scale of
 * one agent session - dozens to a few hundred eligible segments - exact
 * pairwise comparison is fast enough and avoids MinHash's own approximation
 * error).
 *
 * Scoped to one request at a time, not pooled across the sequence. In the
 * agentic-loop shape this tool targets, each later request resends the full
 * conversation so far - comparing across requests would "detect" every
 * earlier turn as a duplicate of itself in every later request, which is
 * just how the API works, not a bug. The last request of a conversation
 * already contains the full accumulated context, so scanning it alone still
 * catches the real case this is for: the same file/output fetched more than
 * once *within* one conversation.
 *
 * `within` names the requests to scan: the last request of each
 * conversation in the file (see threads.ts), or by default the last request
 * of the file, which is the same thing when the file is one conversation.
 */
export function findDuplicates(requests: ParsedRequest[], within: number[] = requests.length > 0 ? [requests.length - 1] : []): DuplicateGroup[] {
  const out: DuplicateGroup[] = [];
  // The same repeated content in the same places of many conversations (a system prompt that
  // quotes a document twice, sent by every one of them) is one finding, reported where it first appears.
  const seen = new Set<string>();
  for (const index of [...within].sort((a, b) => a - b)) {
    const request = requests[index];
    if (!request) continue;
    for (const { group, content } of duplicatesIn(request)) {
      if (seen.has(content)) continue;
      seen.add(content);
      out.push(group);
    }
  }
  return out.sort((a, b) => b.estimatedWastedTokens - a.estimatedWastedTokens);
}

function duplicatesIn(request: ParsedRequest): { group: DuplicateGroup; content: string }[] {
  const items: { requestIndex: number; segmentId: string; label: string; tokens: number; shingleSet: Set<string>; textHash: string }[] = [];
  for (const segment of request.segments) {
    if (!ELIGIBLE_CATEGORIES.has(segment.category)) continue;
    if (segment.charLength < MIN_CHARS) continue;
    items.push({
      requestIndex: request.index,
      segmentId: segment.id,
      label: segment.label,
      tokens: segment.claudeTokensEstimate,
      shingleSet: shingles(segment.text),
      textHash: fnv1a(segment.text),
    });
  }

  const parent = items.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const pairSimilarities = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const sim = jaccard(items[i]!.shingleSet, items[j]!.shingleSet);
      if (sim >= SIMILARITY_THRESHOLD) {
        union(i, j);
        pairSimilarities.set(`${i}:${j}`, sim);
      }
    }
  }

  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  });

  const out: { group: DuplicateGroup; content: string }[] = [];
  for (const memberIdxs of groups.values()) {
    if (memberIdxs.length < 2) continue;
    const members = memberIdxs.map((i) => items[i]!);
    let minSim = 1;
    for (const [key, sim] of pairSimilarities) {
      const [a, b] = key.split(":").map(Number);
      if (memberIdxs.includes(a!) && memberIdxs.includes(b!)) minSim = Math.min(minSim, sim);
    }
    const tokensPerCopy = Math.round(members.reduce((s, m) => s + m.tokens, 0) / members.length);
    out.push({
      group: {
        signature: fnv1a(members.map((m) => m.segmentId).sort().join("|")),
        members: members.map((m) => ({ requestIndex: m.requestIndex, segmentId: m.segmentId, label: m.label, tokens: m.tokens })),
        similarity: minSim,
        estimatedWastedTokens: tokensPerCopy * (members.length - 1),
      },
      content: members.map((m) => `${m.segmentId}=${m.textHash}`).sort().join("|"),
    });
  }

  return out;
}
