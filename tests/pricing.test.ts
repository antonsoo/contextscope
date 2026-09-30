import { describe, expect, it } from "vitest";
import { ANTHROPIC_MODELS, OPENAI_MODELS, normalizeModelId, resolveModel } from "../src/core/pricing.js";
import { analyze } from "../src/core/analyze.js";

describe("normalizeModelId", () => {
  it.each([
    ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
    ["anthropic.claude-opus-5-5", "claude-opus-5-5"],
    ["us.anthropic.claude-sonnet-5-v1:0", "claude-sonnet-5"],
    ["global.anthropic.claude-sonnet-4-6", "claude-sonnet-4-6"],
    ["claude-opus-4-6@20260205", "claude-opus-4-6"],
    ["Claude-Opus-5", "claude-opus-5"],
    ["gpt-6-sol-2026-08-01", "gpt-6-sol"],
    ["claude-sonnet-5-5", "claude-sonnet-5-5"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeModelId(input)).toBe(expected);
  });
});

describe("model table", () => {
  it("has unique ids and only the documented minimum cacheable lengths", () => {
    const ids = ANTHROPIC_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of ANTHROPIC_MODELS) expect([512, 1024, 2048, 4096]).toContain(m.minCacheableTokens);
    expect(new Set(OPENAI_MODELS.map((m) => m.id)).size).toBe(OPENAI_MODELS.length);
  });

  it("encodes the two current exceptions to the 0.1x cache-read price", () => {
    const read = (id: string) => ANTHROPIC_MODELS.find((m) => m.id === id)!;
    expect(read("claude-opus-5-5").cacheReadMultiplier * read("claude-opus-5-5").inputPricePerMTok).toBeCloseTo(0.2);
    expect(read("claude-fable-5-1").cacheReadMultiplier * read("claude-fable-5-1").inputPricePerMTok).toBeCloseTo(0.25);
    expect(read("claude-sonnet-5-5").cacheReadMultiplier * read("claude-sonnet-5-5").inputPricePerMTok).toBeCloseTo(0.2);
  });
});

describe("resolveModel", () => {
  it("prefers an explicit option over the requests", () => {
    expect(resolveModel("anthropic", "claude-opus-5", ["claude-sonnet-5"])).toMatchObject({ id: "claude-opus-5", source: "option" });
  });

  it("uses the model named most often in the requests", () => {
    const r = resolveModel("anthropic", undefined, ["claude-opus-4-8", "claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001"]);
    expect(r).toMatchObject({ id: "claude-haiku-4-5", source: "request" });
  });

  it("falls back to the default when nothing names a model", () => {
    expect(resolveModel("openai", undefined, [undefined, undefined])).toMatchObject({ id: "gpt-6-sol", source: "default" });
    expect(resolveModel("anthropic", "  ", [])).toMatchObject({ id: "claude-sonnet-5-5", source: "default" });
  });

  it("reports an id with no pricing entry instead of silently substituting", () => {
    const r = resolveModel("anthropic", undefined, ["claude-opus-9"]);
    expect(r).toMatchObject({ id: "claude-sonnet-5-5", source: "default", unrecognized: "claude-opus-9" });
  });
});

describe("analyze() prices with the model in the requests", () => {
  // ≈3,000 estimated tokens: above Claude Opus 5's 512-token minimum, below Claude Opus 4.6's 4,096.
  const system = "Reference material for the assistant, kept verbatim. ".repeat(230);
  const session = (model: string) =>
    JSON.stringify([0, 1].map((n) => ({ model, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: `turn ${n}` }] })));

  it("caches a ~3k-token prefix on Claude Opus 5", () => {
    const result = analyze(session("claude-opus-5"));
    expect(result.model).toMatchObject({ id: "claude-opus-5", source: "request" });
    expect(result.cacheSimulation.actual[1]!.readTokens).toBeGreaterThan(0);
    expect(result.findings.map((f) => f.kind)).not.toContain("below_minimum_cacheable");
  });

  it("does not cache the same prefix on Claude Opus 4.6, and says why", () => {
    const result = analyze(session("claude-opus-4-6"));
    expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
    const finding = result.findings.find((f) => f.kind === "below_minimum_cacheable");
    expect(finding?.detail).toContain("Claude Opus 4.6's 4,096-token minimum");
  });
});
