import type { AnalysisResult, ResolvedModel } from "./types.js";
import { describeRequestIndices } from "./group-findings.js";

/** Group the actual assumptions used by each request, including unknown-model fallbacks. */
export function modelGroups(result: AnalysisResult): { model: ResolvedModel; requestIndices: number[] }[] {
  const groups = new Map<string, { model: ResolvedModel; requestIndices: number[] }>();
  for (const report of result.reports) {
    const model = report.model;
    const key = JSON.stringify([model.id, model.source, model.unrecognized]);
    const group = groups.get(key);
    if (group) group.requestIndices.push(report.requestIndex);
    else groups.set(key, { model, requestIndices: [report.requestIndex] });
  }
  return [...groups.values()];
}

export function modelLabel(model: ResolvedModel): string {
  return `${model.displayName}${model.unrecognized ? ` (fallback for ${model.unrecognized})` : model.source === "default" ? " (assumed)" : ""}`;
}

export function modelSummary(result: AnalysisResult): string {
  const groups = modelGroups(result);
  return groups.length === 1 ? modelLabel(groups[0]!.model) : "models resolved per request";
}

/** Plain text only: renderers must apply their own escaping. */
export function modelNotes(result: AnalysisResult): string[] {
  const notes: string[] = [];
  for (const { model, requestIndices } of modelGroups(result)) {
    const where = describeRequestIndices(requestIndices);
    if (model.unrecognized) notes.push(`${where}: "${model.unrecognized}" is not in the pricing table. Prices, cache thresholds and context window assume ${model.displayName}. Use a model override to change this assumption.`);
    else if (model.source === "default") notes.push(`${where}: no model named; prices, cache thresholds and context window assume ${model.displayName}. Unnamed requests share a separate cache, isolated from named models.`);
  }
  if (result.reports.some((r) => r.model.source === "option")) notes.push("Model override applies prices, cache thresholds and context windows to every request. Cache identity still follows the model names captured in the log.");
  if (result.cacheSimulation.provider === "openai") {
    const modes = new Set(result.cacheSimulation.actual.map((s) => s.cacheMode));
    if (modes.has("implicit") || modes.has("explicit")) notes.push("OpenAI breakpoint caching: 30-minute writes cost 1.25 times ordinary input. Reads require an eligible matching boundary. GPT-6 input/cache rates double above 272,000 modeled input tokens. Prices assume Standard processing. Cache keys and changed renderer settings are isolated; expiry and hidden provider tokens are not modeled.");
    if (modes.has("legacy")) notes.push("Legacy OpenAI caching is an optimistic approximation: visible prefixes of at least 1,024 tokens, reads rounded to 128. Actual thresholds and hidden breakpoint intervals depend on request settings; no write premium is modeled.");
  }
  return notes;
}
