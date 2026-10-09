import type { AnalysisOptions, AnalysisResult, CacheSimulation, ParsedRequest } from "./types.js";
import { ContextScopeParseError, parseInput } from "./parse.js";
import { computeAllPrefixMatches } from "./prefix.js";
import { prefixPaths, threadRequests } from "./threads.js";
import { buildRequestReport } from "./report.js";
import { simulateAnthropicCacheSequence } from "./cache-anthropic.js";
import { simulateOpenAiCacheSequence } from "./cache-openai.js";
import { findDuplicates } from "./duplicates.js";
import { computeFindings } from "./findings.js";
import { resolveModel } from "./pricing.js";
import { compareReportedUsage } from "./usage-comparison.js";

/** Runs the full contextscope pipeline: parse -> per-request token report -> prefix diffs
 * (actual and volatile-normalized) -> cache simulation (actual and optimized) -> duplicates -> findings. */
export function analyze(input: string, options: AnalysisOptions = {}): AnalysisResult {
  const parse = parseInput(input, options.format);
  const { format } = parse;
  const scale = validScale(options.claudeTokenScale);
  if (scale !== 1) parse.requests = parse.requests.map((r) => scaleClaudeEstimates(r, scale));
  const { requests } = parse;

  const model = resolveModel(format, options.model, requests.map((r) => r.model));

  const reports = requests.map((r) => buildRequestReport(r, format, model.id));
  // Which earlier request each request continues: the line before it only when the file is one
  // conversation (see threads.ts).
  const paths = prefixPaths(requests, false);
  const optimizedPaths = prefixPaths(requests, true);
  const threads = threadRequests(requests, paths, optimizedPaths);
  const prefixMatches = computeAllPrefixMatches(requests, false, true, threads);

  let cacheSimulation: CacheSimulation;
  if (format === "anthropic") {
    const actual = simulateAnthropicCacheSequence(requests, paths, model.id, false);
    const optimized = simulateAnthropicCacheSequence(requests, optimizedPaths, model.id, true);
    cacheSimulation = {
      provider: "anthropic",
      model: model.id,
      actual,
      optimized,
      totalActualCostUsd: sumCost(actual),
      totalOptimizedCostUsd: sumCost(optimized),
    };
  } else {
    const actual = simulateOpenAiCacheSequence(requests, paths, model.id);
    const optimized = simulateOpenAiCacheSequence(requests, optimizedPaths, model.id);
    cacheSimulation = {
      provider: "openai",
      model: model.id,
      actual,
      optimized,
      totalActualCostUsd: sumCost(actual),
      totalOptimizedCostUsd: sumCost(optimized),
    };
  }

  // Each conversation is scanned where it is longest: at the requests no later request continues.
  const continued = new Set(prefixMatches.filter((m) => m.relation !== "new_conversation").map((m) => m.fromIndex));
  const duplicates = findDuplicates(requests, requests.map((r) => r.index).filter((i) => !continued.has(i)));
  const findings = computeFindings(format, requests, prefixMatches, model.id, duplicates, cacheSimulation);

  const conversations = { count: threads.conversationCount, byRequest: threads.conversation };
  const usageComparison = compareReportedUsage(requests, reports, cacheSimulation);
  return { parse, model, claudeTokenScale: scale, reports, prefixMatches, conversations, cacheSimulation, usageComparison, findings, duplicates };
}

function validScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || scale <= 0) return 1;
  return scale;
}

function scaleClaudeEstimates(request: ParsedRequest, scale: number): ParsedRequest {
  let total = 0;
  return {
    ...request,
    segments: request.segments.map((s) => {
      const tokens = Math.max(s.claudeTokensEstimate > 0 ? 1 : 0, Math.round(s.claudeTokensEstimate * scale));
      total += tokens;
      if (!Number.isSafeInteger(total)) throw new ContextScopeParseError(`Calibration scale makes request ${request.index + 1} token counts exceed the safe integer range. Use a smaller measured count or scale.`);
      return { ...s, claudeTokensEstimate: tokens };
    }),
  };
}

function sumCost(steps: { costUsd: number | undefined }[]): number | undefined {
  if (steps.some((s) => s.costUsd === undefined)) return undefined;
  return steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
}

export { ContextScopeParseError, parseInput } from "./parse.js";
export { computeAllPrefixMatches, computePrefixMatch } from "./prefix.js";
export { threadRequests, type Threads } from "./threads.js";
export * from "./types.js";
export { toJsonReport } from "./json-report.js";
export {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  findAnthropicModel,
  findOpenAiModel,
  normalizeModelId,
  resolveModel,
} from "./pricing.js";
export { groupFindings, describeRequestIndices, type FindingGroup } from "./group-findings.js";
export { calibrateRequest, calibrationScale, countRequestTokens, countTokensBody, CalibrationError, type CalibrationResult } from "./calibrate.js";

// Tokenizer merge caches retain input substrings; interactive callers can release them on reset.
export { clearMergeCache as clearTokenCache } from "gpt-tokenizer/encoding/o200k_base";
