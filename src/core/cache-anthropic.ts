import type { CacheSimStep, CacheTtl, ParsedRequest, PrefixMatch, Segment } from "./types.js";
import { ANTHROPIC_CACHE_WRITE_MULTIPLIER_1H, ANTHROPIC_CACHE_WRITE_MULTIPLIER_5M, ANTHROPIC_LOOKBACK_POSITIONS, findAnthropicModel } from "./pricing.js";

/**
 * Simulates Anthropic prompt caching across a sequence of requests.
 *
 * Model (documented simplification - see README "How it works"): each
 * request's `cache_control` breakpoints (up to 4, taken in ascending
 * position order) are checked against the previous request's breakpoints.
 * A breakpoint reads from cache when (a) its cumulative prefix is
 * byte-identical to the previous request's up to that point (from the
 * segment-level prefix match), (b) the previous request wrote a cache entry
 * at or before that point, and (c) the position distance from the matched
 * prefix boundary to this breakpoint is within the 20-position lookback
 * window (consecutive tool_use / tool_result runs collapse to one position
 * each, per Anthropic's documented rule). Anything past the last valid
 * breakpoint's coverage, or below the model's minimum cacheable length, is
 * billed as plain uncached input. This does not model true TTL expiry
 * (5-minute / 1-hour wall-clock windows) since request JSON carries no
 * timestamps - it assumes consecutive requests in a session arrive inside
 * the TTL, which is the steady-agent-loop case the tool is built to catch.
 */

interface BreakpointState {
  segmentIndex: number;
  cumulativeTokens: number;
  ttl: CacheTtl;
}

/** Groups segments into "positions": a run of consecutive tool_call segments, or of consecutive
 * tool_result segments, collapses to one position (Anthropic's 20-block lookback rule). Returns,
 * for each segment index, its 0-based position index. */
function positionIndexBySegment(segments: Segment[]): number[] {
  const out: number[] = [];
  let position = -1;
  let runCategory: "tool_call" | "tool_result" | undefined;
  for (const segment of segments) {
    const runKind: "tool_call" | "tool_result" | undefined =
      segment.category === "tool_call" || segment.category === "tool_result" ? segment.category : undefined;
    if (runKind !== undefined && runKind === runCategory) {
      // continue the current run - same position
    } else {
      position++;
      runCategory = runKind;
    }
    out.push(position);
  }
  return out;
}

function cumulativeTokens(segments: Segment[], throughIndexInclusive: number): number {
  let sum = 0;
  for (let i = 0; i <= throughIndexInclusive; i++) sum += segments[i]!.claudeTokensEstimate;
  return sum;
}

function breakpointsOf(segments: Segment[]): BreakpointState[] {
  const out: BreakpointState[] = [];
  segments.forEach((segment, i) => {
    if (segment.cacheControl) {
      out.push({ segmentIndex: i, cumulativeTokens: cumulativeTokens(segments, i), ttl: segment.cacheControl.ttl });
    }
  });
  return out;
}

