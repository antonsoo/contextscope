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
