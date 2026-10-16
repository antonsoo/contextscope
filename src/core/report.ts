import type { CategoryBreakdown, ParsedRequest, Provider, RequestTokenReport, SegmentCategory } from "./types.js";
import { findAnthropicModel, findOpenAiModel, resolveModel } from "./pricing.js";
import { sumTokenCounts } from "./media-accounting.js";

const CATEGORY_ORDER: SegmentCategory[] = ["system", "tools", "user", "assistant", "tool_call", "tool_result", "image", "thinking"];

export function buildRequestReport(request: ParsedRequest, provider: Provider, model: string | undefined): RequestTokenReport {
  const resolved = resolveModel(provider, model, [request.model]);
  const byCategory: CategoryBreakdown[] = CATEGORY_ORDER.map((category) => {
    const segs = request.segments.filter((s) => s.category === category);
    return {
      category,
      segmentCount: segs.length,
      openaiTokens: sumTokenCounts(segs.map(s => s.openaiTokens)),
      claudeTokensEstimate: sumTokenCounts(segs.map(s => s.claudeTokensEstimate)),
    };
  }).filter((c) => c.segmentCount > 0);

  const totals = {
    openaiTokens: sumTokenCounts(request.segments.map(s => s.openaiTokens)),
    claudeTokensEstimate: sumTokenCounts(request.segments.map(s => s.claudeTokensEstimate)),
  };

  const contextWindow = provider === "anthropic" ? findAnthropicModel(resolved.id).contextWindow : findOpenAiModel(resolved.id).contextWindow;
  const tokensForWindow = provider === "anthropic" ? totals.claudeTokensEstimate : totals.openaiTokens;

  return {
    requestIndex: request.index,
    model: resolved,
    totals,
    byCategory,
    segments: request.segments,
    contextWindow,
    percentOfContextWindow: contextWindow > 0 && tokensForWindow !== null ? tokensForWindow / contextWindow : undefined,
  };
}
