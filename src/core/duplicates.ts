import type { DuplicateGroup, ParsedRequest, SegmentCategory } from "./types.js";
import { fnv1a } from "./json-utils.js";

const SHINGLE_SIZE = 5;
const MIN_CHARS = 200;
const SIMILARITY_THRESHOLD = 0.85;
const ELIGIBLE_CATEGORIES: ReadonlySet<SegmentCategory> = new Set(["tool_result", "user", "assistant", "system"]);

function shingles(text: string): Set<string> {
  const words = text.trim().split(/\s+/);
  if (words.length < SHINGLE_SIZE) return new Set([words.join(" ")]);
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= words.length; i++) set.add(words.slice(i, i + SHINGLE_SIZE).join(" "));
  return set;
}

function similarity(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  // Even complete containment cannot meet the threshold in this case.
  if (small.size < SIMILARITY_THRESHOLD * large.size) return 0;
  let intersection = 0;
  for (const value of small) if (large.has(value)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

type Member = DuplicateGroup["members"][number] & { ordinal: number };
interface Content {
  id: number;
  shingles: Set<string>;
  members: Member[];
}
interface Cluster {
  contents: Content[];
  minimum: number;
}

/** Necessary-match filter, not an approximate similarity score. */
class ClusterCandidates {
  private readonly frequency = new Map<string, number>();
  private readonly postings = new Map<string, number[]>();

  constructor(contents: Iterable<Content>) {
    for (const content of contents) for (const gram of content.shingles) {
      this.frequency.set(gram, (this.frequency.get(gram) ?? 0) + 1);
    }
  }

  prefix(grams: Set<string>): string[] {
    // One total order for this request; rare shingles first keep common prose
    // out of the index where possible. Lexical ties must NOT use per-text order.
    const sorted = [...grams].sort((a, b) =>
      this.frequency.get(a)! - this.frequency.get(b)! || (a < b ? -1 : a > b ? 1 : 0));
    // A matching pair must share a prefix shingle: otherwise its first shared
    // shingle is past one prefix, leaving too few shared elements for Jaccard
    // >= t. floor (rather than ceil) keeps an extra element at nonintegral
    // thresholds, conservatively avoiding floating-point boundary exclusions.
    return sorted.slice(0, grams.size - Math.floor(SIMILARITY_THRESHOLD * grams.size) + 1);
  }

  candidates(prefix: string[], clusters: Cluster[]): Cluster[] {
    const ids = new Set<number>();
    for (const gram of prefix) for (const id of this.postings.get(gram) ?? []) ids.add(id);
    // Preserve the first-compatible-cluster rule, independently of index order.
    return [...ids].sort((a, b) => a - b).map(id => clusters[id]!);
  }

  add(prefix: string[], clusterId: number): void {
    // Only index the first content of each cluster. Joining a complete-link
    // cluster necessarily requires matching that representative; every member
    // is still checked below before accepting the candidate.
    for (const gram of prefix) {
      const ids = this.postings.get(gram);
      if (ids) ids.push(clusterId);
      else this.postings.set(gram, [clusterId]);
    }
  }
}

/**
 * Inspect terminal requests of conversations, not copies of their shared history.
 * Groups are a deterministic, greedy complete-link partition: every pair must
 * meet the threshold. Similarity is not transitive; an A-B-C edit chain cannot
 * establish that A and C are interchangeable. The partition is conservative and
 * order-dependent, and need not enumerate every qualifying pair.
 *
 * Equal text is pooled before shingling/comparison. Actual strings establish
 * identity; a short hash is only a display-independent debugging signature.
 */
export function findDuplicates(requests: ParsedRequest[], within: number[] = requests.length > 0 ? [requests.length - 1] : []): DuplicateGroup[] {
  const out: DuplicateGroup[] = [];
  const textIds = new Map<string, number>();
  const identify = (text: string): number => {
    let id = textIds.get(text);
    if (id === undefined) { id = textIds.size; textIds.set(text, id); }
    return id;
  };
  // The same content in the same positions of separate conversations is one finding.
  const seen = new Set<string>();
  for (const index of [...within].sort((a, b) => a - b)) {
    const request = requests[index];
    if (!request) continue;
    const unique = new Map<number, Content>();
    request.segments.forEach((segment, ordinal) => {
      if (!ELIGIBLE_CATEGORIES.has(segment.category) || segment.charLength < MIN_CHARS) return;
      const id = identify(segment.text);
      let content = unique.get(id);
      if (!content) {
        content = { id, shingles: shingles(segment.text), members: [] };
        unique.set(id, content);
      }
      content.members.push({ requestIndex: request.index, segmentId: segment.id, label: segment.label, tokens: segment.claudeTokensEstimate, ordinal });
    });

    const clusters: Cluster[] = [];
    // Small histories don't warrant building and sorting an index.
    const candidateIndex = unique.size >= 64 ? new ClusterCandidates(unique.values()) : undefined;
    for (const content of unique.values()) {
      const prefix = candidateIndex?.prefix(content.shingles);
      const candidates = prefix ? candidateIndex!.candidates(prefix, clusters) : clusters;
      let joined = false;
      for (const cluster of candidates) {
        let minimum = cluster.minimum;
        const compatible = cluster.contents.every((other) => {
          const score = similarity(content.shingles, other.shingles);
          minimum = Math.min(minimum, score);
          return score >= SIMILARITY_THRESHOLD;
        });
        if (!compatible) continue;
        cluster.contents.push(content);
        cluster.minimum = minimum;
        joined = true;
        break;
      }
      if (!joined) {
        if (prefix) candidateIndex!.add(prefix, clusters.length);
        clusters.push({ contents: [content], minimum: 1 });
      }
    }

    for (const cluster of clusters) {
      const members = cluster.contents.flatMap((content) => content.members).sort((a, b) => a.ordinal - b.ordinal);
      if (members.length < 2) continue;
      const identity = JSON.stringify(cluster.contents.flatMap((content) => content.members.map((m) => [m.segmentId, content.id])).sort());
      if (seen.has(identity)) continue;
      seen.add(identity);
      out.push({
        signature: fnv1a(members.map((m) => m.segmentId).sort().join("|")),
        members: members.map((m) => ({ requestIndex: m.requestIndex, segmentId: m.segmentId, label: m.label, tokens: m.tokens })),
        matchKind: cluster.contents.length === 1 ? "exact" : "near",
        similarity: cluster.minimum,
        estimatedReviewTokens: members.slice(1).reduce((sum, member) => sum + member.tokens, 0),
      });
    }
  }
  return out.sort((a, b) => b.estimatedReviewTokens - a.estimatedReviewTokens);
}
