import { describe, expect, it, vi } from "vitest";
import { analyze, parseInput, toJsonReport } from "../src/core/index.js";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";
import { computePrefixMatch } from "../src/core/prefix.js";
import { renderHtmlReport } from "../src/cli/html-report.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";

const body = (controls: Record<string, unknown> = {}) => ({ model: "gpt-5.1", input: "Retained visible text. ".repeat(1200), ...controls });

describe("Responses context outside the captured body", () => {
  it.each([
    ["previous_response_id", "resp_controlled", "previous_response"],
    ["conversation", "conv_controlled", "conversation"],
    ["conversation", { id: "conv_controlled" }, "conversation"],
    ["prompt", { id: "pmpt_controlled", version: "2", variables: { subject: "reference" } }, "prompt_template"],
  ])("retains %s as an unknown unit without tokenizing its ID or losing visible text", (path, raw, kind) => {
    const counter = vi.fn(() => ({ openai: 50, claude: 60 }));
    const request = parseOpenAiRequest(body({ [path]: raw }), 0, counter);
    expect(counter.mock.calls).toHaveLength(1);
    expect(request.segments[0]).toMatchObject({ path, raw, category: "reference", text: "", charLength: 0,
      openaiTokens: null, claudeTokensEstimate: null, unmodeledContext: kind });
    expect(request.segments[1]!.openaiTokens).toBe(50);
    expect(request.segments[0]!.prefix!.content).toEqual(raw);
  });

  it.each([undefined, null, "item_reference"])("retains the SDK ItemReference with type %s, including a reference-only request", type => {
    const item = { id: "msg_controlled", ...(type === undefined ? {} : { type }) };
    const result = analyze(JSON.stringify({ body: { model: "gpt-5.1", input: [item] } }));
    expect(result.parse).toMatchObject({ complete: true, skippedRecords: 0, envelope: "body" });
    expect(result.reports[0]!.segments).toHaveLength(1);
    expect(result.reports[0]!.segments[0]).toMatchObject({ path: "input[0]", raw: item, unmodeledContext: "item_reference" });
    expect(result.reports[0]!.totals.openaiTokens).toBeNull();
  });

  it("unwraps prompt-only records and refuses malformed or conflicting references", () => {
    const result = analyze(JSON.stringify({ request_body: JSON.stringify({ prompt: { id: "pmpt_controlled" } }) }));
    expect(result.parse).toMatchObject({ format: "openai", complete: true, envelope: "request_body" });
    expect(result.reports[0]!.totals.openaiTokens).toBeNull();
    for (const controls of [{ previous_response_id: 42 }, { conversation: {} }, { prompt: "pmpt_controlled" },
      { input: [{ type: "item_reference" }] }, { previous_response_id: "  " }]) {
      expect(() => analyze(JSON.stringify(body(controls)))).toThrow(/nonempty string/);
    }
    expect(() => analyze(JSON.stringify(body({ previous_response_id: "resp_a", conversation: "conv_a" })))).toThrow(/cannot combine/);
  });

  it("cannot establish full prompt equality by normalizing opaque identifiers", () => {
    const a = parseOpenAiRequest(body({ previous_response_id: "resp_5bb2d5a1-b5de-4b05-91a4-8b83da6d5ddd" }), 0);
    const b = parseOpenAiRequest(body({ previous_response_id: "resp_7c2d1f20-9c83-49be-ab84-c632e73d14e7" }), 1);
    for (const optimized of [false, true]) {
      const match = computePrefixMatch(a, b, optimized);
      expect(match.matchedSegments).toBe(0);
      expect(match.diff.some(line => line.text.includes("unresolved context"))).toBe(true);
      expect(match.diff.some(line => line.text.includes("prompt metadata or message boundary changed"))).toBe(false);
    }
    expect(computePrefixMatch(a, a).matchedOpenaiTokens).toBeNull();
  });

  it("withholds the entire cache sequence while retaining ordinary requests and captured zero reads", () => {
    const result = analyze(JSON.stringify([body(), { request: body({ previous_response_id: "resp_controlled" }), response: {
      usage: { input_tokens: 12000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10, total_tokens: 12010 },
    } }, body()]));
    expect(result.reports[0]!.totals.openaiTokens).toBeGreaterThan(1024);
    expect(result.reports[1]!.totals).toEqual({ openaiTokens: null, claudeTokensEstimate: null });
    expect(result.reports[1]!.percentOfContextWindow).toBeUndefined();
    expect(result.reports[2]!.totals).toEqual(result.reports[0]!.totals);
    for (const steps of [result.cacheSimulation.actual, result.cacheSimulation.optimized]) for (const step of steps) {
      expect(step).toMatchObject({ readTokens: null, writeTokens5m: null, writeTokens1h: null, uncachedTokens: null });
      expect(step.costUsd).toBeUndefined();
      expect(step.unavailableReason).toContain("Stored or opaque context");
    }
    expect(result.usageComparison.rows[1]).toMatchObject({ reportedInputTokens: 12000, reportedReadTokens: 0,
      estimatedInputTokens: null, simulatedReadTokens: null, inputDeltaTokens: null, readDeltaTokens: null, readOutcome: "unavailable" });
    const json = toJsonReport(result);
    expect(json).toContain('"unmodeledContext": "previous_response"');
    expect(json).not.toContain("resp_controlled");
    for (const output of [renderHtmlReport(result), renderTerminalReport(result, { verbose: true })]) {
      expect(output).toContain("Stored or opaque context");
      expect(output).not.toMatch(/NaN|Infinity|would save/);
    }
  });

  it.each(["reasoning", "compaction"])("keeps %s history opaque instead of charging for its serialized transport", type => {
    const item = { type, id: "controlled", summary: [{ type: "summary_text", text: "Visible summary" }], encrypted_content: "opaque".repeat(400) };
    const counter = vi.fn(() => ({ openai: 1, claude: 1 }));
    const request = parseOpenAiRequest(body({ input: [item] }), 0, counter);
    expect(counter).not.toHaveBeenCalled();
    expect(request.segments[0]).toMatchObject({ raw: item, unmodeledContext: type, openaiTokens: null });
  });

  it("does not interpret quoted controls, metadata, storage flags or inline message IDs as stored input", () => {
    const ordinary = body({ input: [{ id: "msg_inline", role: "user", content: JSON.stringify({ type: "item_reference", id: "msg_quoted" }) }] });
    const reports = [ordinary, { ...ordinary, store: false, previous_response_id: null, conversation: null, prompt: null,
      metadata: { previous_response_id: "resp_metadata" } }].map(raw => analyze(JSON.stringify(raw)));
    expect(reports[0]!.reports[0]!.totals.openaiTokens).toBeGreaterThan(0);
    expect(reports[1]!.reports).toEqual(reports[0]!.reports);
    expect(reports[1]!.cacheSimulation).toEqual(reports[0]!.cacheSimulation);
  });

  it("does not count a native response's echoed tools as another request", () => {
    const response = { object: "response", id: "resp_controlled", model: "gpt-5.1", output: [], tools: [{ type: "function", name: "lookup" }],
      previous_response_id: "resp_prior", usage: { input_tokens: 12000 } };
    const parsed = parseInput(JSON.stringify([body(), response]));
    expect(parsed).toMatchObject({ complete: false, skippedRecords: 1 });
    expect(parsed.requests[1]!.segments).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.requests[1]!.reportedUsage).toBeUndefined();
  });
});
