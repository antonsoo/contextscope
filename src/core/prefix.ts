import type { DiffLine, ParsedRequest, PrefixMatch, Segment } from "./types.js";
import { stripVolatilePatterns } from "./volatile.js";
import { canonicalBlockJson } from "./json-utils.js";

// The optimized scenario compares each segment as if it were fixed: timestamps/UUIDs redacted and
// JSON keys sorted. That runs four regexes and a deep key sort per segment, and in a growing
// conversation every segment is compared against its counterpart in both neighbouring requests.
// Segments are immutable once parsed, so the normalized form is computed once per segment object.
const normalizedText = new WeakMap<Segment, string>();

/** category + text, or - normalized - category + deterministic, volatile-free content. */
function segmentKey(segment: Segment, normalizeVolatile: boolean): string {
  if (!normalizeVolatile) return `${segment.category}::${segment.text}`;
  let text = normalizedText.get(segment);
  if (text === undefined) {
    const content = segment.raw !== null && typeof segment.raw === "object" ? canonicalBlockJson(segment.raw) : segment.text;
    text = stripVolatilePatterns(content);
    normalizedText.set(segment, text);
  }
  return `${segment.category}::${text}`;
}

function sameSegment(a: Segment, b: Segment, normalizeVolatile: boolean): boolean {
  if (a.category !== b.category) return false;
  if (!normalizeVolatile) return a.text === b.text;
  return segmentKey(a, true) === segmentKey(b, true);
}

