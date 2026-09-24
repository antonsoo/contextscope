import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";

function kinds(result: ReturnType<typeof analyze>) {
  return result.findings.map((f) => f.kind);
}

describe("findings (via analyze())", () => {
  it("flags a timestamp that changes every request as volatile_prefix", () => {
    const requests = [0, 1].map((n) => ({
      model: "claude-sonnet-5",
      system: `Current time: 2026-09-24T10:0${n}:00Z. You are helpful.`,
      messages: [{ role: "user", content: `turn ${n}` }],
    }));
    const result = analyze(JSON.stringify(requests));
    expect(kinds(result)).toContain("volatile_prefix");
  });

  it("flags reordered tools between two requests", () => {
    const tool = (name: string) => ({ name, description: "d", input_schema: { type: "object" } });
    const requests = [
      { model: "claude-sonnet-5", tools: [tool("a"), tool("b")], messages: [{ role: "user", content: "hi" }] },
      { model: "claude-sonnet-5", tools: [tool("b"), tool("a")], messages: [{ role: "user", content: "hi" }] },
    ];
    const result = analyze(JSON.stringify(requests));
    expect(kinds(result)).toContain("tools_reordered");
  });

  it("flags a tool schema whose key order changed but content did not", () => {
    const requests = [
      { model: "claude-sonnet-5", tools: [{ name: "t", description: "d", input_schema: { type: "object" } }], messages: [{ role: "user", content: "hi" }] },
      { model: "claude-sonnet-5", tools: [{ input_schema: { type: "object" }, description: "d", name: "t" }], messages: [{ role: "user", content: "hi" }] },
    ];
    const result = analyze(JSON.stringify(requests));
    expect(kinds(result)).toContain("tool_schema_key_order");
  });

  it("flags a request with no cache_control at all in a multi-request sequence", () => {
    const longSystem = "You are a careful assistant. ".repeat(200);
    const requests = [0, 1].map((n) => ({ model: "claude-sonnet-5", system: longSystem, messages: [{ role: "user", content: `turn ${n}` }] }));
    const result = analyze(JSON.stringify(requests));
    expect(kinds(result)).toContain("no_cache_control");
  });

  it("flags a breakpoint below the model's minimum cacheable length", () => {
    const requests = [{ model: "claude-sonnet-5", system: [{ type: "text", text: "short", cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: "hi" }] }];
    const result = analyze(JSON.stringify(requests));
    expect(kinds(result)).toContain("below_minimum_cacheable");
  });

  it("flags near-duplicate content repeated across tool results within one request's history", () => {
    const bigFile = Array.from({ length: 200 }, (_, i) => `line ${i} of a fairly large repeated file`).join("\n");
    const messages = [0, 1, 2].flatMap((i) => [
      { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: bigFile }] },
    ]);
    const result = analyze(JSON.stringify([{ model: "claude-sonnet-5", messages }]));
    expect(kinds(result)).toContain("duplicate_content");
    const finding = result.findings.find((f) => f.kind === "duplicate_content")!;
    expect(finding.title).toMatch(/appears 3 times/);
  });

  it("produces no findings for a well-behaved, fully-cached, deduplicated sequence", () => {
    const longSystem = [{ type: "text", text: "You are a careful, deterministic assistant. ".repeat(200), cache_control: { type: "ephemeral" } }];
    const requests = [0, 1, 2].map((n) => ({ model: "claude-sonnet-5", system: longSystem, messages: [{ role: "user", content: `turn ${n}` }] }));
    const result = analyze(JSON.stringify(requests));
    expect(result.findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });

  // --- missing_tail_breakpoint: a breakpoint exists (system prompt) and isn't volatile, but
  // never advances to cover the growing conversation - every turn re-sends prior turns uncached.
  // This is the exact "fixed but not actually fixed" shape a bug report caught: no other finding
  // explained a large, real gap between actual and optimized cost.

  function growingToolResultRequests(n: number, { rollingBreakpoint }: { rollingBreakpoint: boolean }) {
    const longSystem = [{ type: "text", text: "You are a careful, deterministic assistant. ".repeat(200), cache_control: { type: "ephemeral" } }];
    const bigChunk = "some tool output content that is reasonably long. ".repeat(20); // ~250 tokens
    const messages: Record<string, unknown>[] = [];
    const requests = [];
    for (let i = 0; i < n; i++) {
      messages.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "read_file", input: {} }] });
      const toolResultBlock: Record<string, unknown> = { type: "tool_result", tool_use_id: `t${i}`, content: `${bigChunk}${i}` };
      messages.push({ role: "user", content: [toolResultBlock] });
      if (rollingBreakpoint) toolResultBlock["cache_control"] = { type: "ephemeral" };
      requests.push({ model: "claude-sonnet-5", system: longSystem, messages: JSON.parse(JSON.stringify(messages)) });
    }
    return requests;
  }

  it("flags a missing rolling breakpoint on the conversation tail when history keeps resending uncached", () => {
    const result = analyze(JSON.stringify(growingToolResultRequests(6, { rollingBreakpoint: false })));
    expect(kinds(result)).toContain("missing_tail_breakpoint");
    const finding = result.findings.find((f) => f.kind === "missing_tail_breakpoint")!;
    expect(finding.detail).toMatch(/uncached/);
  });

  it("does not flag missing_tail_breakpoint once a rolling breakpoint covers the tail", () => {
    const result = analyze(JSON.stringify(growingToolResultRequests(6, { rollingBreakpoint: true })));
    expect(kinds(result)).not.toContain("missing_tail_breakpoint");
  });

  it("keeps the cost line and findings in agreement: material savings always come with a finding", () => {
    const result = analyze(JSON.stringify(growingToolResultRequests(6, { rollingBreakpoint: false })));
    const { totalActualCostUsd, totalOptimizedCostUsd } = result.cacheSimulation;
    expect(totalActualCostUsd).toBeDefined();
    expect(totalOptimizedCostUsd).toBeDefined();
    const ratio = (totalActualCostUsd! - totalOptimizedCostUsd!) / totalActualCostUsd!;
    expect(ratio).toBeGreaterThan(0.1); // this fixture is deliberately not optimal
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("shows no material savings once the rolling breakpoint is added, matching the empty findings list", () => {
    const result = analyze(JSON.stringify(growingToolResultRequests(6, { rollingBreakpoint: true })));
    const { totalActualCostUsd, totalOptimizedCostUsd } = result.cacheSimulation;
    expect(totalActualCostUsd).toBeCloseTo(totalOptimizedCostUsd!, 6);
    expect(result.findings).toHaveLength(0);
  });
});
