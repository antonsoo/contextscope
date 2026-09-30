import { describe, expect, it } from "vitest";
import { describeRequestIndices, groupFindings } from "../src/core/group-findings.js";
import type { Finding } from "../src/core/types.js";

function finding(partial: Partial<Finding> & Pick<Finding, "kind" | "requestIndex">): Finding {
  return { severity: "warning", title: "t", detail: `d${partial.requestIndex}`, segmentIds: [], ...partial };
}

describe("groupFindings", () => {
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
