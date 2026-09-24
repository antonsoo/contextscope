import type { CacheSimStep, ParsedRequest, PrefixMatch } from "./types.js";
import { findOpenAiModel } from "./pricing.js";

/**
 * Simulates OpenAI's automatic (implicit) prompt caching: no `cache_control`
 * marker to place, no write premium - the platform caches the prefix of any
 * request at least 1024 tokens long automatically, reporting the cached
 * portion rounded down to the nearest 128 tokens. Rules verified via
 * WebFetch on 2026-09-24 from
 * https://developers.openai.com/api/docs/guides/prompt-caching (see
 * pricing.ts for the full citation). This module models that legacy/default
 * mode only - GPT-5.6's newer explicit-breakpoint, exact-boundary, 30-minute
 * TTL mode is out of scope for v0.1, noted in the README.
 */

const MIN_CACHEABLE_TOKENS = 1024;
const CACHE_GRANULARITY = 128;

export function simulateOpenAiCacheSequence(requests: ParsedRequest[], prefixMatches: PrefixMatch[], model: string | undefined): CacheSimStep[] {
  const modelInfo = findOpenAiModel(model);
  const steps: CacheSimStep[] = [];

  requests.forEach((request, i) => {
    const total = request.segments.reduce((sum, s) => sum + s.openaiTokens, 0);
    const match = i > 0 ? prefixMatches[i - 1] : undefined;
    const rawCacheable = match ? match.matchedOpenaiTokens : 0;
    const cachedTokens = rawCacheable >= MIN_CACHEABLE_TOKENS ? Math.floor(rawCacheable / CACHE_GRANULARITY) * CACHE_GRANULARITY : 0;
    const uncachedTokens = Math.max(0, total - cachedTokens);

    const perTok = modelInfo.inputPricePerMTok / 1_000_000;
    const cachedPerTok = modelInfo.cachedInputPricePerMTok / 1_000_000;
    const costUsd = uncachedTokens * perTok + cachedTokens * cachedPerTok;

    steps.push({ requestIndex: request.index, readTokens: cachedTokens, writeTokens5m: 0, writeTokens1h: 0, uncachedTokens, costUsd });
  });

  return steps;
}
