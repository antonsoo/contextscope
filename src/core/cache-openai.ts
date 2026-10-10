import type { CacheSimStep, ParsedRequest } from "./types.js";
import { findOpenAiModel, resolveModel } from "./pricing.js";
import { openAiCachePlan, openAiCacheScope } from "./openai-breakpoints.js";
import { ContextScopeParseError } from "./parse-error.js";

/**
 * Modern OpenAI: exact modeled boundaries, explicit/implicit mode, four writes and 30m
 * write pricing. Legacy: the existing optimistic 1024/128-token approximation; hidden
 * intervals and renderer tokens remain unavailable. No wall-clock eviction is modeled.
 * Rules checked 2026-10-09: https://developers.openai.com/api/docs/guides/prompt-caching
 */
const MIN_CACHEABLE_TOKENS = 1024;
const CACHE_GRANULARITY = 128;

export function simulateOpenAiCacheSequence(requests: ParsedRequest[], paths: number[][], model: string | undefined): CacheSimStep[] {
  const cached = new Map<string, Set<number>>();
  return requests.map((request, i) => {
    const modelInfo = findOpenAiModel(resolveModel("openai", model, [request.model]).id);
    const path = paths[i]!;
    let total = 0;
    const cumulative = request.segments.map((s) => (total += s.openaiTokens));
    const scope = openAiCacheScope(request);
    let entries = cached.get(scope);
    if (!entries) { entries = new Set(); cached.set(scope, entries); }
    const plan = openAiCachePlan(request);
    let readTokens = 0;
    let writeTokens = 0;
    const modern = modelInfo.cacheStyle === "breakpoints";
    if (modern) {
      for (const index of plan.lookup) {
        if (cumulative[index]! >= MIN_CACHEABLE_TOKENS && entries.has(path[index]!)) readTokens = Math.max(readTokens, cumulative[index]!);
      }
      const writes = plan.write.filter((index) => cumulative[index]! >= MIN_CACHEABLE_TOKENS);
      const covered = Math.max(readTokens, ...writes.map((index) => cumulative[index]!), 0);
      writeTokens = covered - readTokens;
      // Reads are resolved before any writes so one request cannot read its own entries.
      for (const index of writes) entries.add(path[index]!);
    } else {
      if (plan.explicit.length || plan.mode === "explicit") {
        throw new ContextScopeParseError(`Request ${request.index + 1}: explicit OpenAI caching requires a model with breakpoint caching; ${modelInfo.displayName} uses legacy caching.`);
      }
      let matched = 0;
      let high = path.length;
      while (matched < high) {
        const mid = (matched + high + 1) >> 1;
        if (entries.has(path[mid - 1]!)) matched = mid;
        else high = mid - 1;
      }
      const shared = matched ? cumulative[matched - 1]! : 0;
      readTokens = shared >= MIN_CACHEABLE_TOKENS ? Math.floor(shared / CACHE_GRANULARITY) * CACHE_GRANULARITY : 0;
      for (const node of path) entries.add(node);
    }
    const uncachedTokens = total - readTokens - writeTokens;
    const priceMultiplier = modelInfo.longContextInput && total > modelInfo.longContextInput.aboveTokens ? modelInfo.longContextInput.multiplier : 1;
    const costUsd = priceMultiplier * ((uncachedTokens + writeTokens * 1.25) * modelInfo.inputPricePerMTok + readTokens * modelInfo.cachedInputPricePerMTok) / 1_000_000;
    return { requestIndex: request.index, readTokens, writeTokens5m: 0, writeTokens1h: 0,
      ...(modern ? { writeTokens30m: writeTokens } : {}), cacheMode: modern ? plan.mode : "legacy", uncachedTokens, costUsd };
  });
}
