import { describe, expect, it } from "vitest";
import { parseInput } from "../src/core/parse.js";

const anthropicRequest = {
  model: "claude-sonnet-5",
  system: [{ type: "text", text: "You are a helpful assistant.", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "get_weather", description: "Get the weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
  messages: [
    { role: "user", content: "What's the weather in Tokyo?" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "get_weather", input: { city: "Tokyo" } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "Sunny, 22C" }],
    },
  ],
};

const openaiRequest = {
  model: "gpt-6-sol",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What's the weather in Tokyo?" },
    { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "get_weather", arguments: '{"city":"Tokyo"}' } }] },
    { role: "tool", tool_call_id: "t1", content: "Sunny, 22C" },
  ],
  tools: [{ type: "function", function: { name: "get_weather", description: "Get the weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }],
};

describe("parseInput / auto-detect", () => {
  it("detects and parses an Anthropic request", () => {
    const result = parseInput(JSON.stringify(anthropicRequest));
    expect(result.format).toBe("anthropic");
    expect(result.autoDetected).toBe(true);
    const [request] = result.requests;
    expect(request).toBeDefined();
    const categories = request!.segments.map((s) => s.category);
    expect(categories).toEqual(["tools", "system", "user", "tool_call", "tool_result"]);
  });

  it("detects and parses an OpenAI request", () => {
    const result = parseInput(JSON.stringify(openaiRequest));
    expect(result.format).toBe("openai");
    const [request] = result.requests;
    const categories = request!.segments.map((s) => s.category);
    expect(categories).toEqual(["tools", "system", "user", "tool_call", "tool_result"]);
  });

  it("respects an explicit format override even when it looks like the other provider", () => {
    const result = parseInput(JSON.stringify(anthropicRequest), "openai");
    expect(result.format).toBe("openai");
    expect(result.autoDetected).toBe(false);
  });

  it("parses a JSON array as a sequence of requests", () => {
    const result = parseInput(JSON.stringify([anthropicRequest, anthropicRequest]));
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]!.index).toBe(0);
    expect(result.requests[1]!.index).toBe(1);
  });

  it("parses JSONL, one request per line", () => {
    const jsonl = [anthropicRequest, anthropicRequest, anthropicRequest].map((r) => JSON.stringify(r)).join("\n");
    const result = parseInput(jsonl);
    expect(result.requests).toHaveLength(3);
  });

  it("warns and skips malformed JSONL lines instead of throwing", () => {
    const jsonl = `${JSON.stringify(anthropicRequest)}\nnot json\n${JSON.stringify(anthropicRequest)}`;
    const result = parseInput(jsonl);
    expect(result.requests).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
  });

  it("throws a clear error on empty input", () => {
    expect(() => parseInput("")).toThrow(/empty/i);
  });

  it("throws a clear error when nothing parses", () => {
    expect(() => parseInput("not json\nalso not json")).toThrow();
  });

  it("reads cache_control ttl off Anthropic tool and system blocks", () => {
    const result = parseInput(JSON.stringify(anthropicRequest));
    const system = result.requests[0]!.segments.find((s) => s.category === "system");
    expect(system?.cacheControl).toEqual({ type: "ephemeral", ttl: "5m" });
  });
});