/** Normalized mode also sorts the leading tool definitions, as a deterministic tool list would be. */
function inCanonicalOrder(segments: Segment[]): Segment[] {
  let toolCount = 0;
  while (toolCount < segments.length && segments[toolCount]!.category === "tools") toolCount++;
  if (toolCount < 2) return segments;
  const tools = segments.slice(0, toolCount).sort((x, y) => {
    const kx = segmentKey(x, true);
    const ky = segmentKey(y, true);
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
  return [...tools, ...segments.slice(toolCount)];
}

/** Length of the longest run of leading segments that are identical (by category + text) in both requests. */
function commonPrefixLength(a: Segment[], b: Segment[], normalizeVolatile: boolean): number {
  const left = normalizeVolatile ? inCanonicalOrder(a) : a;
  const right = normalizeVolatile ? inCanonicalOrder(b) : b;
  const n = Math.min(left.length, right.length);
  let i = 0;
  while (i < n && sameSegment(left[i]!, right[i]!, normalizeVolatile)) i++;
  return i;
}

type DiffOp = { type: DiffLine["type"]; segment: Segment };

// Beyond this many edits between two consecutive requests a line-by-line diff stops being readable
// anyway (the requests are essentially unrelated), so the diff degrades to "old removed, new added".
const MAX_EDIT_DISTANCE = 2000;

/**
 * Segment-level diff between two requests - what powers the "readable diff of
 * what changed" view. It aligns matching segments anywhere, not just in the
 * shared prefix, so a reordered tool or one edited system block shows up as a
 * small, localized change rather than "everything after position 3 differs".
 *
 * Myers' O((N+M)·D) algorithm (E. W. Myers, "An O(ND) Difference Algorithm
 * and Its Variations", Algorithmica 1, 1986) finds a shortest edit script,
 * i.e. its unchanged lines form a longest common subsequence. D, the number
 * of edits, is what matters: consecutive requests in an agent loop differ by a
 * handful of appended turns and perhaps one changed block, so a 3,000-segment
 * pair costs a few thousand steps instead of the nine million cells a classic
 * LCS table would.
 */
function diffSegments(a: Segment[], b: Segment[]): DiffOp[] {
  // Intern each distinct (category, text) to a small integer so comparisons are integer compares.
  const ids = new Map<string, Map<string, number>>();
  let nextId = 0;
  const intern = (s: Segment): number => {
    let byText = ids.get(s.category);
    if (byText === undefined) {
      byText = new Map();
      ids.set(s.category, byText);
    }
    let id = byText.get(s.text);
    if (id === undefined) {
      id = nextId++;
      byText.set(s.text, id);
    }
    return id;
  };
  const keysA = a.map(intern);
  const keysB = b.map(intern);

  const script = myers(keysA, keysB, MAX_EDIT_DISTANCE);
  if (script) return script.map(([type, index]) => ({ type, segment: type === "remove" ? a[index]! : b[index]! }));

  const ops: DiffOp[] = [];
  let head = 0;
  while (head < a.length && head < b.length && keysA[head] === keysB[head]) ops.push({ type: "context", segment: b[head++]! });
  for (let i = head; i < a.length; i++) ops.push({ type: "remove", segment: a[i]! });
  for (let j = head; j < b.length; j++) ops.push({ type: "add", segment: b[j]! });
  return ops;
}

/**
 * Shortest edit script from `a` to `b` as [op, index] pairs (index into `a` for
 * removals, into `b` otherwise), or undefined if it needs more than `maxD` edits.
 * The per-step snapshots only cover diagonals -d..d, so memory is O(D²).
 */
function myers(a: number[], b: number[], maxD: number): [DiffLine["type"], number][] | undefined {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  const limit = Math.min(max, maxD);

  for (let d = 0; d <= limit; d++) {
    // Snapshot of diagonals -(d+1)..(d+1) before this step; backtracking reads k±1 from it.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      let x = down ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return undefined;
}

function backtrack(trace: Int32Array[], n: number, m: number): [DiffLine["type"], number][] {
  const out: [DiffLine["type"], number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d]!;
    const at = (k: number): number => snap[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push(["context", --y]);
      x--;
    }
    if (d > 0) {
      if (x === prevX) out.push(["add", --y]);
      else out.push(["remove", --x]);
    }
  }
  return out.reverse();
}

function describeSegment(segment: Segment): string {
  const preview = segment.text.length > 80 ? `${segment.text.slice(0, 80)}…` : segment.text;
  return `[${segment.category}] ${segment.label} — ${preview.replace(/\s+/g, " ")}`;
}

/** Keeps context lines within `radius` of a change, like a unified diff, and renders only what is kept. */
function withContext(ops: DiffOp[], radius = 2): DiffLine[] {
  const render = (op: DiffOp): DiffLine => ({ type: op.type, text: describeSegment(op.segment) });
  if (ops.length <= 60) return ops.map(render); // small requests: show everything, no need to trim
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type !== "context") {
      for (let k = Math.max(0, idx - radius); k <= Math.min(ops.length - 1, idx + radius); k++) keep[k] = true;
    }
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  ops.forEach((op, idx) => {
    if (keep[idx]) {
      if (skipped > 0) {
        out.push({ type: "context", text: `⋯ ${skipped} unchanged segment${skipped === 1 ? "" : "s"} ⋯` });
        skipped = 0;
      }
      out.push(render(op));
    } else {
      skipped++;
    }
  });
  if (skipped > 0) out.push({ type: "context", text: `⋯ ${skipped} unchanged segment${skipped === 1 ? "" : "s"} ⋯` });
  return out;
}

/** `withDiff: false` skips the display diff - the optimized (volatile-normalized) scenario only needs the match length. */
export function computePrefixMatch(from: ParsedRequest, to: ParsedRequest, normalizeVolatile = false, withDiff = true): PrefixMatch {
  const matchedSegments = commonPrefixLength(from.segments, to.segments, normalizeVolatile);
  const matchedTo = to.segments.slice(0, matchedSegments);
  const matchedOpenaiTokens = matchedTo.reduce((sum, s) => sum + s.openaiTokens, 0);
  const matchedClaudeTokensEstimate = matchedTo.reduce((sum, s) => sum + s.claudeTokensEstimate, 0);

  const fromDiverged = from.segments[matchedSegments];
  const toDiverged = to.segments[matchedSegments];
  const divergedAt =
    matchedSegments < from.segments.length || matchedSegments < to.segments.length
      ? { fromSegmentId: fromDiverged?.id, toSegmentId: toDiverged?.id }
      : undefined;

  const diff = withDiff ? withContext(diffSegments(from.segments, to.segments)) : [];

  return {
    fromIndex: from.index,
    toIndex: to.index,
    matchedSegments,
    matchedOpenaiTokens,
    matchedClaudeTokensEstimate,
    divergedAt,
    diff,
  };
}

export function computeAllPrefixMatches(requests: ParsedRequest[], normalizeVolatile = false, withDiff = true): PrefixMatch[] {
  const out: PrefixMatch[] = [];
  for (let i = 1; i < requests.length; i++) {
    out.push(computePrefixMatch(requests[i - 1]!, requests[i]!, normalizeVolatile, withDiff));
  }
  return out;
}
