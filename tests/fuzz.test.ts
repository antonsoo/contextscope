// Request logs are untrusted input: a gateway can log a truncated body, a null where a message
// should be, a number where text should be. Whatever comes in, analysis and every report either
// complete or raise ContextScopeParseError: never a TypeError from deep inside.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyze, ContextScopeParseError, groupFindings } from "../src/core/index.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";
import { renderHtmlReport } from "../src/cli/html-report.js";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), s | 1) + 0x6d2b79f5) >>> 0) / 4294967296);
}
const JUNK = [null, 0, -1, 1e308, "", "x", [], {}, [1], { a: 1 }, true, "system", "tool", { type: "text" }, { type: "tool_use" }, { type: "image", source: null }, { cache_control: { type: "ephemeral", ttl: "9h" } }, { role: 5 }, [[[]]], "claude-opus-5-5", "gpt-6-sol", { type: "function_call", arguments: 3 }];

function mutate(node: unknown, r: () => number): unknown {
  if (r() < 0.015) return JUNK[Math.floor(r() * JUNK.length)];
  if (Array.isArray(node)) {
    let out = node.map((v) => mutate(v, r));
    if (r() < 0.04 && out.length) out.splice(Math.floor(r() * out.length), 1);
    if (r() < 0.04 && out.length) out = out.concat([out[Math.floor(r() * out.length)]]);
    if (r() < 0.02 && out.length > 1) out.reverse();
    return out;
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (r() < 0.015) continue;
      out[r() < 0.005 ? k + "X" : k] = mutate(v, r);
    }
    return out;
  }
  if (typeof node === "string" && r() < 0.01) return node.slice(0, Math.floor(r() * node.length)) + "\ud83d";
  return node;
}

it("fuzz: mutated request logs only ever raise ContextScopeParseError", { timeout: 60_000 }, () => {
  const sources = ["anthropic-duplicate-tool-results.jsonl", "openai-agent-tools-reordered.jsonl"].map((n) =>
    readFileSync(new URL(`../examples/${n}`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l) as unknown),
  );
  let ok = 0, rejected = 0;
  const bad: string[] = [];
  for (let seed = 1; seed <= 400 && bad.length < 6; seed++) {
    const r = rng(seed);
    const lines = (mutate(sources[seed % sources.length], r) as unknown[]).map((x) => JSON.stringify(x) ?? "null");
    if (r() < 0.1) lines.push("{not json");
    try {
      const result = analyze(lines.join("\n"), r() < 0.2 ? { format: r() < 0.5 ? "anthropic" : "openai" } : {});
      groupFindings(result.findings);
      renderTerminalReport(result, { verbose: r() < 0.5 });
      renderHtmlReport(result);
      JSON.stringify(result);
      ok++;
    } catch (err) {
      if (err instanceof ContextScopeParseError) rejected++;
      else bad.push(`seed ${seed}: ${(err as Error).stack?.split("\n").slice(0, 4).join(" | ")}`);
    }
  }
  expect(bad).toEqual([]);
  expect(ok + rejected).toBe(400);
});

describe("malformed entries keep their position instead of crashing the parse", () => {
  it("Anthropic: a null message, a null block, non-string text, a non-string type, a null tool", () => {
    const request = {
      model: "claude-opus-5-5",
      tools: [null, { name: "read_file", input_schema: {} }],
      system: [null, { type: "text", text: "You are helpful." }],
      messages: [
        null,
        { role: "user", content: [null, { type: "text", text: 42 }, { type: 7, data: "x" }, { type: "text", text: "hello" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [null, { type: "text", text: "ok" }] }] },
      ],
    };
    const parsed = parseAnthropicRequest(request, 0);
    const byId = Object.fromEntries(parsed.segments.map((s) => [s.id, s]));
    expect(parsed.segments.map((s) => s.id)).toEqual([
      "tools[0]", "tools[1]", "system[0]", "system[1]", "messages[0]",
      "messages[1].content[0]", "messages[1].content[1]", "messages[1].content[2]", "messages[1].content[3]", "messages[2].content[0]",
    ]);
    expect(byId["tools[0]"]!.text).toBe("null");
    expect(byId["messages[0]"]!.label).toBe("message 1 (malformed)");
    expect(byId["messages[1].content[0]"]!.text).toBe("null");
    expect(byId["messages[1].content[1]"]!.text).toBe("42"); // the number, as the JSON that was sent
    expect(byId["messages[1].content[3]"]!.text).toBe("hello"); // a later, valid block is untouched
    expect(byId["messages[2].content[0]"]!.text).toBe("null\nok");
    for (const s of parsed.segments) expect(typeof s.text).toBe("string");
  });

  it("OpenAI: null messages, parts, tools and tool calls, and non-string content", () => {
    const chat = parseOpenAiRequest(
      {
        model: "gpt-6-sol",
        tools: [null, { type: "function", function: { name: "search" } }],
        messages: [null, { role: "user", content: [null, { type: "text", text: { nested: true } }] }, { role: "assistant", content: 5, tool_calls: [null] }],
      },
      0,
    );
    expect(chat.segments.map((s) => s.id)).toEqual([
      "tools[0]", "tools[1]", "messages[0]", "messages[1].content[0]", "messages[1].content[1]", "messages[2].content", "messages[2].tool_calls[0]",
    ]);
    expect(chat.segments.find((s) => s.id === "messages[2].content")!.text).toBe("5");
    const responses = parseOpenAiRequest({ model: "gpt-6-sol", input: [null, { type: "message", role: "user", content: [null, { type: "input_text", text: "hi" }] }] }, 0);
    expect(responses.segments.map((s) => s.id)).toEqual(["input[0]", "input[1].content[0]", "input[1].content[1]"]);
    for (const s of [...chat.segments, ...responses.segments]) expect(typeof s.text).toBe("string");
  });
});
