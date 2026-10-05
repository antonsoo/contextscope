import { describe, expect, it } from "vitest";
import { analyze, computePrefixMatch, parseInput } from "../src/core/index.js";

const claude = (content: unknown, role = "user") => ({ model: "claude-sonnet-5", messages: [{ role, content }], cache_control: { type: "ephemeral" } });
const openai = (message: unknown) => ({ model: "gpt-6-sol", messages: [message] });
const pair = (a: unknown, b: unknown) => parseInput(JSON.stringify([a, b])).requests;

describe("prompt structure is part of prefix evidence", () => {
  it.each([
    ["tool destination", { type: "tool_result", tool_use_id: "a", content: "same result" }, { type: "tool_result", tool_use_id: "b", content: "same result" }],
    ["tool error", { type: "tool_result", tool_use_id: "a", content: "same result" }, { type: "tool_result", tool_use_id: "a", content: "same result", is_error: true }],
    ["thinking signature", { type: "thinking", thinking: "same thought", signature: "a" }, { type: "thinking", thinking: "same thought", signature: "b" }],
    ["document title", { type: "document", source: { type: "text", data: "same document" }, title: "a" }, { type: "document", source: { type: "text", data: "same document" }, title: "b" }],
    ["text citations", { type: "text", text: "same answer", citations: [{ document_index: 0 }] }, { type: "text", text: "same answer", citations: [{ document_index: 1 }] }],
  ])("retains Anthropic %s when analyzed text is unchanged", (_name, a, b) => {
    const [from, to] = pair(claude([a]), claude([b]));
    expect(from!.segments[0]!.text).toBe(to!.segments[0]!.text);
    for (const normalize of [false, true]) expect(computePrefixMatch(from!, to!, normalize).matchedSegments).toBe(0);
    const diff = computePrefixMatch(from!, to!).diff;
    expect(diff.map((line) => line.type)).toEqual(["remove", "add"]);
    expect(diff.every((line) => /metadata|structure|boundary/.test(line.text))).toBe(true);
  });

  it.each([
    ["tool destination", { role: "tool", tool_call_id: "a", content: "same result" }, { role: "tool", tool_call_id: "b", content: "same result" }],
    ["speaker name", { role: "user", name: "Alice", content: "same text" }, { role: "user", name: "Bob", content: "same text" }],
    ["operator role", { role: "system", content: "same text" }, { role: "developer", content: "same text" }],
    ["additional captured image metadata", { role: "user", content: [{ type: "image_url", image_url: { url: "same image" }, capture_note: "a" }] }, { role: "user", content: [{ type: "image_url", image_url: { url: "same image" }, capture_note: "b" }] }],
  ])("retains OpenAI %s in actual and optimized comparisons", (_name, a, b) => {
    const [from, to] = pair(openai(a), openai(b));
    for (const normalize of [false, true]) expect(computePrefixMatch(from!, to!, normalize).matchedSegments).toBe(0);
  });

  it.each(["anthropic", "openai"])("distinguishes two blocks in one message from two messages: %s", (provider) => {
    const text = (value: string) => ({ type: "text", text: value });
    const base = { model: provider === "anthropic" ? "claude-sonnet-5" : "gpt-6-sol" };
    const [from, to] = pair(
      { ...base, messages: [{ role: "user", content: [text("a"), text("b")] }] },
      { ...base, messages: [{ role: "user", content: [text("a")] }, { role: "user", content: [text("b")] }] },
    );
    for (const normalize of [false, true]) expect(computePrefixMatch(from!, to!, normalize).matchedSegments).toBe(1);
  });

  it("does not redact a UUID-shaped tool routing identity", () => {
    const make = (id: string) => claude([{ type: "tool_result", tool_use_id: id, content: "same result" }]);
    const [from, to] = pair(make("12345678-1234-1234-1234-123456789abc"), make("87654321-1234-1234-1234-123456789abc"));
    expect(computePrefixMatch(from!, to!, true).matchedSegments).toBe(0);
  });

  it("does not treat different tool destinations as the same conversation", () => {
    const result = analyze(JSON.stringify([openai({ role: "tool", tool_call_id: "a", content: "same result" }), openai({ role: "tool", tool_call_id: "b", content: "same result" })]));
    expect(result.conversations.count).toBe(2);
  });

  it.each(["thinking", "redacted_thinking"])("does not parameterize signed or opaque %s evidence", (type) => {
    const make = (value: string) => claude([{ type, thinking: value, data: value, signature: "same-signature" }], "assistant");
    const [from, to] = pair(make("12345678-1234-1234-1234-123456789abc"), make("87654321-1234-1234-1234-123456789abc"));
    expect(computePrefixMatch(from!, to!, true).matchedSegments).toBe(0);
  });

  it("retains Responses routing IDs even when they look volatile", () => {
    const make = (call_id: string) => ({ model: "gpt-6-sol", input: [{ type: "function_call_output", call_id, output: "same output" }] });
    const [from, to] = pair(make("12345678-1234-1234-1234-123456789abc"), make("87654321-1234-1234-1234-123456789abc"));
    for (const normalize of [false, true]) expect(computePrefixMatch(from!, to!, normalize).matchedSegments).toBe(0);
  });

  it("keeps message metadata distinct from token accounting and preserves source paths", () => {
    const [from, to] = pair(openai({ role: "tool", tool_call_id: "a", content: "same output" }), openai({ role: "tool", tool_call_id: "b", content: "same output" }));
    expect(from!.segments[0]!.openaiTokens).toBe(to!.segments[0]!.openaiTokens);
    expect(from!.segments[0]!.claudeTokensEstimate).toBe(to!.segments[0]!.claudeTokensEstimate);
    expect(parseInput(JSON.stringify(claude("hello"))).requests[0]!.segments[0]!.path).toBe("messages[0].content");
  });

  it("cannot reuse a complete Anthropic breakpoint when only routing metadata changes", () => {
    const make = (id: string) => claude([{ type: "tool_result", tool_use_id: id, content: "stable result ".repeat(1500) }]);
    const result = analyze(JSON.stringify([make("a"), make("b")]));
    expect(result.reports[0]!.totals.claudeTokensEstimate).toBe(result.reports[1]!.totals.claudeTokensEstimate);
    expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
    expect(result.cacheSimulation.optimized[1]!.readTokens).toBe(0);
  });

  it("keeps shorthand text, cache-marker moves and append-only histories comparable", () => {
    const a = claude("hello");
    const b = claude([{ type: "text", text: "hello", cache_control: { type: "ephemeral", ttl: "1h" } }]);
    const [from, to] = pair(a, b);
    for (const normalize of [false, true]) expect(computePrefixMatch(from!, to!, normalize).matchedSegments).toBe(1);
    const result = analyze(JSON.stringify([a, { ...a, messages: [...a.messages, { role: "assistant", content: "reply" }] }]));
    expect(result.conversations.count).toBe(1);
    expect(result.prefixMatches[0]!.matchedSegments).toBe(1);
  });

  it("does not compare following tool calls as part of preceding OpenAI text", () => {
    const make = (name: string) => openai({ role: "assistant", content: "I'll use a tool", tool_calls: [{ id: "c1", type: "function", function: { name, arguments: "{}" } }] });
    const [from, to] = pair(make("a"), make("b"));
    for (const normalize of [false, true]) expect(computePrefixMatch(from!, to!, normalize).matchedSegments).toBe(1);
  });

  it("does not label a pure reordering as changed prompt metadata", () => {
    const make = (texts: string[]) => ({ model: "claude-sonnet-5", messages: texts.map((content) => ({ role: "user", content })) });
    const [from, to] = pair(make(["a", "b"]), make(["b", "a"]));
    const diff = computePrefixMatch(from!, to!).diff;
    expect(diff.some((line) => line.type === "remove")).toBe(true);
    expect(diff.some((line) => line.type === "add")).toBe(true);
    expect(diff.some((line) => /metadata|boundary/.test(line.text))).toBe(false);
  });

  it("does not advise parameterizing a changed routing ID as volatile text", () => {
    const make = (id: string) => ({ model: "claude-sonnet-5", messages: [
      { role: "user", content: "same question" },
      { role: "assistant", content: [{ type: "tool_use", id, name: "read_file", input: { path: "evidence.txt" } }] },
    ] });
    const result = analyze(JSON.stringify([make("12345678-1234-1234-1234-123456789abc"), make("87654321-1234-1234-1234-123456789abc")]));
    expect(result.findings.some((finding) => finding.kind === "volatile_prefix")).toBe(false);
  });

  it("still identifies parameterizable timestamps inside ordinary prompt text", () => {
    const make = (time: string) => ({ ...claude("same question"), system: `Time: ${time}` });
    const result = analyze(JSON.stringify([make("2026-10-04T10:00:00Z"), make("2026-10-04T10:10:00Z")]));
    expect(result.findings.some((finding) => finding.kind === "volatile_prefix")).toBe(true);
  });
});
