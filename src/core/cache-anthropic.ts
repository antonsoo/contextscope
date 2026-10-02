import type { CacheSimStep, CacheTtl, ParsedRequest, Segment } from "./types.js";
import { ANTHROPIC_CACHE_WRITE_MULTIPLIER_1H, ANTHROPIC_CACHE_WRITE_MULTIPLIER_5M, ANTHROPIC_LOOKBACK_POSITIONS, findAnthropicModel } from "./pricing.js";
import { ModelScoped } from "./model-id.js";

/**
 * Simulates Anthropic prompt caching across a sequence of requests.
 *
 * Model (documented simplification - see README "How it works"): each
 * request's `cache_control` breakpoints (up to 4, taken in ascending
 * position order) are checked against the cache entries earlier requests
 * wrote. The cache is keyed by content, not by conversation: a breakpoint
 * reads from an entry when (a) the entry's prefix is byte-identical to this
 * request's up to that point, whichever earlier request wrote it, (b) that
 * request ran on the same model, and (c) the entry lies within the
 * 20-position lookback window of this breakpoint (consecutive tool_use /
 * tool_result runs collapse to one position each, per Anthropic's documented
 * rule). Anything past the last valid breakpoint's coverage, or below the
 * model's minimum cacheable length, is billed as plain uncached input. This
 * does not model true TTL expiry (5-minute / 1-hour wall-clock windows)
 * since request JSON carries no timestamps - it assumes the requests of a
 * file arrive inside the TTL, which is the steady-agent-loop case the tool
 * is built to catch.
 *
 * Prefixes are compared through `paths` (threads.ts `prefixPaths`): equal
 * nodes at equal positions are equal prefixes.
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
  paths: number[][],
  model: string | undefined,
  forceOptimizedBreakpoint: boolean,
): CacheSimStep[] {
  const modelInfo = findAnthropicModel(model);
  const steps: CacheSimStep[] = [];
  /** The prefixes cached so far, by the model that cached them: each is the node a breakpoint ended at. */
  const written = new ModelScoped();

  requests.forEach((request, i) => {
    const segments = request.segments;
    const path = paths[i]!;
    let breakpoints = breakpointsOf(segments);

    // "Optimized" mode: pretend a trailing breakpoint was added at the end of every request (the
    // "automatic caching on the growing tail" pattern the docs recommend), on top of whatever the
    // request already has. This - not a breakpoint keyed off the previous request's boundary - is
    // what actually composes across a sequence: the same position (this request's last segment)
    // is also where the *next* request will look for a prior entry, so consecutive forced
    // breakpoints line up and can read each other.
    if (forceOptimizedBreakpoint) {
      const lastIndex = segments.length - 1;
      if (lastIndex >= 0 && !breakpoints.some((b) => b.segmentIndex === lastIndex)) {
        const forced: BreakpointState = { segmentIndex: lastIndex, cumulativeTokens: cumulativeTokens(segments, lastIndex), ttl: "5m" };
        breakpoints = [...breakpoints, forced].sort((a, b) => a.segmentIndex - b.segmentIndex);
      }
    }

    const total = segments.reduce((sum, s) => sum + s.claudeTokensEstimate, 0);

    if (breakpoints.length === 0) {
      // No cache_control marker at all: nothing of this request is read or written, however
      // stable its prefix is (cache_control absent = no caching, full stop).
      steps.push({ requestIndex: request.index, readTokens: 0, writeTokens5m: 0, writeTokens1h: 0, uncachedTokens: total, costUsd: undefined });
      return;
    }

    const positions = positionIndexBySegment(segments);
    // Entries of another model are never visible: a cached prefix is that model's own state.
    const cached = written.visibleTo(request.model);

    let readTokens = 0;
    let write5m = 0;
    let write1h = 0;
    let coveredThrough = -1; // segment index covered by cache (read or write) so far

    for (const bp of breakpoints.slice(0, 4)) {
      if (bp.cumulativeTokens < modelInfo.minCacheableTokens) continue; // below minimum: silently uncached

      // The longest cached prefix of this request that ends at or before the breakpoint - it can't
      // "read ahead" of its own coverage - and no more than the lookback window behind it.
      let readFromThis = 0;
      for (let at = bp.segmentIndex; at >= 0 && positions[bp.segmentIndex]! - positions[at]! <= ANTHROPIC_LOOKBACK_POSITIONS; at--) {
        if (cached.some((entries) => entries.has(path[at]!))) {
          readFromThis = cumulativeTokens(segments, at);
          break;
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

    const mine = written.of(request.model);
    for (const bp of breakpoints) {
      if (bp.cumulativeTokens >= modelInfo.minCacheableTokens) mine.add(path[bp.segmentIndex]!);
    }
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
