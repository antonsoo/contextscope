import { describe, expect, it } from "vitest";
import { analyze, ContextScopeParseError, parseInput } from "../src/core/index.js";
import { canonicalJson } from "../src/core/json-utils.js";
import { readJson, MAX_JSON_DEPTH } from "../src/core/read-json.js";
import { renderHtmlReport } from "../src/cli/html-report.js";

const anthropic = { model: "claude-sonnet-5", system: "private-system-marker", messages: [{ role: "user", content: "hello" }] };
const openai = { model: "gpt-6-sol", instructions: "private-system-marker", input: "hello" };

describe("JSON evidence integrity", () => {
  it.each([
    '{"model":"claude-sonnet-5","messages":[],"messages":[{"role":"user","content":"hi"}]}',
    '{"model":"claude-sonnet-5","messages":[{"content":"before","\\u0063ontent":"after"}]}',
    '{"model":"claude-sonnet-5","tools":[{"input_schema":{"properties":{"x":{},"x":{}}}}]}',
    JSON.stringify({ request_body: '{"messages":[],"messages":[{"content":"hi"}]}' }),
  ])("refuses duplicate JSON fields: %s", (input) => {
    expect(() => parseInput(input)).toThrow(/duplicate/i);
  });

  it("does not turn duplicate-field JSONL into a skipped line", () => {
    expect(() => parseInput(`${JSON.stringify(anthropic)}\n{"messages":[],"messages":[]}`)).toThrow(/duplicate/i);
  });

  it("a truncated JSONL record does not absorb the following valid records", () => {
    const result = parseInput(`${JSON.stringify(anthropic)}\n{"messages":\n${JSON.stringify(anthropic)}`);
    expect(result.requests).toHaveLength(2);
    expect(result.skippedRecords).toBe(1);
  });

  it.each(["1e400", "-1e400"])("refuses unrepresentable JSON numbers %s", (number) => {
    expect(() => parseInput(`{"messages":[{"content":[{"type":"tool_use","input":{"x":${number}}}]}]}`)).toThrow(/finite|range/i);
  });

  it.each(["1e-400", "-1e-400"])("refuses a nonzero JSON number rounded to zero: %s", (number) => {
    expect(() => parseInput(`{"messages":[{"content":[{"type":"tool_use","input":{"x":${number}}}]}]}`)).toThrow(/range|underflow|zero/i);
  });

  it("refuses excessive nesting with a parse error before recursive analysis", () => {
    const input = `{"model":"gpt-6-sol","input":[{"type":"reasoning","data":${"[".repeat(5000)}0${"]".repeat(5000)}}]}`;
    expect(() => analyze(input)).toThrow(ContextScopeParseError);
    expect(() => analyze(input)).toThrow(/nesting.*128/i);
  });

  it("treats brackets and key-like text inside strings as content", () => {
    const text = '"x": "x": {[[[\\ and a quote "';
    expect(parseInput(JSON.stringify({ ...anthropic, system: text })).requests[0]!.segments[0]!.text).toBe(text);
  });

  it("accepts the exact depth boundary and refuses one level more", () => {
    const nested = (depth: number): string => "[".repeat(depth) + "0" + "]".repeat(depth);
    expect(readJson(nested(MAX_JSON_DEPTH))).toEqual(JSON.parse(nested(MAX_JSON_DEPTH)));
    expect(() => readJson(nested(MAX_JSON_DEPTH + 1))).toThrow(/nesting.*128/i);
  });

  it("keeps independent objects' repeated field names and escaped names intact", () => {
    const input = '{"arr":[{"x":1},{"x":2}],"quote\\"":true,"slash\\\\":false,"\\u0061":3}';
    expect(readJson(input)).toEqual(JSON.parse(input));
  });

  it("preserves prototype-like keys when canonicalizing", () => {
    const value = JSON.parse('{"__proto__":{"private-marker":1},"constructor":2,"a":3}') as unknown;
    const canonical = canonicalJson(value);
    expect(JSON.parse(canonical)).toEqual(value);
    expect(canonical).toContain('"__proto__"');
    expect(canonicalJson(value)).not.toBe(canonicalJson({ constructor: 2, a: 3 }));
    expect(Object.prototype).not.toHaveProperty("private-marker");
  });
});

