import type { ParsedRequest, UsageReadOutcome } from "./types.js";

export const USAGE_OUTCOME_LABEL: Record<UsageReadOutcome, string> = {
  both_zero: "Both zero",
  both_positive: "Reuse on both sides",
  simulated_hit_reported_zero: "Simulated hit / reported zero",
  reported_hit_simulated_zero: "Reported hit / simulated zero",
  unavailable: "Read count unavailable",
};

export function usageSourceLabel(request: ParsedRequest): string {
  const source = request.source;
  return source?.line !== undefined ? `line ${source.line}` : `record ${(source?.recordIndex ?? request.index) + 1}`;
}

export function usageNumber(value: number | null): string {
  return value === null ? "n/a" : value.toLocaleString("en-US");
}

export function usageDelta(value: number | null): string {
  return value === null ? "n/a" : `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
}
