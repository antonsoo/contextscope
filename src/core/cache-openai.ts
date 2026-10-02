import type { CacheSimStep, ParsedRequest } from "./types.js";
import { findOpenAiModel } from "./pricing.js";
import { ModelScoped } from "./model-id.js";

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

export function simulateOpenAiCacheSequence(requests: ParsedRequest[], paths: number[][], model: string | undefined): CacheSimStep[] {
  const modelInfo = findOpenAiModel(model);
  const steps: CacheSimStep[] = [];
  // The cache is keyed by content: a request reads the longest prefix any earlier request on its
  // model sent, whether or not that was the line before it. `paths` (threads.ts `prefixPaths`)
  // gives every prefix a node, and these are the nodes sent so far.
  const sent = new ModelScoped();

  requests.forEach((request, i) => {
    const path = paths[i]!;
    const total = request.segments.reduce((sum, s) => sum + s.openaiTokens, 0);
    const earlier = sent.visibleTo(request.model);
    // Whether a prefix was sent before is monotone in its length, so the longest is a binary search.
    let matched = 0;
    let high = path.length;
    while (matched < high) {
      const mid = (matched + high + 1) >> 1;
      if (earlier.some((nodes) => nodes.has(path[mid - 1]!))) matched = mid;
      else high = mid - 1;
    }
    let rawCacheable = 0;
    for (let k = 0; k < matched; k++) rawCacheable += request.segments[k]!.openaiTokens;
    const cachedTokens = rawCacheable >= MIN_CACHEABLE_TOKENS ? Math.floor(rawCacheable / CACHE_GRANULARITY) * CACHE_GRANULARITY : 0;
    const uncachedTokens = Math.max(0, total - cachedTokens);

    const perTok = modelInfo.inputPricePerMTok / 1_000_000;
    const cachedPerTok = modelInfo.cachedInputPricePerMTok / 1_000_000;
    const costUsd = uncachedTokens * perTok + cachedTokens * cachedPerTok;

    steps.push({ requestIndex: request.index, readTokens: cachedTokens, writeTokens5m: 0, writeTokens1h: 0, uncachedTokens, costUsd });

    const mine = sent.of(request.model);
    for (const node of path) mine.add(node);
  });

  return steps;
}