describe("request sequence integrity", () => {
  it("rejects an empty request array", () => {
    expect(() => analyze("[]")).toThrow(/no requests|empty/i);
  });

  it("unwraps each source record without dropping mixed envelope shapes", () => {
    const result = parseInput(JSON.stringify([anthropic, { body: anthropic }, { request_body: JSON.stringify(anthropic) }]));
    expect(result.requests.map((r) => r.segments[0]!.text)).toEqual(Array(3).fill("private-system-marker"));
    expect(result.requests.map((r) => r.source?.envelope)).toEqual([undefined, "body", "request_body"]);
    expect(result.complete).toBe(true);
  });

  it("refuses a record with two possible request bodies", () => {
    expect(() => parseInput(JSON.stringify({ body: anthropic, request: { ...anthropic, system: "different" } }))).toThrow(/ambiguous/i);
  });

  it("refuses mixed providers instead of parsing all requests as the first", () => {
    expect(() => analyze(JSON.stringify([anthropic, openai]))).toThrow(/mixed.*provider|both.*Anthropic.*OpenAI/i);
    expect(() => analyze(JSON.stringify([openai, anthropic]))).toThrow(/mixed.*provider|both.*Anthropic.*OpenAI/i);
  });

  it("a long shared-shape message history cannot outweigh Anthropic model evidence", () => {
    const result = parseInput(JSON.stringify({ ...anthropic, messages: Array(200).fill({ role: "user", content: "hi" }) }));
    expect(result.format).toBe("anthropic");
    expect(result.complete).toBe(true);
  });

  it("an explicit override retains a warning and incomplete status for mismatched providers", () => {
    const result = parseInput(JSON.stringify([anthropic, openai]), "anthropic");
    expect(result.format).toBe("anthropic");
    expect(result.complete).toBe(false);
    expect(result.warnings.some((w) => /provider|format/i.test(w.message))).toBe(true);
  });

  it("keeps original JSONL line references and incomplete coverage", () => {
    const result = parseInput(`\n${JSON.stringify(anthropic)}\n\nnot json\n${JSON.stringify(anthropic)}\n`);
    expect(result.complete).toBe(false);
    expect(result.sourceRecords).toBe(3);
    expect(result.skippedRecords).toBe(1);
    expect(result.requests.map((r) => r.source?.line)).toEqual([2, 5]);
    expect(result.warnings[0]).toMatchObject({ sourceLine: 4 });
    expect(result.warnings[0]!.message).toContain("Line 4");
  });

  it("cannot label a non-request record as complete", () => {
    const result = parseInput(JSON.stringify([anthropic, { usage: { input_tokens: 20 } }]));
    expect(result.complete).toBe(false);
    expect(result.sourceRecords).toBe(2);
    expect(result.skippedRecords).toBe(1);
  });

  it("a leading unrelated record cannot choose the provider for later requests", () => {
    const result = parseInput(JSON.stringify([{ usage: {} }, openai]));
    expect(result.format).toBe("openai");
    expect(result.requests[1]!.segments[0]!.text).toBe("private-system-marker");
    expect(result.complete).toBe(false);
  });

  it("HTML retains partial coverage and all parse warnings", () => {
    const result = analyze(`${JSON.stringify(openai)}\nnot json`);
    const html = renderHtmlReport(result);
    expect(html).toMatch(/incomplete/i);
    expect(html).toContain("Line 2");
    expect(html).not.toContain("this sequence caches cleanly");
  });

  it.each([42, { private: "retained" }])("retains malformed Anthropic prompt content %j", (content) => {
    const result = parseInput(JSON.stringify({ ...anthropic, system: content, messages: [{ role: "user", content }] }));
    expect(result.requests[0]!.segments.map((s) => s.text)).toEqual([JSON.stringify(content), JSON.stringify(content)]);
  });

  it.each([42, { private: "retained" }])("retains malformed Responses prompt content %j", (content) => {
    const result = parseInput(JSON.stringify({ ...openai, instructions: content, input: [{ role: "user", content }] }));
    expect(result.requests[0]!.segments.map((s) => s.text)).toEqual([JSON.stringify(content), JSON.stringify(content)]);
  });

  it("retains a malformed non-array Responses input", () => {
    const input = { private: "retained" };
    expect(parseInput(JSON.stringify({ ...openai, input })).requests[0]!.segments.at(-1)!.text).toBe(JSON.stringify(input));
  });

  it("a plain Anthropic content string stays a string in raw inspection", () => {
    expect(parseInput(JSON.stringify(anthropic)).requests[0]!.segments.at(-1)!.raw).toBe("hello");
  });

  it("rejects calibration that makes token counts unrepresentable", () => {
    expect(() => analyze(JSON.stringify(anthropic), { claudeTokenScale: 1e308 })).toThrow(/scale|calibrat|represent|range/i);
  });
});
