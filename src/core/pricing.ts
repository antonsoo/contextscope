/**
 * Model metadata: context window, list pricing, and (for Anthropic) the
 * prompt-cache minimum-cacheable-prefix and read-discount rules.
 *
 * Anthropic figures are from Anthropic's model pricing table and prompt
 * caching reference (minimum cacheable prefix per model, write multipliers,
 * per-model read prices), as of 2026-09-25. Two current models break the
 * usual "reads cost 0.1x input" rule: Claude Opus 5.5 reads at $0.20/MTok
 * (0.05x of $4) and Claude Fable 5.1 at $0.25/MTok (0.025x of $10). The
 * minimum cacheable prefix is not monotonic across generations (512 tokens on
 * the newest models, 4096 on Opus 4.6 and Haiku 4.5), which is exactly why it
 * is looked up per model instead of assumed.
 *
 * OpenAI figures were fetched on 2026-09-24 from
 * https://developers.openai.com/api/docs/pricing (model pricing) and
 * https://developers.openai.com/api/docs/guides/prompt-caching (caching
 * rules). OpenAI's newer explicit-breakpoint / 30-minute-TTL caching mode
 * (GPT-5.6 and later) is not simulated here - only the older implicit,
 * round-to-128-tokens mode is (see cache-openai.ts).
 */

