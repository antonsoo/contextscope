import { describe, expect, it } from "vitest";
import { analyze, parseInput, toJsonReport } from "../src/core/index.js";
import { renderHtmlReport } from "../src/cli/html-report.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";

const openai = { model: "gpt-5.2", messages: [{ role: "user", content: "private-prompt-marker" }] };
const anthropic = { model: "claude-sonnet-4-5", system: "Be concise.", messages: [{ role: "user", content: "private-prompt-marker" }] };
const chat = { prompt_tokens: 1200, prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens: 20, total_tokens: 1220 };
const capture = (usage: unknown, request: unknown = openai) => ({ request, response: { usage, content: "private-response-marker" } });
const parsed = (usage: unknown, request: unknown = openai) => parseInput(JSON.stringify(capture(usage, request))).requests[0]!.reportedUsage!;

describe("reported response usage", () => {
  it.each([
    ["Chat total includes cache reads", chat, openai, "openai-chat", 1200, 1024, null, 20],
    ["Responses total includes reads and writes", { input_tokens: 15000, input_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 }, output_tokens: 25, total_tokens: 15025 }, { model: "gpt-5.2", input: "hello" }, "openai-responses", 15000, 12000, 3000, 25],
    ["Anthropic input excludes both cache categories", { input_tokens: 50, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0, output_tokens: 25 }, anthropic, "anthropic", 100050, 100000, 0, 25],
    ["Anthropic writes retain both TTLs", { input_tokens: 17, cache_read_input_tokens: 4096, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } }, anthropic, "anthropic", 4413, 4096, 300, null],
    ["LiteLLM Claude cache reads survive ambiguous gateway totals", { prompt_tokens: 1500, completion_tokens: 40, total_tokens: 1540, cache_read_input_tokens: 1024, cache_creation_input_tokens: 200, prompt_tokens_details: { cached_tokens: 1024, cache_creation_tokens: 200, cache_creation_token_details: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 } } }, anthropic, "openai-chat", null, 1024, 200, 40],
    ["legacy LiteLLM creation can exceed its prompt_tokens", { prompt_tokens: 50, completion_tokens: 40, total_tokens: 90, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 }, anthropic, "openai-chat", null, 0, 2000, 40],
    ["zero creation removes the gateway ambiguity", { prompt_tokens: 1500, completion_tokens: 40, cache_read_input_tokens: 1024, cache_creation_input_tokens: 0 }, anthropic, "openai-chat", 1500, 1024, 0, 40],
    ["zero is recorded, not missing", { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } }, openai, "openai-chat", 0, 0, null, 0],
  ])("%s", (_label, usage, request, schema, input, read, write, output) => {
    expect(parsed(usage, request)).toMatchObject({ schema, status: "valid", inputTokens: input, cacheReadTokens: read, cacheWriteTokens: write, outputTokens: output, issues: [] });
  });

  it.each([
    ["response.usage", { request: openai, response: { usage: chat } }],
    ["response_body.usage", { request_body: JSON.stringify(openai), response_body: JSON.stringify({ usage: chat }) }],
    ["response.body.usage", { body: openai, response: { status_code: 200, body: { usage: chat } } }],
    ["response.body.usage", { body: JSON.stringify(openai), response: JSON.stringify({ body: JSON.stringify({ usage: chat }) }) }],
    ["usage", { params: openai, usage: chat }],
  ])("preserves counter provenance through %s", (source, record) => {
    const usage = parseInput(JSON.stringify(record)).requests[0]!.reportedUsage!;
    expect(usage.sources).toEqual([source]);
    expect(usage.counters).toContainEqual({ path: `${source}.prompt_tokens_details.cached_tokens`, status: "reported", value: 1024 });
  });

  it.each([undefined, null, {}, { cached_tokens: null }])("does not fill absent read counters with zero (%j)", (details) => {
    const usage = parsed({ prompt_tokens: 42, prompt_tokens_details: details });
    expect(usage.inputTokens).toBe(42);
    expect(usage.cacheReadTokens).toBeNull();
    expect(usage.cacheWriteTokens).toBeNull();
    expect(usage.counters).toContainEqual({ path: "response.usage.prompt_tokens_details.cached_tokens", status: "missing" });
  });

  it("keeps an Anthropic total unavailable if one partition is missing", () => {
    expect(parsed({ input_tokens: 50, cache_read_input_tokens: 100000 }, anthropic)).toMatchObject({ status: "valid", inputTokens: null, cacheReadTokens: 100000, cacheWriteTokens: null });
  });

  it.each([-1, 1.5, "1024", true, 9007199254740992, "private-response-marker", {}, []])("rejects invalid cache counters without echoing their content (%j)", (cached_tokens) => {
    const usage = parsed({ ...chat, prompt_tokens_details: { cached_tokens } });
    expect(usage).toMatchObject({ status: "invalid", inputTokens: null, cacheReadTokens: null });
    expect(usage.counters).toContainEqual({ path: "response.usage.prompt_tokens_details.cached_tokens", status: "invalid" });
    expect(JSON.stringify(usage)).not.toContain("private-response-marker");
  });

  it.each([
    { ...chat, cache_read_input_tokens: 0 },
    { ...chat, prompt_tokens_details: { cached_tokens: 1201 } },
    { ...chat, prompt_tokens_details: { cached_tokens: 1024, cache_write_tokens: 177 } },
    { ...chat, total_tokens: 1200 },
    { ...chat, input_tokens: 1200 },
    { ...chat, prompt_tokens_details: "private-response-marker" },
    { prompt_tokens: 1500, cache_creation_input_tokens: 200, prompt_tokens_details: { cached_tokens: 1024, cache_creation_tokens: 200, cache_creation_token_details: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 0 } } },
  ])("excludes inconsistent usage instead of choosing a convenient counter (%j)", (usage) => {
    expect(parsed(usage).status).toBe("invalid");
  });

  it("does not hide an invalid alias behind a valid primary counter", () => {
    expect(parsed({ ...chat, cache_read_input_tokens: "1024" }, anthropic).status).toBe("invalid");
  });

  it("preserves explicit unavailability and rejects ambiguous or corrupt response bodies", () => {
    expect(parsed(null)).toMatchObject({ status: "unavailable", schema: "unknown" });
    for (const record of [
      { request: openai, response: { usage: chat }, usage: chat },
      { request: openai, response: { usage: chat, body: { usage: chat } } },
      { request: openai, response_body: '{"usage":{"prompt_tokens":1,"prompt_tokens":2}}' },
      { request: openai, response_body: "truncated private-response-marker" },
    ]) {
      const usage = parseInput(JSON.stringify(record)).requests[0]!.reportedUsage!;
      expect(usage.status).toBe("invalid");
      expect(JSON.stringify(usage)).not.toContain("private-response-marker");
    }
  });

  it("does not attach arbitrary request/tool usage or a standalone response to a request", () => {
    const result = analyze(JSON.stringify([{ ...openai, usage: chat, response: { usage: chat } }, { usage: chat }]));
    expect(result.parse.requests.map((r) => r.reportedUsage)).toEqual([undefined, undefined]);
    expect(result.usageComparison.capturedRequests).toBe(0);
    expect(result.usageComparison.rows).toHaveLength(1);
    expect(result.parse.complete).toBe(false);
  });
});

