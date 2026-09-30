import { describe, expect, it } from "vitest";
import { estimateClaudeTokens } from "../src/core/tokenize-claude.js";

// There is no public Claude tokenizer, so these are self-consistency checks on the heuristic
// (documented in tokenize-claude.ts), not oracle cross-checks. calibrate.test.ts documents the
// (network-dependent, not run in CI) path that would validate against the real endpoint.
describe("estimateClaudeTokens (heuristic estimate)", () => {
  it("returns 0 for empty input", () => {
    expect(estimateClaudeTokens("")).toBe(0);
  });

  it("returns at least 1 token for any non-empty input", () => {
    expect(estimateClaudeTokens("a")).toBeGreaterThanOrEqual(1);
  });

  it("scales roughly linearly with prose length", () => {
    const unit = "The quick brown fox jumps over the lazy dog. ";
    const one = estimateClaudeTokens(unit);
    const ten = estimateClaudeTokens(unit.repeat(10));
    expect(ten).toBeGreaterThan(one * 8);
    expect(ten).toBeLessThan(one * 12);
  });

  it("estimates denser character-per-token for JSON/code than for prose of equal length", () => {
    const prose = "the weather today is sunny with a light breeze from the northwest and mild temperatures";
    const denseJson = JSON.stringify({
      a: 1, b: 2, c: 3, d: [1, 2, 3], e: { f: true, g: false }, h: "x", i: "y", j: "z", k: null, l: [4, 5],
    });
    const padded = denseJson.padEnd(prose.length, "0");
    // Same character length, but the JSON sample is symbol-dense, so it should estimate >= as many tokens.
    expect(estimateClaudeTokens(padded)).toBeGreaterThanOrEqual(estimateClaudeTokens(prose));
  });
});

describe("estimateClaudeTokens ASCII fast path", () => {
  // The pre-optimization implementation, kept as an oracle: one Unicode-property regex test per character.
  function reference(text: string): number {
    if (text.length === 0) return 0;
    let symbols = 0;
    for (const ch of text) if (!/[\p{L}\p{N} ]/u.test(ch)) symbols++;
    const density = symbols / text.length;
    const t = Math.min(1, Math.max(0, (density - 0.15) / (0.45 - 0.15)));
    return Math.max(1, Math.round(text.length / (4.0 + t * (2.9 - 4.0))));
  }

  it.each([
    "plain English prose, with a comma.",
    '{"type":"object","properties":{"path":{"type":"string"}}}',
    "Ünïcödé naïve café — ½ ⅓ ٣ 三 ok",
    "tabs\tand\nnewlines\u00a0nbsp",
    "emoji 🙂🙃 and ZWJ 👩‍💻 sequences",
    "Ελληνικά και русский текст 12345",
    "    ",
  ])("matches the reference on %j", (text) => {
    expect(estimateClaudeTokens(text)).toBe(reference(text));
  });
});
