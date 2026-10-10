import type { CacheSimStep, CacheTtl, ParsedRequest, Segment } from "./types.js";
import { ANTHROPIC_CACHE_WRITE_MULTIPLIER_1H, ANTHROPIC_CACHE_WRITE_MULTIPLIER_5M, ANTHROPIC_LOOKBACK_POSITIONS, findAnthropicModel } from "./pricing.js";
import { ModelScoped } from "./model-id.js";
import { anthropicPositions, lastCacheableSegment } from "./anthropic-breakpoints.js";
import { ContextScopeParseError } from "./parse-error.js";

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
 * 20-position lookback window including this breakpoint (consecutive tool_use /
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

function breakpointsOf(segments: Segment[], cumulative: number[]): BreakpointState[] {
  const out: BreakpointState[] = [];
  segments.forEach((segment, i) => {
    if (segment.cacheControl) {
      out.push({ segmentIndex: i, cumulativeTokens: cumulative[i]!, ttl: segment.cacheControl.ttl });
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
    let total = 0;
    const cumulative = segments.map((s) => (total += s.claudeTokensEstimate));
    let breakpoints = breakpointsOf(segments, cumulative);
    if (breakpoints.length > 4) throw new ContextScopeParseError(`Request ${request.index + 1}: cache simulation requires at most 4 breakpoints.`);

    // "Optimized" mode: put a trailing breakpoint on the last cacheable block (the
    // "automatic caching on the growing tail" pattern the docs recommend), on top of whatever the
    // request already has. This - not a breakpoint keyed off the previous request's boundary - is
    // what actually composes across a sequence: the same position (this request's last segment)
    // is also where the *next* request will look for a prior entry, so consecutive forced
    // breakpoints line up and can read each other.
    if (forceOptimizedBreakpoint) {
      const lastIndex = lastCacheableSegment(segments);
      if (lastIndex >= 0 && !breakpoints.some((b) => b.segmentIndex === lastIndex)) {
        // With four occupied slots, move the last marker (preserving its TTL) instead
        // of inventing a fifth one that the provider would reject.
        const ttl = breakpoints.length === 4 ? breakpoints.pop()!.ttl : "5m";
        const forced: BreakpointState = { segmentIndex: lastIndex, cumulativeTokens: cumulative[lastIndex]!, ttl };
        breakpoints = [...breakpoints, forced].sort((a, b) => a.segmentIndex - b.segmentIndex);
      }
    }
    breakpoints = breakpoints.filter((bp) => bp.cumulativeTokens >= modelInfo.minCacheableTokens);

    if (breakpoints.length === 0) {
      // No marker reaches the minimum: nothing is read or written, even with a stable prefix.
      steps.push({ requestIndex: request.index, readTokens: 0, writeTokens5m: 0, writeTokens1h: 0, uncachedTokens: total, costUsd: undefined });
      return;
    }

    const positions = anthropicPositions(segments);
    // Entries of another model are never visible: a cached prefix is that model's own state.
    const cached = written.visibleTo(request.model);

    let readTokens = 0;
    for (const bp of breakpoints) {
      // The longest cached prefix of this request that ends at or before the breakpoint - it can't
      // "read ahead" of its own coverage - and no more than the lookback window behind it.
      let readFromThis = 0;
      // The breakpoint itself is position one: distance 20 is already out of range.
      for (let at = bp.segmentIndex; at >= 0 && positions[bp.segmentIndex]! - positions[at]! < ANTHROPIC_LOOKBACK_POSITIONS; at--) {
        if (cached.some((entries) => entries.has(path[at]!))) {
          readFromThis = cumulative[at]!;
          break;
        }
      }
      if (readFromThis > readTokens) readTokens = readFromThis; // a later breakpoint's read supersedes an earlier smaller one
    }
    // Resolve every read before billing any write. A later breakpoint can find a
    // hit covering an earlier miss. Anthropic's A/B/C partition bills that prefix
    // once: [0,A) reads, [A,B) 1h writes, [B,C) 5m writes, [C,total) plain input.
    const oneHourThrough = Math.max(readTokens, ...breakpoints.filter((bp) => bp.ttl === "1h").map((bp) => bp.cumulativeTokens));
    const coveredTokens = breakpoints[breakpoints.length - 1]!.cumulativeTokens;
    const write1h = oneHourThrough - readTokens;
    const write5m = coveredTokens - oneHourThrough;
    const uncachedTokens = total - coveredTokens;

    steps.push({ requestIndex: request.index, readTokens, writeTokens5m: write5m, writeTokens1h: write1h, uncachedTokens, costUsd: undefined });

    const mine = written.of(request.model);
    for (const bp of breakpoints) {
      mine.add(path[bp.segmentIndex]!);
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