describe("usage reconciliation", () => {
  const stable = "Preserve the public interface and explain each change.\n".repeat(400);
  const first = { ...openai, messages: [{ role: "system", content: stable }, ...openai.messages] };
  const second = { ...first, messages: [...first.messages, { role: "assistant", content: "I inspected the parser." }, { role: "user", content: "Continue." }] };

  it("surfaces a simulated hit even when recorded usage says zero, without changing the simulation", () => {
    const records = [first, second].map((request) => capture({ ...chat, prompt_tokens_details: { cached_tokens: 0 } }, request));
    const result = analyze(JSON.stringify(records));
    expect(result.cacheSimulation).toEqual(analyze(JSON.stringify([first, second])).cacheSimulation);
    expect(result.usageComparison.rows[1]).toMatchObject({ readOutcome: "simulated_hit_reported_zero", reportedReadTokens: 0 });
    expect(result.usageComparison.rows[1]!.simulatedReadTokens).toBeGreaterThan(1024);
    expect(result.usageComparison.cacheRead).toMatchObject({ requestIndices: [0, 1], reportedTokens: 0 });
    const terminal = renderTerminalReport(result, { verbose: true });
    expect(terminal).toContain("response.usage.prompt_tokens_details.cached_tokens = 0");
    expect(terminal).not.toContain("caches cleanly");
    expect(terminal).not.toContain("total actual cost");
  });

  it("compares identical cohorts for each metric, retaining physical lines across skipped data", () => {
    const result = analyze([
      JSON.stringify(capture(chat)), "", "{truncated",
      JSON.stringify(capture({ prompt_tokens: 25 })),
      JSON.stringify(capture({ input_tokens_details: { cached_tokens: 7 } })),
      JSON.stringify(openai),
      JSON.stringify(capture({ prompt_tokens: 20, prompt_tokens_details: { cached_tokens: -2 } })),
    ].join("\n"));
    const review = result.usageComparison;
    expect(review.input.requestIndices).toEqual([0, 1]);
    expect(review.input.reportedTokens).toBe(1225);
    expect(review.input.simulatedTokens).toBe(result.reports[0]!.totals.openaiTokens + result.reports[1]!.totals.openaiTokens);
    expect(review.cacheRead.requestIndices).toEqual([0, 2]);
    expect(review.cacheRead.reportedTokens).toBe(1031);
    expect(review.invalidRequestIndices).toEqual([4]);
    expect(review.readOutcomes.unavailable).toBe(3);
    expect(result.parse.requests[4]!.source).toMatchObject({ recordIndex: 5, line: 7 });
    const html = renderHtmlReport(result);
    expect(html).toContain("Request 5 · line 7 · invalid");
    expect(html).toContain("response.usage.prompt_tokens_details.cached_tokens");
    expect(html).not.toContain("private-response-marker");
    expect(html).not.toContain("private-prompt-marker");
    const text = toJsonReport(result);
    expect(text).not.toContain("private-response-marker");
    expect(text).not.toContain("private-prompt-marker");
    const exported = JSON.parse(text) as typeof result;
    expect(exported.usageComparison).toEqual(review);
    expect(exported.parse.requests[4]!.reportedUsage).toEqual(result.parse.requests[4]!.reportedUsage);
  });

  it("does not round unsafe individual sums or aggregates into authoritative totals", () => {
    expect(parsed({ input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 }, anthropic).status).toBe("invalid");
    const result = analyze(JSON.stringify([capture({ prompt_tokens: Number.MAX_SAFE_INTEGER }), capture({ prompt_tokens: 1 })]));
    expect(result.usageComparison.input).toMatchObject({ requestIndices: [0, 1], reportedTokens: null, deltaTokens: null });
    expect(result.usageComparison.issues).toHaveLength(1);
    expect(result.usageComparison.rows[0]!.reportedInputTokens).toBe(Number.MAX_SAFE_INTEGER);
  });
});
