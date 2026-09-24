/**
 * Model metadata: context window, list pricing, and (for Anthropic) the
 * prompt-cache minimum-cacheable-prefix and TTL/read-discount rules.
 *
 * Anthropic figures are from the bundled `claude-api` skill's reference
 * tables (model pricing table and shared/prompt-caching.md's "API reference"
 * and "Economics" sections, both dated 2026-06-24 in that skill's cache).
 *
 * OpenAI figures were fetched live via WebFetch on 2026-09-24 from
 * https://developers.openai.com/api/docs/pricing (model pricing) and
 * https://developers.openai.com/api/docs/guides/prompt-caching (caching
 * rules). OpenAI's newer explicit-breakpoint / 30-minute-TTL caching mode
 * (GPT-5.6 and later) is not simulated here - only the older implicit,
 * round-to-128-tokens mode is (see cache-openai.ts); this is a documented
 * scope cut, not a guess.
 */

export interface AnthropicModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  /** Cache read price as a fraction of `inputPricePerMTok`. */
  cacheReadMultiplier: number;
  /** Minimum prefix length (tokens) below which cache_control silently does not cache. */
  minCacheableTokens: number;
}

export interface OpenAiModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  cachedInputPricePerMTok: number;
}

// Cache write multipliers are the same across all current Anthropic models.
export const ANTHROPIC_CACHE_WRITE_MULTIPLIER_5M = 1.25;
export const ANTHROPIC_CACHE_WRITE_MULTIPLIER_1H = 2.0;
export const ANTHROPIC_MAX_BREAKPOINTS = 4;
export const ANTHROPIC_LOOKBACK_POSITIONS = 20;

export const ANTHROPIC_MODELS: readonly AnthropicModelInfo[] = [
  { id: "claude-opus-5", displayName: "Claude Opus 5", contextWindow: 1_000_000, inputPricePerMTok: 5, outputPricePerMTok: 25, cacheReadMultiplier: 0.1, minCacheableTokens: 512 },
  { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", contextWindow: 1_000_000, inputPricePerMTok: 2, outputPricePerMTok: 10, cacheReadMultiplier: 0.1, minCacheableTokens: 1024 },
  { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", contextWindow: 200_000, inputPricePerMTok: 1, outputPricePerMTok: 5, cacheReadMultiplier: 0.1, minCacheableTokens: 4096 },
  { id: "claude-fable-5-1", displayName: "Claude Fable 5.1", contextWindow: 1_000_000, inputPricePerMTok: 10, outputPricePerMTok: 50, cacheReadMultiplier: 0.025, minCacheableTokens: 512 },
];

// GPT-6 Astra / Sol / Luna: fetched from https://developers.openai.com/api/docs/pricing on 2026-09-24.
// Context/output windows: https://developers.openai.com/api/docs/models, same date.
export const OPENAI_MODELS: readonly OpenAiModelInfo[] = [
  { id: "gpt-6-astra", displayName: "GPT-6 Astra", contextWindow: 1_050_000, inputPricePerMTok: 10, outputPricePerMTok: 50, cachedInputPricePerMTok: 1 },
  { id: "gpt-6-sol", displayName: "GPT-6 Sol", contextWindow: 1_050_000, inputPricePerMTok: 2, outputPricePerMTok: 10, cachedInputPricePerMTok: 0.2 },
  { id: "gpt-6-luna", displayName: "GPT-6 Luna", contextWindow: 1_050_000, inputPricePerMTok: 0.1, outputPricePerMTok: 0.5, cachedInputPricePerMTok: 0.01 },
];

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
export const DEFAULT_OPENAI_MODEL = "gpt-6-sol";

export function findAnthropicModel(id: string | undefined): AnthropicModelInfo {
  const found = id ? ANTHROPIC_MODELS.find((m) => m.id === id) : undefined;
  return found ?? ANTHROPIC_MODELS.find((m) => m.id === DEFAULT_ANTHROPIC_MODEL)!;
}

export function findOpenAiModel(id: string | undefined): OpenAiModelInfo {
  const found = id ? OPENAI_MODELS.find((m) => m.id === id) : undefined;
  return found ?? OPENAI_MODELS.find((m) => m.id === DEFAULT_OPENAI_MODEL)!;
}