export function simulateAnthropicCacheSequence(
  requests: ParsedRequest[],
  prefixMatches: PrefixMatch[],
  model: string | undefined,
  forceOptimizedBreakpoint: boolean,
): CacheSimStep[] {
  const modelInfo = findAnthropicModel(model);
  const steps: CacheSimStep[] = [];
  let prevBreakpoints: BreakpointState[] = [];

  requests.forEach((request, i) => {
    const segments = request.segments;
    let breakpoints = breakpointsOf(segments);

    // "Optimized" mode: pretend a trailing breakpoint was added at the end of every request (the
    // "automatic caching on the growing tail" pattern the docs recommend), on top of whatever the
    // request already has. This - not a breakpoint keyed off the *previous* pair's boundary - is
    // what actually composes across a sequence: the same position (this request's last segment)
    // is also where the *next* request will look for a prior entry, so consecutive forced
    // breakpoints line up and can read each other. Anchoring instead to `prefixMatches[i - 1]`
    // (tried first; kept here as a note, not code) picks a different, non-repeating position each
    // turn, so it never finds its own prior write and only adds cold writes - a regression, not a fix.
    if (forceOptimizedBreakpoint) {
      const lastIndex = segments.length - 1;
      if (lastIndex >= 0 && !breakpoints.some((b) => b.segmentIndex === lastIndex)) {
        const forced: BreakpointState = { segmentIndex: lastIndex, cumulativeTokens: cumulativeTokens(segments, lastIndex), ttl: "5m" };
        breakpoints = [...breakpoints, forced].sort((a, b) => a.segmentIndex - b.segmentIndex);
      }
    }

    const total = segments.reduce((sum, s) => sum + s.claudeTokensEstimate, 0);

    if (breakpoints.length === 0) {
      // No cache_control marker at all: nothing is ever cached, regardless of history or how
      // stable the prefix actually is (cache_control absent = no caching, full stop).
      steps.push({ requestIndex: request.index, readTokens: 0, writeTokens5m: 0, writeTokens1h: 0, uncachedTokens: total, costUsd: undefined });
      prevBreakpoints = [];
      return;
    }

    const positions = positionIndexBySegment(segments);
    // No prior request (i === 0) means nothing can possibly be in cache yet: every breakpoint is a cold write.
    const match = i > 0 ? prefixMatches[i - 1] : undefined;
    const matchedBoundarySegmentIndex = match ? match.matchedSegments - 1 : -1;

    let readTokens = 0;
    let write5m = 0;
    let write1h = 0;
    let coveredThrough = -1; // segment index covered by cache (read or write) so far

    for (const bp of breakpoints.slice(0, 4)) {
      if (bp.cumulativeTokens < modelInfo.minCacheableTokens) continue; // below minimum: silently uncached

      // Find the best previous entry: the largest prior breakpoint that (a) lies at or before the
      // matched prefix boundary and (b) covers no more than this breakpoint does - a larger prior
      // entry can exist (e.g. a later, wider breakpoint from the previous request) but this
      // breakpoint can't "read ahead" of its own coverage, so it must be excluded, not just
      // skipped when it happens to be the sole candidate.
      const candidate = prevBreakpoints
        .filter((pb) => pb.segmentIndex <= matchedBoundarySegmentIndex && pb.cumulativeTokens <= bp.cumulativeTokens)
        .sort((a, b) => b.cumulativeTokens - a.cumulativeTokens)[0];

      let readFromThis = 0;
      if (candidate) {
        const distance = positions[bp.segmentIndex]! - positions[candidate.segmentIndex]!;
        if (distance <= ANTHROPIC_LOOKBACK_POSITIONS) {
          readFromThis = candidate.cumulativeTokens;
        }
      }

      if (readFromThis > readTokens) readTokens = readFromThis; // a later breakpoint's read supersedes an earlier smaller one

      const writeFrom = Math.max(coveredThrough >= 0 ? cumulativeTokens(segments, coveredThrough) : 0, readTokens);
      const newlyWritten = Math.max(0, bp.cumulativeTokens - writeFrom);
      if (newlyWritten > 0) {
        if (bp.ttl === "1h") write1h += newlyWritten;
        else write5m += newlyWritten;
      }
      coveredThrough = bp.segmentIndex;
    }

    const coveredTokens = coveredThrough >= 0 ? cumulativeTokens(segments, coveredThrough) : 0;
    const uncachedTokens = Math.max(0, total - coveredTokens);

    steps.push({ requestIndex: request.index, readTokens, writeTokens5m: write5m, writeTokens1h: write1h, uncachedTokens, costUsd: undefined });

    prevBreakpoints = breakpoints.filter((b) => b.cumulativeTokens >= modelInfo.minCacheableTokens);
  });

  return steps.map((step) => ({ ...step, costUsd: anthropicStepCostUsd(step, modelInfo) }));
}

function anthropicStepCostUsd(step: CacheSimStep, modelInfo: ReturnType<typeof findAnthropicModel>): number {
  const perTok = modelInfo.inputPricePerMTok / 1_000_000;
  return (
    step.uncachedTokens * perTok +
    step.writeTokens5m * perTok * ANTHROPIC_CACHE_WRITE_MULTIPLIER_5M +
    step.writeTokens1h * perTok * ANTHROPIC_CACHE_WRITE_MULTIPLIER_1H +
    step.readTokens * perTok * modelInfo.cacheReadMultiplier
  );
}
