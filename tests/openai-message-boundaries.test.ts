import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { getEncoding } from "js-tiktoken";
import { analyze, parseInput } from "../src/core/index.js";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";
import { computePrefixMatch } from "../src/core/prefix.js";

interface CaptureCase { id: string; file: string; changed: boolean; expectedMatchedSegments: number; requiredSegmentPath: string }
const root = new URL("../studies/message-boundaries/fixtures/", import.meta.url);
const captures = JSON.parse(readFileSync(new URL("cases.json", root), "utf8")) as { cases: CaptureCase[] };
const counter = getEncoding("o200k_base");

describe("OpenAI histories captured through the actual SDK", () => {
  it.each(captures.cases)("retains supplied history and correct prefix boundaries: $id", (capture) => {
    const text = gunzipSync(readFileSync(new URL(capture.file, root))).toString("utf8");
    const result = analyze(text);
    expect(result.parse.complete).toBe(true);
    expect(result.parse.warnings).toEqual([]);
    const second = result.parse.requests[1]!;
    expect(second.segments.some(s => s.path === capture.requiredSegmentPath)).toBe(true);
    expect(result.prefixMatches[0]!.matchedSegments).toBe(capture.expectedMatchedSegments);
    if (capture.changed) {
      expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
      expect(result.prefixMatches[0]!.diff.some(d => d.type === "add")).toBe(true);
    } else {
      expect(result.cacheSimulation.actual[1]!.readTokens).toBe(second.segments.reduce((total, s) => total + s.openaiTokens, 0));
    }
    // Independent tokenizer, applied to the retained text rather than to a
    // serialized JSON wrapper or a fabricated provider usage counter.
    for (const request of result.parse.requests) {
      for (const segment of request.segments.filter(s => s.label.includes("refusal"))) {
        expect(segment.openaiTokens).toBe(counter.encode(segment.text).length);
        expect(segment.text).not.toContain('"type":"refusal"');
      }
    }
  });
});

describe("empty source units and mixed assistant content", () => {
  it.each([null, []])("retains declared empty Chat content without invented text tokens: %j", content => {
    const request = parseOpenAiRequest({ model: "gpt-6-sol", messages: [{ role: "assistant", content, name: "reviewer" }] }, 0);
    expect(request.segments).toHaveLength(1);
    expect(request.segments[0]).toMatchObject({ text: "", openaiTokens: 0, path: "messages[0].content" });
    expect(request.segments[0]!.raw).toEqual({ role: "assistant", content, name: "reviewer" });
  });

  it("retains empty Responses input and instructions, including a distinguishable empty message", () => {
    const request = parseOpenAiRequest({ model: "gpt-6-sol", instructions: "", input: "" }, 0);
    expect(request.segments.map(s => [s.path, s.openaiTokens])).toEqual([["instructions", 0], ["input", 0]]);
    const message = parseOpenAiRequest({ model: "gpt-6-sol", input: [{ role: "user", content: [] }] }, 0);
    expect(message.segments[0]).toMatchObject({ path: "input[0].content", text: "", openaiTokens: 0 });
  });

  it("does not turn an unrelated empty object into a message", () => {
    expect(parseInput(JSON.stringify({ model: "gpt-6-sol", messages: [{}] })).complete).toBe(false);
  });

  it("keeps both assistant text and refusal with one plain-string framing charge", () => {
    const raw = { model: "gpt-6-sol", messages: [{ role: "assistant", content: "Public summary.", refusal: "Cannot show the private record." }] };
    const before = JSON.stringify(raw);
    const request = parseOpenAiRequest(raw, 0);
    expect(request.segments.map(s => s.path)).toEqual(["messages[0].content", "messages[0].refusal"]);
    expect(request.segments[0]!.openaiTokens).toBe(counter.encode("Public summary.").length + 5);
    expect(request.segments[1]!.openaiTokens).toBe(counter.encode("Cannot show the private record.").length);
    const changed = parseOpenAiRequest({ ...raw, messages: [{ ...raw.messages[0]!, refusal: "Different refusal." }] }, 1);
    expect(computePrefixMatch(request, changed).matchedSegments).toBe(0);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("retains a Responses refusal block as text with its original block", () => {
    const part = { type: "refusal", refusal: "Cannot show the private record." };
    const request = parseOpenAiRequest({ model: "gpt-6-sol", input: [{ type: "message", role: "assistant", content: [part] }] }, 0);
    expect(request.segments[0]).toMatchObject({ text: part.refusal, raw: part, path: "input[0].content[0]" });
    expect(request.segments[0]!.openaiTokens).toBe(counter.encode(part.refusal).length);
  });
});
