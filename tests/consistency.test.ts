import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";

// Findings and the simulation must tell the same story: whatever a finding says breaks the cache
// has to show up as a miss in the actual simulation and as a saving in the optimized one.
const system = [{ type: "text", text: "Stable instructions for the agent. ".repeat(200), cache_control: { type: "ephemeral" } }];

describe("findings agree with the cache simulation", () => {
  it("a tool schema whose key order drifts is a miss, and fixing it is a saving", () => {
    const schemaA = { name: "search", description: "Search the docs.", input_schema: { type: "object", properties: { q: { type: "string" } } } };
    const schemaB = { input_schema: { properties: { q: { type: "string" } }, type: "object" }, description: "Search the docs.", name: "search" };
    const result = analyze(
      JSON.stringify([
        { model: "claude-opus-5", tools: [schemaA], system, messages: [{ role: "user", content: "one" }] },
        { model: "claude-opus-5", tools: [schemaB], system, messages: [{ role: "user", content: "two" }] },
      ]),
    );
    expect(result.findings.map((f) => f.kind)).toContain("tool_schema_key_order");
    expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
    expect(result.cacheSimulation.optimized[1]!.readTokens).toBeGreaterThan(0);
    expect(result.cacheSimulation.totalOptimizedCostUsd!).toBeLessThan(result.cacheSimulation.totalActualCostUsd!);
  });

  it("reordered tools are a miss, and a sorted tool list is a saving (OpenAI)", () => {
    const tool = (name: string) => ({ type: "function", function: { name, description: `The ${name} tool. `.repeat(40), parameters: { type: "object" } } });
    const messages = [{ role: "system", content: "Stable instructions for the agent. ".repeat(200) }, { role: "user", content: "hi" }];
    const result = analyze(
      JSON.stringify([
        { model: "gpt-6-sol", tools: [tool("a"), tool("b")], messages },
        { model: "gpt-6-sol", tools: [tool("b"), tool("a")], messages },
      ]),
    );
    expect(result.findings.map((f) => f.kind)).toContain("tools_reordered");
    expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
    expect(result.cacheSimulation.optimized[1]!.readTokens).toBeGreaterThan(0);
  });

  it("a rolling breakpoint on a tool_use block does not break the prefix when it moves on", () => {
    const turn1 = [
      { role: "user", content: "Read the file." },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: { path: "a.txt" }, cache_control: { type: "ephemeral" } }] },
    ];
    const turn2 = [
      { role: "user", content: "Read the file." },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: { path: "a.txt" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "contents", cache_control: { type: "ephemeral" } }] },
    ];
    const result = analyze(JSON.stringify([{ model: "claude-opus-5", system, messages: turn1 }, { model: "claude-opus-5", system, messages: turn2 }]));
    const match = result.prefixMatches[0]!;
    expect(match.matchedSegments).toBe(result.parse.requests[0]!.segments.length);
    expect(result.findings.map((f) => f.kind)).not.toContain("breakpoint_before_change");
  });
});
