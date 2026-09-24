import type { DiffLine, ParsedRequest, PrefixMatch, Segment } from "./types.js";
import { stripVolatilePatterns } from "./volatile.js";

/** category + text (optionally with timestamps/UUIDs redacted), used as the equality key for the prefix scan and the LCS diff. */
function segmentKey(segment: Segment, normalizeVolatile: boolean): string {
  const text = normalizeVolatile ? stripVolatilePatterns(segment.text) : segment.text;
  return `${segment.category}::${text}`;
}

/** Length of the longest run of leading segments that are identical (by category + text) in both requests. */
function commonPrefixLength(a: Segment[], b: Segment[], normalizeVolatile: boolean): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && segmentKey(a[i]!, normalizeVolatile) === segmentKey(b[i]!, normalizeVolatile)) i++;
  return i;
}

/**
 * Classic O(n*m) LCS-based diff over two segment lists, at segment
 * granularity. This is what powers the "readable diff of what changed"
 * view - it finds matched segments anywhere (not just the shared prefix),
 * so a reordered tool or a single edited system block shows up as a small,
 * localized change rather than "everything after position 3 differs".
 */
function diffSegments(a: Segment[], b: Segment[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const keysA = a.map((s) => segmentKey(s, false));
  const keysB = b.map((s) => segmentKey(s, false));

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = keysA[i] === keysB[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (keysA[i] === keysB[j]) {
      lines.push({ type: "context", text: describeSegment(b[j]!) });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push({ type: "remove", text: describeSegment(a[i]!) });
      i++;
    } else {
      lines.push({ type: "add", text: describeSegment(b[j]!) });
      j++;
    }
  }
  while (i < n) {
    lines.push({ type: "remove", text: describeSegment(a[i]!) });
    i++;
  }
  while (j < m) {
    lines.push({ type: "add", text: describeSegment(b[j]!) });
    j++;
  }
  return lines;
}

function describeSegment(segment: Segment): string {
  const preview = segment.text.length > 80 ? `${segment.text.slice(0, 80)}…` : segment.text;
  return `[${segment.category}] ${segment.label} — ${preview.replace(/\s+/g, " ")}`;
}

/** Trims a full segment-level diff down to context lines within `radius` of a change, like unified diff. */
function withContext(lines: DiffLine[], radius = 2): DiffLine[] {
  if (lines.length <= 60) return lines; // small requests: show everything, no need to trim
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, idx) => {
    if (line.type !== "context") {
      for (let k = Math.max(0, idx - radius); k <= Math.min(lines.length - 1, idx + radius); k++) keep[k] = true;
    }
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, idx) => {
    if (keep[idx]) {
      if (skipped > 0) {
        out.push({ type: "context", text: `⋯ ${skipped} unchanged segment${skipped === 1 ? "" : "s"} ⋯` });
        skipped = 0;
      }
      out.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) out.push({ type: "context", text: `⋯ ${skipped} unchanged segment${skipped === 1 ? "" : "s"} ⋯` });
  return out;
}

export function computePrefixMatch(from: ParsedRequest, to: ParsedRequest, normalizeVolatile = false): PrefixMatch {
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

  const diff = withContext(diffSegments(from.segments, to.segments));

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

export function computeAllPrefixMatches(requests: ParsedRequest[], normalizeVolatile = false): PrefixMatch[] {
  const out: PrefixMatch[] = [];
  for (let i = 1; i < requests.length; i++) {
    out.push(computePrefixMatch(requests[i - 1]!, requests[i]!, normalizeVolatile));
  }
  return out;
}
