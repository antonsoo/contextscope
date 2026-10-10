import { describe, expect, it } from "vitest";
import { analyze, ContextScopeParseError } from "../src/core/analyze.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";

const marker = (ttl = "5m") => ({ type: "ephemeral", ttl });
const block = (i = 0, ttl = "5m") => ({ type: "text", text: `Reference ${i}: ${"stable instructions ".repeat(400)}`, cache_control: marker(ttl) });
const request = (blocks: unknown[], automatic?: unknown) => ({
  model: "claude-sonnet-4-5", max_tokens: 100,
  ...(automatic === undefined ? {} : { cache_control: automatic }),
  messages: [{ role: "user", content: blocks }],
});

describe("reject invalid Anthropic cache configurations before simulation", () => {
  it.each(["wrong", {}, { type: "forever" }, marker("9h"), { type: "ephemeral", ttl: null }])("does not normalize an invalid marker %j to a 5-minute write", (cache_control) => {
    const input = JSON.stringify(request([{ ...block(), cache_control }]));
    expect(() => analyze(input)).toThrow(ContextScopeParseError);
    expect(() => analyze(input)).toThrow("Request 1.messages[0].content[0].cache_control");
  });

  it.each(["automatic", "tools", "system"])("validates the %s location too", (location) => {
    const invalid = marker("9h");
    const raw = { ...request(["question"]),
      ...(location === "automatic" ? { cache_control: invalid } : {}),
      ...(location === "tools" ? { tools: [{ name: "search", input_schema: { type: "object" }, cache_control: invalid }] } : {}),
      ...(location === "system" ? { system: [{ ...block(), cache_control: invalid }] } : {}),
    };
    expect(() => analyze(JSON.stringify(raw))).toThrow(ContextScopeParseError);
  });

  it("does not let a fifth explicit marker create an unbilled cache entry", () => {
    const invalid = request(Array.from({ length: 5 }, (_, i) => block(i)));
    expect(() => analyze(JSON.stringify([invalid, request([block()])]))).toThrow("5 cache breakpoints exceed Anthropic's limit of 4");
  });

  it("counts an automatic marker in the same four-slot limit", () => {
    const invalid = request([...Array.from({ length: 4 }, (_, i) => block(i)), { type: "text", text: "new tail" }], marker());
    expect(() => analyze(JSON.stringify(invalid))).toThrow("5 cache breakpoints");
  });

  it("rejects conflicting automatic and explicit TTLs even with only one block", () => {
    expect(() => analyze(JSON.stringify(request([block(0, "1h")], marker())))).toThrow("use different TTLs");
  });

  it("rejects reversed TTL ordering, including markers below the token minimum", () => {
    const invalid = request([{ ...block(), text: "short" }, block(1, "1h")]);
    expect(() => analyze(JSON.stringify(invalid))).toThrow('uses "1h" after a "5m"');
  });

  it.each([
    { type: "thinking", thinking: "reason", signature: "synthetic" },
    { type: "redacted_thinking", data: "synthetic" },
    { type: "text", text: "" },
  ])("refuses an explicit marker on an ineligible block %j", (content) => {
    expect(() => analyze(JSON.stringify(request([{ ...content, cache_control: marker() }])))).toThrow("cannot carry an explicit cache marker");
  });

  it("accepts omitted and null markers, matching automatic TTLs, and valid mixed TTLs", () => {
    for (const raw of [
      request([{ ...block(), cache_control: null }], null),
      request([block(0, "1h"), block(1)], marker()),
      request(Array.from({ length: 4 }, (_, i) => block(i))),
      request([block(0, "1h")], marker("1h")),
    ]) expect(() => analyze(JSON.stringify(raw))).not.toThrow();
  });

  it("retains a marker on an empty tool result, which still has routing information", () => {
    const result = { type: "tool_result", tool_use_id: "call-1", content: "" };
    for (const raw of [request([{ ...result, cache_control: marker() }]), request([result], marker())]) {
      const parsed = parseAnthropicRequest(raw, 0);
      expect(parsed.segments[0]!.cacheControl?.ttl).toBe("5m");
    }
  });

  it("does not treat cache_control inside a tool's input schema as a breakpoint", () => {
    const raw = { ...request([{ type: "text", text: "question" }]), tools: [{
      name: "read_config", input_schema: { type: "object", properties: { cache_control: { type: "string" } } },
    }] };
    expect(analyze(JSON.stringify(raw)).cacheSimulation.actual[0]!.writeTokens5m).toBe(0);
  });
});
