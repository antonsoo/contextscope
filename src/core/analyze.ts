import type { AnalysisOptions, AnalysisResult, CacheSimulation } from "./types.js";
import { parseInput } from "./parse.js";
import { computeAllPrefixMatches } from "./prefix.js";
import { buildRequestReport } from "./report.js";
import { simulateAnthropicCacheSequence } from "./cache-anthropic.js";
import { simulateOpenAiCacheSequence } from "./cache-openai.js";
import { findDuplicates } from "./duplicates.js";
import { computeFindings } from "./findings.js";

/** Runs the full contextscope pipeline: parse -> per-request token report -> prefix diffs
 * (actual and volatile-normalized) -> cache simulation (actual and optimized) -> duplicates -> findings. */
export function analyze(input: string, options: AnalysisOptions = {}): AnalysisResult {
  const parse = parseInput(input, options.format);
  const { requests, format } = parse;

  const reports = requests.map((r) => buildRequestReport(r, format, options.model));
  const prefixMatches = computeAllPrefixMatches(requests, false);
  const optimizedPrefixMatches = computeAllPrefixMatches(requests, true);

  let cacheSimulation: CacheSimulation;
  if (format === "anthropic") {
    const actual = simulateAnthropicCacheSequence(requests, prefixMatches, options.model, false);
    const optimized = simulateAnthropicCacheSequence(requests, optimizedPrefixMatches, options.model, true);
    cacheSimulation = {
      provider: "anthropic",
      model: options.model,
      actual,
      optimized,
      totalActualCostUsd: sumCost(actual),
      totalOptimizedCostUsd: sumCost(optimized),
    };
  } else {
    const actual = simulateOpenAiCacheSequence(requests, prefixMatches, options.model);
    const optimized = simulateOpenAiCacheSequence(requests, optimizedPrefixMatches, options.model);
    cacheSimulation = {
      provider: "openai",
      model: options.model,
      actual,
      optimized,
      totalActualCostUsd: sumCost(actual),
      totalOptimizedCostUsd: sumCost(optimized),
    };
  }

  const duplicates = findDuplicates(requests);
  const findings = computeFindings(format, requests, prefixMatches, options.model, duplicates, cacheSimulation);

  return { parse, reports, prefixMatches, cacheSimulation, findings, duplicates };
}

function sumCost(steps: { costUsd: number | undefined }[]): number | undefined {
  if (steps.some((s) => s.costUsd === undefined)) return undefined;
  return steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
}

export { parseInput } from "./parse.js";
export { computeAllPrefixMatches, computePrefixMatch } from "./prefix.js";
export * from "./types.js";
export { ANTHROPIC_MODELS, OPENAI_MODELS, findAnthropicModel, findOpenAiModel } from "./pricing.js";
export { calibrateSegments, type CalibrationRequest, type CalibrationResult } from "./calibrate.js";