import type { ResolvedModel, ModelSource } from "./types.js";

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
  /** Accepts `{role: "system"}` messages mid-conversation - the cache-safe place for per-request values. */
  midConversationSystem: boolean;
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
  { id: "claude-fable-5-1", displayName: "Claude Fable 5.1", contextWindow: 1_000_000, inputPricePerMTok: 10, outputPricePerMTok: 50, cacheReadMultiplier: 0.025, minCacheableTokens: 512, midConversationSystem: true },
  { id: "claude-fable-5", displayName: "Claude Fable 5", contextWindow: 1_000_000, inputPricePerMTok: 10, outputPricePerMTok: 50, cacheReadMultiplier: 0.1, minCacheableTokens: 512, midConversationSystem: true },
  { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", contextWindow: 1_000_000, inputPricePerMTok: 4, outputPricePerMTok: 20, cacheReadMultiplier: 0.05, minCacheableTokens: 512, midConversationSystem: true },
  { id: "claude-opus-5", displayName: "Claude Opus 5", contextWindow: 1_000_000, inputPricePerMTok: 5, outputPricePerMTok: 25, cacheReadMultiplier: 0.1, minCacheableTokens: 512, midConversationSystem: true },
  { id: "claude-opus-4-8", displayName: "Claude Opus 4.8", contextWindow: 1_000_000, inputPricePerMTok: 5, outputPricePerMTok: 25, cacheReadMultiplier: 0.1, minCacheableTokens: 1024, midConversationSystem: true },
  { id: "claude-opus-4-7", displayName: "Claude Opus 4.7", contextWindow: 1_000_000, inputPricePerMTok: 5, outputPricePerMTok: 25, cacheReadMultiplier: 0.1, minCacheableTokens: 2048, midConversationSystem: false },
  { id: "claude-opus-4-6", displayName: "Claude Opus 4.6", contextWindow: 1_000_000, inputPricePerMTok: 5, outputPricePerMTok: 25, cacheReadMultiplier: 0.1, minCacheableTokens: 4096, midConversationSystem: false },
  { id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5", contextWindow: 1_000_000, inputPricePerMTok: 2, outputPricePerMTok: 10, cacheReadMultiplier: 0.1, minCacheableTokens: 512, midConversationSystem: true },
  { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", contextWindow: 1_000_000, inputPricePerMTok: 2, outputPricePerMTok: 10, cacheReadMultiplier: 0.1, minCacheableTokens: 1024, midConversationSystem: false },
  { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", contextWindow: 1_000_000, inputPricePerMTok: 3, outputPricePerMTok: 15, cacheReadMultiplier: 0.1, minCacheableTokens: 1024, midConversationSystem: false },
  // Claude 4.5 generation, fetched 2026-10-08 from https://platform.claude.com/docs/en/about-claude/pricing and
  // https://platform.claude.com/docs/en/build-with-claude/prompt-caching (minimums), context windows from
  // https://platform.claude.com/docs/en/models/opus-4-5/overview and .../build-with-claude/context-windows.
  // Without these two a Claude Opus 4.5 log was priced as the default model and its 4,096-token minimum read as 512.
  { id: "claude-opus-4-5", displayName: "Claude Opus 4.5", contextWindow: 200_000, inputPricePerMTok: 5, outputPricePerMTok: 25, cacheReadMultiplier: 0.1, minCacheableTokens: 4096, midConversationSystem: false },
  { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5", contextWindow: 200_000, inputPricePerMTok: 3, outputPricePerMTok: 15, cacheReadMultiplier: 0.1, minCacheableTokens: 1024, midConversationSystem: false },
  { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", contextWindow: 200_000, inputPricePerMTok: 1, outputPricePerMTok: 5, cacheReadMultiplier: 0.1, minCacheableTokens: 4096, midConversationSystem: false },
];

// GPT-6 Astra / Sol / Luna: fetched from https://developers.openai.com/api/docs/pricing on 2026-09-24.
// Context/output windows: https://developers.openai.com/api/docs/models, same date.
export const OPENAI_MODELS: readonly OpenAiModelInfo[] = [
  { id: "gpt-6-astra", displayName: "GPT-6 Astra", contextWindow: 1_050_000, inputPricePerMTok: 10, outputPricePerMTok: 50, cachedInputPricePerMTok: 1 },
  { id: "gpt-6-sol", displayName: "GPT-6 Sol", contextWindow: 1_050_000, inputPricePerMTok: 2, outputPricePerMTok: 10, cachedInputPricePerMTok: 0.2 },
  { id: "gpt-6-luna", displayName: "GPT-6 Luna", contextWindow: 1_050_000, inputPricePerMTok: 0.1, outputPricePerMTok: 0.5, cachedInputPricePerMTok: 0.01 },
];

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
export const DEFAULT_OPENAI_MODEL = "gpt-6-sol";

/**
 * Reduces the model ids real request logs carry to the canonical ids in the
 * tables above: dated snapshots (`claude-haiku-4-5-20251001`), Amazon Bedrock
 * ids (`anthropic.claude-opus-5-5`, `us.anthropic.claude-sonnet-5-v1:0`),
 * Google Vertex AI snapshots (`claude-opus-4-5@20251101`), and OpenAI dated
 * snapshots (`gpt-6-sol-2026-08-01`).
 */
export function normalizeModelId(id: string): string {
  let out = id.trim().toLowerCase();
  out = out.replace(/^(?:[a-z]+\.)?anthropic\./, "");
  out = out.replace(/@.*$/, "");
  out = out.replace(/-v\d+(?::\d+)?$/, "");
  out = out.replace(/-\d{8}$/, "");
  out = out.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return out;
}

export function lookupAnthropicModel(id: string | undefined): AnthropicModelInfo | undefined {
  if (!id) return undefined;
  const key = normalizeModelId(id);
  return ANTHROPIC_MODELS.find((m) => m.id === key);
}

export function lookupOpenAiModel(id: string | undefined): OpenAiModelInfo | undefined {
  if (!id) return undefined;
  const key = normalizeModelId(id);
  return OPENAI_MODELS.find((m) => m.id === key);
}

export function findAnthropicModel(id: string | undefined): AnthropicModelInfo {
  return lookupAnthropicModel(id) ?? ANTHROPIC_MODELS.find((m) => m.id === DEFAULT_ANTHROPIC_MODEL)!;
}

export function findOpenAiModel(id: string | undefined): OpenAiModelInfo {
  return lookupOpenAiModel(id) ?? OPENAI_MODELS.find((m) => m.id === DEFAULT_OPENAI_MODEL)!;
}

/**
 * Resolves model metadata: an explicit option wins; otherwise
 * the model named most often in the requests themselves; otherwise the
 * provider default. An id with no pricing entry falls back to the default but
 * is reported as `unrecognized`, so callers can say so instead of silently
 * pricing an Opus log at Sonnet rates. Analysis calls this for each request;
 * the most-common choice remains only as a compatibility summary.
 */
export function resolveModel(provider: "anthropic" | "openai", explicit: string | undefined, requestModels: (string | undefined)[]): ResolvedModel {
  const lookup = provider === "anthropic" ? lookupAnthropicModel : lookupOpenAiModel;
  const fallback = provider === "anthropic" ? findAnthropicModel(undefined) : findOpenAiModel(undefined);

  let candidate: string | undefined;
  let source: ModelSource = "default";
  if (explicit !== undefined && explicit.trim() !== "") {
    candidate = explicit;
    source = "option";
  } else {
    const counts = new Map<string, number>();
    for (const m of requestModels) if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    let best: [string, number] | undefined;
    for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
    if (best) {
      candidate = best[0];
      source = "request";
    }
  }

  if (candidate === undefined) return { id: fallback.id, displayName: fallback.displayName, source: "default" };
  const info = lookup(candidate);
  if (info) return { id: info.id, displayName: info.displayName, source };
  return { id: fallback.id, displayName: fallback.displayName, source: "default", unrecognized: candidate };
}
