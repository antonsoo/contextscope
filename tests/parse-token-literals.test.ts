import { expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";
import { parseInput } from "../src/core/parse.js";

const literal = "<|endoftext|>";
it.each([
  { model: "gpt-5.2", messages: [{ role: "user", content: literal }] },
  { model: "gpt-5.2", input: literal },
  { model: "claude-sonnet-5", max_tokens: 32, messages: [{ role: "user", content: literal }] },
])("preserves literal delimiters in a complete supported request: %j", (request) => {
  const result = parseInput(JSON.stringify(request));
  expect(result.complete).toBe(true);
  expect(result.requests).toHaveLength(1);
  const segments = result.requests[0]!.segments;
  expect(segments).toHaveLength(1);
  expect(segments[0]!.text).toBe(literal);
  expect(segments[0]!.openaiTokens).toBe("messages" in request && request.model === "gpt-5.2" ? 12 : 7);
});

it("keeps a literal-heavy prefix eligible for the ordinary-text cache simulation", () => {
  // 256 spellings are 1537 ordinary BPE pieces, not 256 control tokens.
  const system = literal.repeat(256);
  const input = ["Hello.", "Again."].map((content) => JSON.stringify({ model: "gpt-5.2", messages: [{ role: "system", content: system }, { role: "user", content }] })).join("\n");
  const result = analyze(input);
  expect(result.parse.complete).toBe(true);
  expect(result.parse.requests).toHaveLength(2);
  expect(result.parse.requests[0]!.segments[0]!.text).toBe(system);
  expect(result.parse.requests[0]!.segments[0]!.openaiTokens).toBe(1542);
  expect(result.cacheSimulation.actual[1]!.readTokens).toBeGreaterThanOrEqual(1024);
});
