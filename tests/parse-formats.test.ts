import { describe, expect, it } from "vitest";
import { parseInput } from "../src/core/parse.js";
import { detectFormat } from "../src/core/detect.js";

const anthropicBody = { model: "claude-sonnet-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] };
const openaiBody = { model: "gpt-6-sol", messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }] };

describe("record envelopes", () => {
  it("unwraps Anthropic Message Batches lines ({custom_id, params})", () => {
    const jsonl = [1, 2].map((i) => JSON.stringify({ custom_id: `r${i}`, params: anthropicBody })).join("\n");
    const result = parseInput(jsonl);
    expect(result.envelope).toBe("params");
    expect(result.format).toBe("anthropic");
    expect(result.requests[0]!.segments.map((s) => s.category)).toEqual(["user"]);
  });

  it("unwraps OpenAI Batch API lines ({custom_id, method, url, body})", () => {
    const jsonl = JSON.stringify({ custom_id: "a", method: "POST", url: "/v1/chat/completions", body: openaiBody });
    const result = parseInput(jsonl);
    expect(result.envelope).toBe("body");
    expect(result.format).toBe("openai");
    expect(result.requests[0]!.segments.map((s) => s.category)).toEqual(["system", "user"]);
  });

  it("unwraps a body logged as a JSON string", () => {
    const result = parseInput(JSON.stringify([{ ts: 1, request_body: JSON.stringify(anthropicBody) }]));
    expect(result.envelope).toBe("request_body");
    expect(result.requests[0]!.segments).toHaveLength(1);
  });

  it("leaves plain request bodies alone", () => {
    expect(parseInput(JSON.stringify(anthropicBody)).envelope).toBeUndefined();
  });

  it("warns about a record that isn't a request body at all", () => {
    const result = parseInput(JSON.stringify([anthropicBody, { id: "msg_1", type: "message", usage: { input_tokens: 5 } }]));
    expect(result.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/^Request 2 has no tools, system prompt or messages/)]);
  });
});

describe("OpenAI Responses API bodies", () => {
  const responses = {
    model: "gpt-6-sol",
    instructions: "You are a coding agent.",
    tools: [{ type: "function", name: "read_file", description: "Read a file", parameters: { type: "object" } }],
    input: [
      { role: "user", content: [{ type: "input_text", text: "Open README.md" }] },
      { type: "function_call", call_id: "c1", name: "read_file", arguments: '{"path":"README.md"}' },
      { type: "function_call_output", call_id: "c1", output: "# Title" },
      { type: "reasoning", summary: [] },
      { role: "assistant", content: [{ type: "output_text", text: "It has a title." }] },
    ],
  };

  it("is detected as OpenAI and parsed in order", () => {
    const result = parseInput(JSON.stringify(responses));
    expect(result.format).toBe("openai");
    const request = result.requests[0]!;
    expect(request.segments.map((s) => s.category)).toEqual(["tools", "system", "user", "tool_call", "tool_result", "thinking", "assistant"]);
    expect(request.segments[0]!.label).toBe("tool: read_file");
    expect(request.segments[4]!.text).toBe("# Title");
  });

  it("accepts a bare string input", () => {
    const request = parseInput(JSON.stringify({ model: "gpt-6-sol", input: "hello" })).requests[0]!;
    expect(request.segments.map((s) => [s.category, s.text])).toEqual([["user", "hello"]]);
  });

  it("warns that previous_response_id hides earlier turns", () => {
    const result = parseInput(JSON.stringify({ model: "gpt-6-sol", previous_response_id: "resp_1", input: "and then?" }));
    expect(result.warnings[0]!.message).toMatch(/previous_response_id/);
  });
});

describe("format detection", () => {
  it("keeps an Anthropic request with a mid-conversation system message Anthropic", () => {
    const request = {
      model: "claude-opus-5",
      messages: [
        { role: "user", content: "Summarize the file." },
        { role: "assistant", content: "Done." },
        { role: "user", content: "Now the next one." },
        { role: "system", content: "Current time: 10:04." },
      ],
    };
    expect(detectFormat(request)).toBe("anthropic");
    const segments = parseInput(JSON.stringify(request)).requests[0]!.segments;
    expect(segments.at(-1)!.category).toBe("system");
  });

  it("still reads a leading system message as OpenAI", () => {
    expect(detectFormat(openaiBody)).toBe("openai");
  });

  it("files server-tool blocks under tool traffic", () => {
    const request = {
      model: "claude-opus-5",
      messages: [
        { role: "user", content: "search it" },
        {
          role: "assistant",
          content: [
            { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
            { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
          ],
        },
      ],
    };
    const segments = parseInput(JSON.stringify(request)).requests[0]!.segments;
    expect(segments.map((s) => s.category)).toEqual(["user", "tool_call", "tool_result"]);
  });
});

describe("minimal requests", () => {
  it("detects the canonical minimal Anthropic body by its model id", () => {
    expect(detectFormat({ model: "claude-opus-5-5", max_tokens: 1024, messages: [{ role: "user", content: "Hello" }] })).toBe("anthropic");
    expect(detectFormat({ model: "us.anthropic.claude-sonnet-5-v1:0", messages: [{ role: "user", content: "Hello" }] })).toBe("anthropic");
  });

  it("detects a minimal OpenAI body by its model id", () => {
    expect(detectFormat({ model: "gpt-6-sol", messages: [{ role: "user", content: "Hello" }] })).toBe("openai");
    expect(detectFormat({ model: "o4-mini", messages: [{ role: "user", content: "Hello" }] })).toBe("openai");
  });
});
