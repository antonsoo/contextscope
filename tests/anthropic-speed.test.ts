import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { simulateAnthropicCacheSequence } from "../src/core/cache-anthropic.js";
import { prefixPaths } from "../src/core/threads.js";

const marker = { cache_control: { type: "ephemeral" } };
function body(speed?: unknown, model = "claude-opus-5-5", toolMarker = true) {
  return {
    model, ...(speed === undefined ? {} : { speed }),
    tools: [{ name: "lookup", input_schema: { type: "object" }, ...(toolMarker ? marker : {}) }],
    system: [{ type: "text", text: "Project guidance. ".repeat(500), ...marker }],
    messages: [{ role: "user", content: [{ type: "text", text: "Reference. ".repeat(500), ...marker }] }],
  };
}
function simulate(raw: unknown[], optimized = false, pricedModel?: string) {
  const requests = raw.map((r, i) => parseAnthropicRequest(r, i, () => ({ openai: 2000, claude: 2000 })));
  return simulateAnthropicCacheSequence(requests, prefixPaths(requests, optimized), pricedModel, optimized);
}

describe("Anthropic speed scopes and input prices", () => {
  it.each([false, true])("preserves only marked tools across speed changes (optimized=%s)", (optimized) => {
    const steps = simulate([body(), body("fast"), body("standard"), body("fast")], optimized);
    expect(steps.map((s) => [s.readTokens, s.writeTokens5m, s.speed, s.inputPriceMultiplier]))
      .toEqual([[0, 6000, "standard", 1], [2000, 4000, "fast", 2], [6000, 0, "standard", 1], [6000, 0, "fast", 2]]);
    // Opus 5.5: standard $4/M input, 5m writes 1.25x, reads 0.05x.
    expect(steps[1]!.costUsd).toBeCloseTo((2000 * 0.05 + 4000 * 1.25) * 8 / 1e6, 12);
    expect(steps[3]!.costUsd).toBeCloseTo(6000 * 0.4 / 1e6, 12);
  });

  it("does not invent a tools entry inside a marked system prefix", () => {
    expect(simulate([body(undefined, undefined, false), body("fast", undefined, false), body(undefined, undefined, false)]).map((s) => s.readTokens)).toEqual([0, 0, 6000]);
  });

  it("combines speed and tool-choice partitions without losing reusable systems", () => {
    const a = body("fast"), b = { ...body("fast"), tool_choice: { type: "none" } };
    expect(simulate([a, b, { ...b, speed: "standard" }, a]).map((s) => s.readTokens)).toEqual([0, 4000, 2000, 6000]);
  });

  it("applies the premium to 1h writes and uncached input too", () => {
    const a = body("fast");
    // Replace marker objects without changing the other requests' fixtures.
    a.tools[0]!.cache_control = { type: "ephemeral", ...{ ttl: "1h" } };
    a.system[0]!.cache_control = { type: "ephemeral", ...{ ttl: "1h" } };
    a.messages[0]!.content[0]!.cache_control = { type: "ephemeral" };
    const step = simulate([a])[0]!;
    expect([step.writeTokens1h, step.writeTokens5m]).toEqual([4000, 2000]);
    expect(step.costUsd).toBeCloseTo((4000 * 2 + 2000 * 1.25) * 8 / 1e6, 12);
    const unmarked = { ...a, tools: [], system: [], messages: [{ role: "user", content: "Uncached request" }] };
    expect(simulate([unmarked])[0]).toMatchObject({ readTokens: 0, uncachedTokens: 2000, costUsd: 0.016 });
  });

  it.each(["claude-opus-5", "claude-opus-4-8-20260901"])("prices %s fast input at $10/M", (model) => {
    expect(simulate([body("fast", model)])[0]!.costUsd).toBeCloseTo(6000 * 12.5 / 1e6, 12);
  });

  it("models the current Opus 4.6 fallback using standard cache and prices", () => {
    const steps = simulate([body(undefined, "claude-opus-4-6"), body("fast", "claude-opus-4-6@20260205")]);
    expect(steps[1]).toMatchObject({ speed: "standard", readTokens: 6000, inputPriceMultiplier: 1 });
    expect(steps[1]!.costUsd).toBeCloseTo(0.003, 12);
    const result = analyze(JSON.stringify([body("fast", "claude-opus-4-6")]));
    expect(result.findings.some((f) => f.kind === "anthropic_speed" && f.title.includes("standard speed"))).toBe(true);
  });

  it.each(["claude-sonnet-4-5", "unknown-model"])("does not price unsupported fast combination %s", (model) => {
    const result = analyze(JSON.stringify([body("fast", model)]));
    expect(result.cacheSimulation.actual[0]!.costUsd).toBeUndefined();
    expect(result.cacheSimulation.totalActualCostUsd).toBeUndefined();
    expect(result.findings.some((f) => f.kind === "anthropic_speed" && f.severity === "warning")).toBe(true);
  });

  it("keeps unrecognized speed values distinct and unpriced", () => {
    const steps = simulate([body("turbo"), body("invalid"), body("turbo")]);
    expect(steps.map((s) => s.readTokens)).toEqual([0, 2000, 6000]);
    expect(steps.every((s) => s.speed === "unrecognized" && s.costUsd === undefined)).toBe(true);
  });

  it("preserves captured model identity when pricing is overridden", () => {
    const steps = simulate([body("fast"), body("fast", "claude-opus-5")], false, "claude-opus-4-8");
    expect(steps.map((s) => s.readTokens)).toEqual([0, 0]);
    for (const step of steps) expect(step.costUsd).toBeCloseTo(0.075, 12);
  });

  it("retains byte-matching evidence and explains both cache levels and pricing", () => {
    const result = analyze(JSON.stringify([body(), body("fast"), body()]));
    expect(result.prefixMatches.every((m) => m.matchedSegments === 3)).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "anthropic_speed_cache_scope", requestIndex: 1 }));
    expect(result.findings).toContainEqual(expect.objectContaining({ kind: "anthropic_speed", title: "Fast input pricing", requestIndex: 1 }));
  });
});
