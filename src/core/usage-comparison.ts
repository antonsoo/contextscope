import type { CacheSimulation, ParsedRequest, RequestTokenReport, UsageComparison, UsageComparisonRow, UsageMetricComparison, UsageReadOutcome } from "./types.js";

export function compareReportedUsage(requests: ParsedRequest[], reports: RequestTokenReport[], simulation: CacheSimulation): UsageComparison {
  const rows: UsageComparisonRow[] = [];
  const invalidRequestIndices: number[] = [];
  const uncomparedRequestIndices: number[] = [];
  let capturedRequests = 0;
  const byReport = new Map(reports.map((report) => [report.requestIndex, report]));
  const byStep = new Map(simulation.actual.map((step) => [step.requestIndex, step]));
  for (const request of requests) {
    const usage = request.reportedUsage;
    if (usage) capturedRequests++;
    if (usage?.status === "invalid") invalidRequestIndices.push(request.index);
    if (!request.segments.length) {
      if (usage) uncomparedRequestIndices.push(request.index);
      continue;
    }
    const report = byReport.get(request.index)!;
    const step = byStep.get(request.index)!;
    const input = usage?.inputTokens ?? null;
    const read = usage?.cacheReadTokens ?? null;
    const estimated = simulation.provider === "openai" ? report.totals.openaiTokens : report.totals.claudeTokensEstimate;
    rows.push({
      requestIndex: request.index,
      estimatedInputTokens: estimated,
      simulatedReadTokens: step.readTokens,
      reportedInputTokens: input,
      reportedReadTokens: read,
      reportedWriteTokens: usage?.cacheWriteTokens ?? null,
      inputDeltaTokens: input === null ? null : estimated - input,
      readDeltaTokens: read === null ? null : step.readTokens - read,
      readOutcome: outcome(read, step.readTokens),
    });
  }
  const issues: string[] = [];
  const metric = (reported: "reportedInputTokens" | "reportedReadTokens", simulated: "estimatedInputTokens" | "simulatedReadTokens", label: string): UsageMetricComparison => {
    const covered = rows.filter((row) => row[reported] !== null);
    const sum = (field: typeof reported | typeof simulated): number | null => {
      if (!covered.length) return null;
      let total = 0;
      for (const row of covered) {
        total += row[field]!;
        if (!Number.isSafeInteger(total)) {
          issues.push(`${label}: ${field} aggregate exceeds the safe integer range; inspect individual requests.`);
          return null;
        }
      }
      return total;
    };
    const reportedTokens = sum(reported);
    const simulatedTokens = sum(simulated);
    return { requestIndices: covered.map((row) => row.requestIndex), reportedTokens, simulatedTokens, deltaTokens: reportedTokens === null || simulatedTokens === null ? null : simulatedTokens - reportedTokens };
  };
  const readOutcomes: Record<UsageReadOutcome, number> = { both_zero: 0, both_positive: 0, simulated_hit_reported_zero: 0, reported_hit_simulated_zero: 0, unavailable: 0 };
  for (const row of rows) readOutcomes[row.readOutcome]++;
  return { rows, capturedRequests, uncomparedRequestIndices, invalidRequestIndices, input: metric("reportedInputTokens", "estimatedInputTokens", "Input tokens"), cacheRead: metric("reportedReadTokens", "simulatedReadTokens", "Cache reads"), readOutcomes, issues };
}

function outcome(read: number | null, simulated: number): UsageReadOutcome {
  if (read === null) return "unavailable";
  if (read === 0) return simulated === 0 ? "both_zero" : "simulated_hit_reported_zero";
  return simulated === 0 ? "reported_hit_simulated_zero" : "both_positive";
}
