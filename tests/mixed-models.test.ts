import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";
import { toJsonReport } from "../src/core/json-report.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";
import { renderHtmlReport } from "../src/cli/html-report.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { simulateAnthropicCacheSequence } from "../src/core/cache-anthropic.js";
import { prefixPaths } from "../src/core/threads.js";
import type { CacheSimStep } from "../src/core/types.js";

const reference = "Reference material for the assistant, kept verbatim. ".repeat(230);
const body = (model: string | undefined, turn = 0) => ({
  model, max_tokens: 64,
  system: [{ type: "text", text: reference, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: `task ${turn}` }],
});
const sequence = ["claude-sonnet-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "claude-opus-4-5", "claude-sonnet-4-5"].map(body);
const accounting = ({ requestIndex: _index, ...step }: CacheSimStep) => step;

describe("per-request model accounting", () => {
  it("does not let the majority model lower another model's cache minimum", () => {
    // Exactly 2,000 tokens per block. The one marked system block is too short for Opus.
    const requests = sequence.map((raw, i) => parseAnthropicRequest(raw, i, () => ({ openai: 2000, claude: 2000 })));
    const steps = simulateAnthropicCacheSequence(requests, prefixPaths(requests, false), undefined, false);
    expect(steps.map((s) => [s.readTokens, s.writeTokens5m, s.uncachedTokens]))
      .toEqual([[0, 2000, 2000], [2000, 0, 2000], [0, 0, 4000], [0, 0, 4000], [2000, 0, 2000]]);
    expect(steps.map((s) => s.costUsd)).toEqual([0.0135, 0.0066, 0.02, 0.02, 0.0066]);
  });

  it("gives the same accounting when histories from different models are interleaved", () => {
    const mixed = analyze(JSON.stringify(sequence));
    for (const model of new Set(sequence.map((r) => r.model))) {
      const isolated = analyze(JSON.stringify(sequence.filter((r) => r.model === model)));
      for (const scenario of ["actual", "optimized"] as const) {
        expect(mixed.cacheSimulation[scenario].filter((_, i) => sequence[i]!.model === model).map(accounting))
          .toEqual(isolated.cacheSimulation[scenario].map(accounting));
      }
    }
    expect(mixed.reports.map((r) => r.model.id)).toEqual(sequence.map((r) => r.model));
    expect(mixed.findings.filter((f) => f.kind === "below_minimum_cacheable").map((f) => f.requestIndex)).toEqual([2, 3]);
    expect(mixed.findings.find((f) => f.kind === "below_minimum_cacheable")?.detail).toContain("Claude Opus 4.5's 4,096");
  });

  it("uses per-request context windows, including a minority older model", () => {
    const result = analyze(JSON.stringify([body("claude-sonnet-5-5"), body("claude-sonnet-5-5"), body("claude-opus-4-5")]));
    expect(result.reports.map((r) => r.contextWindow)).toEqual([1_000_000, 1_000_000, 200_000]);
    expect(result.reports[2]!.percentOfContextWindow).toBe(result.reports[2]!.totals.claudeTokensEstimate / 200_000);
  });

  it("keeps an explicit pricing/rules override separate from recorded cache identity", () => {
    const result = analyze(JSON.stringify(sequence), { model: "claude-sonnet-4-5" });
    expect(result.reports.every((r) => r.model.id === "claude-sonnet-4-5" && r.model.source === "option")).toBe(true);
    expect(result.cacheSimulation.actual.map((s) => s.readTokens > 0)).toEqual([false, true, false, true, true]);
    expect(result.findings.filter((f) => f.kind === "below_minimum_cacheable")).toHaveLength(0);
  });

  it.each(["anthropic", "openai"] as const)("isolates missing model names in %s logs", (provider) => {
    const models = provider === "anthropic" ? ["claude-sonnet-4-5", undefined, "claude-opus-5", undefined] : ["gpt-6-sol", undefined, "gpt-6-luna", undefined];
    const requests = models.map((model) => provider === "anthropic" ? body(model) : { model, messages: [{ role: "user", content: reference }] });
    const result = analyze(JSON.stringify(requests));
    expect(result.cacheSimulation.actual.map((s) => s.readTokens > 0)).toEqual([false, false, false, true]);
    expect(result.reports[1]!.model.source).toBe("default");
    expect(result.findings.filter((f) => f.kind === "model_switch").every((f) => !f.detail.includes("undefined"))).toBe(true);
  });

  it("prices each OpenAI row independently within the documented legacy simulation", () => {
    const models = ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-6-astra"];
    const requests = models.map((model) => ({ model, messages: [{ role: "user", content: reference }] }));
    const result = analyze(JSON.stringify(requests));
    for (const model of new Set(models)) {
      const isolated = analyze(JSON.stringify(requests.filter((r) => r.model === model)));
      expect(result.cacheSimulation.actual.filter((_, i) => models[i] === model).map(accounting))
        .toEqual(isolated.cacheSimulation.actual.map(accounting));
    }
  });

  it("retains minority unknown models and fallbacks in every report format", () => {
    const unknown = '<unknown-model>&"';
    const result = analyze(JSON.stringify([body("claude-sonnet-4-5"), body("claude-sonnet-4-5"), body(unknown)]));
    expect(result.reports[2]!.model).toMatchObject({ id: "claude-sonnet-5-5", source: "default", unrecognized: unknown });
    const json = JSON.parse(toJsonReport(result));
    expect(json.reports[2].model.unrecognized).toBe(unknown);
    expect(renderTerminalReport(result)).toContain(`"${unknown}" is not in the pricing table`);
    const html = renderHtmlReport(result);
    expect(html).toContain("&lt;unknown-model&gt;&amp;&quot;");
    expect(html).not.toContain(unknown);
  });

  it("does not claim a return to a warm model pays full input price", () => {
    const result = analyze(JSON.stringify([body("claude-sonnet-4-5"), body("claude-opus-5"), body("claude-sonnet-4-5")]));
    expect(result.cacheSimulation.actual[2]!.readTokens).toBeGreaterThan(0);
    for (const finding of result.findings.filter((f) => f.kind === "model_switch")) {
      expect(finding.detail).not.toContain("at full price");
      expect(finding.detail).toContain("can still reuse");
    }
  });
});
