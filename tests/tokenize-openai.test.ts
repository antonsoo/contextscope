import { describe, expect, it } from "vitest";
import { getEncoding } from "js-tiktoken";
import { countOpenaiTokens } from "../src/core/tokenize-openai.js";

// Independent-oracle cross-check: js-tiktoken is a separate maintained pure-JS port of
// OpenAI's tokenizer from gpt-tokenizer (different author, different implementation).
// Agreement across varied samples is strong evidence the o200k_base integration is correct.
const oracle = getEncoding("o200k_base");

describe("countOpenaiTokens (exact, o200k_base)", () => {
  it("returns 0 for empty input", () => {
    expect(countOpenaiTokens("")).toBe(0);
  });

  it.each([
    "hello world",
    "The quick brown fox jumps over the lazy dog.",
    "function add(a: number, b: number): number {\n  return a + b;\n}",
    JSON.stringify({ name: "get_weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }),
    "日本語のテキストも正しく数えられるはずです。",
    "a".repeat(800),
    "🎉 emoji handling 🚀 with multiple 👍 codepoints",
  ])(
    "matches the js-tiktoken oracle for: %s",
    (text) => {
      expect(countOpenaiTokens(text)).toBe(oracle.encode(text).length);
    },
    15000,
  );

  it("is monotonically non-decreasing as text grows", () => {
    const base = "The context window keeps growing with every tool call. ";
    let prev = 0;
    for (let i = 1; i <= 5; i++) {
      const count = countOpenaiTokens(base.repeat(i));
      expect(count).toBeGreaterThanOrEqual(prev);
      prev = count;
    }
  });
});
