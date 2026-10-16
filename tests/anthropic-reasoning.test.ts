import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";
import { anthropicPositions, lastCacheableSegment } from "../src/core/anthropic-breakpoints.js";
import { anthropicReasoningKey } from "../src/core/anthropic-reasoning.js";
import { simulateAnthropicCacheSequence } from "../src/core/cache-anthropic.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { prefixPaths } from "../src/core/threads.js";

const marker = { cache_control: { type: "ephemeral" } };
function body(settings: Record<string, unknown> = {}) {
  return {
    model: "claude-sonnet-4-6",
    tools: [{ name: "lookup", input_schema: { type: "object" }, ...marker }],
    system: [{ type: "text", text: "Stable instructions. ".repeat(300), ...marker }],
    messages: [{ role: "user", content: [{ type: "text", text: "Stable reference. ".repeat(300), ...marker }] }],
    ...settings,
  };
}
function parsed(raw: unknown, index = 0) {
  // Count nonempty blocks independently of the production tokenizer. Empty
  // structural headers have no invented text token cost.
  return parseAnthropicRequest(raw, index, (text) => ({ openai: text ? 1500 : 0, claude: text ? 1500 : 0 }));
}
function steps(raw: unknown[], optimized = false, pricedModel?: string) {
  const requests = raw.map(parsed);
  return simulateAnthropicCacheSequence(requests, prefixPaths(requests, optimized), pricedModel, optimized);
}

