import type { Finding, FindingKind, FindingSeverity } from "./types.js";

/**
 * One problem reported once, however many requests it recurs in. A timestamp
 * in the system prompt fires `volatile_prefix` on every request of a
 * 300-turn session; listing 299 identical findings buries everything else, so
 * the CLI and the web app show groups and keep the individual findings one
 * click away.
 */
export interface FindingGroup {
  kind: FindingKind;
  severity: FindingSeverity;
  title: string;
  /** Detail text of the first occurrence. */
  detail: string;
  /** 0-based request indices the finding fired on, ascending and unique. */
  requestIndices: number[];
  /** The underlying findings, in their original order. */
  findings: Finding[];
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };

// Titles that name a specific request pair only make sense for a single occurrence.
const GROUP_TITLE: Partial<Record<FindingKind, string>> = {
  tools_reordered: "Tools reordered between requests",
  model_switch: "Model changed mid-conversation",
};

/** Groups findings by kind and implicated segments; groups are ordered by severity, then by first occurrence. */
export function groupFindings(findings: readonly Finding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const finding of findings) {
    const key = `${finding.kind}|${[...new Set(finding.segmentIds)].sort().join(",")}`;
    const group = groups.get(key);
    if (group) {
      group.findings.push(finding);
      if (!group.requestIndices.includes(finding.requestIndex)) group.requestIndices.push(finding.requestIndex);
    } else {
      groups.set(key, {
        kind: finding.kind,
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
        requestIndices: [finding.requestIndex],
        findings: [finding],
      });
    }
  }
  const out = [...groups.values()];
  for (const group of out) {
    group.requestIndices.sort((a, b) => a - b);
    const generic = GROUP_TITLE[group.kind];
    if (generic && group.requestIndices.length > 1) group.title = generic;
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.requestIndices[0]! - b.requestIndices[0]!);
}

/** "request 3", "requests 2-24", "requests 2, 5, 7-9" (1-based, en dash for ranges). */
export function describeRequestIndices(indices: readonly number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `request ${sorted[0]! + 1}`;
  const parts: string[] = [];
  let start = sorted[0]!;
  let prev = start;
  for (const idx of [...sorted.slice(1), Number.NaN]) {
    if (idx === prev + 1) {
      prev = idx;
      continue;
    }
    parts.push(start === prev ? `${start + 1}` : prev === start + 1 ? `${start + 1}, ${prev + 1}` : `${start + 1}–${prev + 1}`);
    start = idx;
    prev = idx;
  }
  return `requests ${parts.join(", ")}`;
}
