import { describe, expect, it } from "vitest";
import { describeRequestIndices, groupFindings } from "../src/core/group-findings.js";
import { analyze } from "../src/core/analyze.js";
import type { Finding } from "../src/core/types.js";

function finding(partial: Partial<Finding> & Pick<Finding, "kind" | "requestIndex">): Finding {
  return { severity: "warning", title: "t", detail: `d${partial.requestIndex}`, segmentIds: [], ...partial };
}

describe("groupFindings", () => {
  it("keeps different severities separate even when their titles match", () => {
    const groups = groupFindings([
      finding({ kind: "anthropic_speed", severity: "info", requestIndex: 0 }),
      finding({ kind: "anthropic_speed", severity: "warning", requestIndex: 1 }),
      finding({ kind: "anthropic_speed", severity: "info", requestIndex: 2 }),
    ]);
    expect(groups.map(({ severity, requestIndices }) => ({ severity, requestIndices }))).toEqual([
      { severity: "warning", requestIndices: [1] }, { severity: "info", requestIndices: [0, 2] },
    ]);
  });

  it.each([
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ])("preserves speed message meanings across request order %j %j %j", (...order) => {
    const variants = [
      { model: "claude-opus-5-5", speed: "fast", title: "Fast input pricing", severity: "info" },
      { model: "claude-opus-4-6", speed: "fast", title: "Fast request modeled at standard speed", severity: "info" },
      { model: "claude-opus-5-5", speed: "unrecognized-mode", title: "Speed pricing unavailable", severity: "warning" },
    ];
    const sequence = [...order, ...order];
    const requests = sequence.map((index) => ({
      model: variants[index]!.model, speed: variants[index]!.speed,
      messages: [{ role: "user", content: "Synthetic grouping reproduction." }],
    }));
    const result = analyze(JSON.stringify(requests));
    const original = structuredClone(result.findings);
    const groups = groupFindings(result.findings).filter((group) => group.kind === "anthropic_speed");
    expect(groups).toHaveLength(3);
    expect(groups[0]!.severity).toBe("warning");
    for (const [index, variant] of variants.entries()) {
      const group = groups.find((item) => item.title === variant.title)!;
      expect(group.severity).toBe(variant.severity);
      expect(group.requestIndices).toEqual(sequence.flatMap((value, position) => value === index ? [position] : []));
      expect(group.findings.every((item) => item.title === group.title && item.severity === group.severity)).toBe(true);
    }
    expect(groups.flatMap((group) => group.findings)).toHaveLength(6);
    expect(result.findings).toEqual(original);
  });

  it("collapses a finding that recurs on every request into one group", () => {
    const findings = [1, 2, 3, 4].map((i) => finding({ kind: "volatile_prefix", severity: "error", requestIndex: i, segmentIds: ["system[0]"] }));
    const [group, ...rest] = groupFindings(findings);
    expect(rest).toHaveLength(0);
    expect(group!.requestIndices).toEqual([1, 2, 3, 4]);
    expect(group!.findings).toHaveLength(4);
    expect(group!.detail).toBe("d1");
  });

  it("keeps findings about different segments apart", () => {
    const groups = groupFindings([
      finding({ kind: "below_minimum_cacheable", requestIndex: 0, segmentIds: ["system[0]"] }),
      finding({ kind: "below_minimum_cacheable", requestIndex: 0, segmentIds: ["messages[0].content[0]"] }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("does not apply an exact-duplicate claim to similar text at the same paths in another request", () => {
    const segmentIds = ["messages[1].content[0]", "messages[3].content[0]"];
    const groups = groupFindings([
      finding({ kind: "duplicate_content", requestIndex: 0, segmentIds, title: "Identical text appears in 2 segments" }),
      finding({ kind: "duplicate_content", requestIndex: 1, segmentIds, title: "Similar text appears in 2 segments" }),
    ]);
    expect(groups.map(group => group.title)).toEqual(["Identical text appears in 2 segments", "Similar text appears in 2 segments"]);
    expect(groups.map(group => group.requestIndices)).toEqual([[0], [1]]);
  });

  it("orders groups by severity, then first occurrence", () => {
    const groups = groupFindings([
      finding({ kind: "duplicate_content", severity: "info", requestIndex: 0 }),
      finding({ kind: "no_cache_control", severity: "warning", requestIndex: 3 }),
      finding({ kind: "tools_reordered", severity: "error", requestIndex: 5, title: "Tools reordered between requests 5 and 6" }),
      finding({ kind: "missing_tail_breakpoint", severity: "warning", requestIndex: 1 }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["tools_reordered", "missing_tail_breakpoint", "no_cache_control", "duplicate_content"]);
  });

  it("drops a request-pair title once the group spans several pairs", () => {
    const groups = groupFindings([
      finding({ kind: "tools_reordered", requestIndex: 2, title: "Tools reordered between requests 2 and 3" }),
      finding({ kind: "tools_reordered", requestIndex: 7, title: "Tools reordered between requests 7 and 8" }),
    ]);
    expect(groups[0]!.title).toBe("Tools reordered between requests");
  });
});

describe("describeRequestIndices", () => {
  it.each([
    [[], ""],
    [[0], "request 1"],
    [[1, 2, 3, 4], "requests 2–5"],
    [[1, 2], "requests 2, 3"],
    [[1, 4, 6, 7, 8], "requests 2, 5, 7–9"],
    [[3, 1, 1, 2], "requests 2–4"],
  ])("%j -> %s", (indices, expected) => {
    expect(describeRequestIndices(indices)).toBe(expected);
  });
});