describe("Claude thinking and effort cache scopes", () => {
  it.each([false, true])("conservatively isolates every level, retaining older scopes (optimized=%s)", (optimized) => {
    const a = body({ thinking: { type: "enabled", budget_tokens: 2048 } });
    const b = body({ thinking: { type: "enabled", budget_tokens: 4096 } });
    const result = steps([a, b, a, b], optimized);
    expect(result.map((s) => [s.readTokens, s.writeTokens5m])).toEqual([[0, 4500], [0, 4500], [4500, 0], [4500, 0]]);
    expect(result.every((s) => s.readTokens + s.writeTokens5m + s.writeTokens1h + s.uncachedTokens === 4500)).toBe(true);
    expect(result[1]!.costUsd).toBeCloseTo(4500 * 3 * 1.25 / 1_000_000, 12);
  });

  it.each([false, true])("isolates effort with or without thinking (optimized=%s)", (optimized) => {
    for (const thinking of [undefined, { type: "adaptive" }]) {
      const a = body({ thinking, output_config: { effort: "high" } });
      const b = body({ thinking, output_config: { effort: "low" } });
      expect(steps([a, b, a], optimized).map((s) => s.readTokens)).toEqual([0, 0, 4500]);
    }
  });

  it.each([
    ["claude-opus-5-5", "adaptive", "medium"],
    ["claude-sonnet-5-5", "adaptive", "high"],
    ["claude-opus-4-6", "disabled", "high"],
    ["claude-sonnet-4-6-20260101", "disabled", "high"],
    ["us.anthropic.claude-opus-4-6-v1:0", "disabled", "high"],
  ])("normalizes documented defaults from recorded %s", (model, type, effort) => {
    const a = body({ model }), b = body({ model, thinking: { type }, output_config: { effort } });
    expect(steps([a, b]).map((s) => s.readTokens)).toEqual([0, 4500]);
  });

  it("does not borrow default settings from a price override or fallback", () => {
    for (const model of [undefined, "custom-claude-model", "constructor", "__proto__"]) {
      const a = body({ model }), b = body({ model, thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
      expect(steps([a, b], false, "claude-opus-5-5").map((s) => s.readTokens)).toEqual([0, 0]);
      expect(steps([a, a], false, "claude-opus-5-5").map((s) => s.readTokens)).toEqual([0, 4500]);
    }
  });

  it("compares settings canonically without normalizing away unknown values", () => {
    const a = body({ thinking: { type: "enabled", budget_tokens: 2048 } });
    const b = body({ thinking: { budget_tokens: 2048, type: "enabled" } });
    expect(steps([a, b]).map((s) => s.readTokens)).toEqual([0, 4500]);
    const key = (thinking: unknown) => anthropicReasoningKey(parsed(body({ thinking })));
    expect(key({ type: "future", option: "a" })).not.toBe(key({ type: "future", option: "b" }));
    expect(key(null)).not.toBe(key(undefined));
  });

  it("leaves response display, maximum output and unrelated output fields outside reasoning scope", () => {
    const a = body({ thinking: { type: "enabled", budget_tokens: 2048, display: "summarized" } });
    const b = body({ thinking: { type: "enabled", budget_tokens: 2048, display: "omitted" }, max_tokens: 16000 });
    expect(steps([a, b]).map((s) => s.readTokens)).toEqual([0, 4500]);
    expect(anthropicReasoningKey(parsed(body({ output_config: { format: { type: "json_schema" } } }))))
      .toBe(anthropicReasoningKey(parsed(body())));
  });

  it("composes with speed and tool-choice scopes without losing earlier entries", () => {
    const a = body({ model: "claude-opus-5-5", output_config: { effort: "medium" } });
    const b = { ...a, speed: "fast" };
    const c = { ...b, tool_choice: { type: "any" } };
    const d = { ...c, output_config: { effort: "high" } };
    expect(steps([a, b, c, d, a, b]).map((s) => s.readTokens)).toEqual([0, 1500, 3000, 0, 4500, 4500]);
  });

  it("keeps 1h and 5m writes disjoint after a reasoning change", () => {
    const a = body(), b = body({ output_config: { effort: "low" } });
    for (const request of [a, b]) request.system[0]!.cache_control = { type: "ephemeral", ttl: "1h" } as typeof marker.cache_control;
    // One-hour markers must precede shorter markers.
    for (const request of [a, b]) delete (request.tools[0] as { cache_control?: unknown }).cache_control;
    expect(steps([a, b]).map((s) => [s.readTokens, s.writeTokens1h, s.writeTokens5m]))
      .toEqual([[0, 3000, 1500], [0, 3000, 1500]]);
  });

  it("explains conservative setup handling while keeping content matches intact", () => {
    const a = body(), b = body({ thinking: { type: "enabled", budget_tokens: 2048 } });
    const result = analyze(JSON.stringify([a, b, a]));
    expect(result.prefixMatches.every((m) => m.matchedSegments === 3)).toBe(true);
    expect(result.findings.find((f) => f.kind === "anthropic_reasoning_cache_scope"))
      .toMatchObject({ requestIndex: 1, severity: "info", title: "Thinking or effort cache settings changed" });
    expect(result.findings.find((f) => f.kind === "anthropic_reasoning_cache_scope")!.detail).toContain("model-specific");
    expect(analyze(JSON.stringify([a, a])).findings.some((f) => f.kind === "anthropic_reasoning_cache_scope")).toBe(false);
  });
});

describe("Claude empty message boundaries and per-message effort", () => {
  function history(effort: string) {
    const base = body({ model: "claude-opus-5-5" });
    delete (base.tools[0] as { cache_control?: unknown }).cache_control;
    return { ...base, messages: [...base.messages,
      { role: "assistant", content: "I will check." },
      { role: "system", content: [], output_config: { effort } },
      { role: "user", content: [{ type: "text", text: "Continue.", ...marker }] }] };
  }

  it.each([false, true])("preserves the prefix before an edited effort message (optimized=%s)", (optimized) => {
    const a = history("high"), b = history("low");
    expect(steps([a, b, a], optimized).map((s) => s.readTokens)).toEqual([0, 4500, 7500]);
    const parsedA = parsed(a);
    const header = parsedA.segments.find((s) => s.path === "messages[2].content")!;
    expect(header).toMatchObject({ raw: a.messages[2], text: "", claudeTokensEstimate: 0 });
    expect(anthropicReasoningKey(parsedA)).toBe(anthropicReasoningKey(parsed(b)));
  });

  it("does not invent a lookup position or cache marker on an empty effort-only tail", () => {
    const a = history("low"); a.messages.pop();
    Object.assign(a, { cache_control: { type: "ephemeral" } });
    const request = parsed(a);
    expect(anthropicPositions(request.segments)).toEqual([0, 1, 2, 3, 3]);
    expect(lastCacheableSegment(request.segments)).toBe(3);
    expect(request.segments.at(-1)!.cacheControl).toBeUndefined();
    expect(request.segments[3]!.cacheControl?.automatic).toBe(true);
  });

  it.each([[], "", null])("retains an empty %j message's changed role", (content) => {
    const a = body({ messages: [{ role: "user", content }] });
    const b = body({ messages: [{ role: "assistant", content }] });
    const x = parsed(a), y = parsed(b);
    expect(x.segments.at(-1)!.prefix).not.toEqual(y.segments.at(-1)!.prefix);
    expect(x.segments.at(-1)!.claudeTokensEstimate).toBe(0);
    expect(lastCacheableSegment(x.segments)).toBe(1);
  });
});
