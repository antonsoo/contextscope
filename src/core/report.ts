import type { CategoryBreakdown, ParsedRequest, Provider, RequestTokenReport, SegmentCategory } from "./types.js";
import { findAnthropicModel, findOpenAiModel } from "./pricing.js";

const CATEGORY_ORDER: SegmentCategory[] = ["system", "tools", "user", "assistant", "tool_call", "tool_result", "image", "thinking"];

export function buildRequestReport(request: ParsedRequest, provider: Provider, model: string | undefined): RequestTokenReport {
  const byCategory: CategoryBreakdown[] = CATEGORY_ORDER.map((category) => {
    const segs = request.segments.filter((s) => s.category === category);
    return {
      category,
      segmentCount: segs.length,
      openaiTokens: segs.reduce((sum, s) => sum + s.openaiTokens, 0),
      claudeTokensEstimate: segs.reduce((sum, s) => sum + s.claudeTokensEstimate, 0),
    };
  }).filter((c) => c.segmentCount > 0);

  const totals = {
    openaiTokens: request.segments.reduce((sum, s) => sum + s.openaiTokens, 0),
    claudeTokensEstimate: request.segments.reduce((sum, s) => sum + s.claudeTokensEstimate, 0),
  };

  const contextWindow = provider === "anthropic" ? findAnthropicModel(model).contextWindow : findOpenAiModel(model).contextWindow;
  const tokensForWindow = provider === "anthropic" ? totals.claudeTokensEstimate : totals.openaiTokens;

  return {
    requestIndex: request.index,
    totals,
    byCategory,
    segments: request.segments,
    contextWindow,
    percentOfContextWindow: contextWindow > 0 ? tokensForWindow / contextWindow : undefined,
  };
}
