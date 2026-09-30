import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";

const system = [{ type: "text", text: "Stable reference material for the assistant. ".repeat(200), cache_control: { type: "ephemeral" } }];
const turn = (model: string, n: number) => ({ model, system, messages: [{ role: "user", content: `turn ${n}` }] });

describe("model switches", () => {
  it("reads nothing from the cache across a model change, and flags it", () => {
    const result = analyze(JSON.stringify([turn("claude-opus-5", 0), turn("claude-opus-5", 1), turn("claude-sonnet-5-5", 2), turn("claude-sonnet-5-5", 3)]));
    const reads = result.cacheSimulation.actual.map((s) => s.readTokens);
    expect(reads[1]).toBeGreaterThan(0);
    expect(reads[2]).toBe(0);
    expect(reads[3]).toBeGreaterThan(0);
    const switches = result.findings.filter((f) => f.kind === "model_switch");
    expect(switches.map((f) => f.requestIndex)).toEqual([2]);
    expect(switches[0]!.detail).toContain("claude-opus-5");
  });

  it("treats a dated snapshot and its alias as the same model", () => {
    const result = analyze(JSON.stringify([turn("claude-haiku-4-5-20251001", 0), turn("claude-haiku-4-5", 1)]));
    expect(result.findings.map((f) => f.kind)).not.toContain("model_switch");
  });

  it("applies to OpenAI's automatic cache as well", () => {
    const messages = [{ role: "system", content: "Stable reference material for the assistant. ".repeat(200) }, { role: "user", content: "hi" }];
    const result = analyze(JSON.stringify([{ model: "gpt-6-sol", messages }, { model: "gpt-6-luna", messages }]));
    expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
    expect(result.findings.map((f) => f.kind)).toContain("model_switch");
  });
});
