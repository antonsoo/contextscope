import { describe, expect, it } from "vitest";
import { computePrefixMatch } from "../src/core/prefix.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";

// Deterministic PRNG so a failure reproduces.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lcsLength(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  return dp[0]![0]!;
}

function request(texts: string[], index: number) {
  return parseAnthropicRequest({ model: "claude-sonnet-5", messages: texts.map((t) => ({ role: "user", content: t })) }, index);
}

describe("segment diff", () => {
  it("is a minimal edit script: its unchanged lines are a longest common subsequence", () => {
    const random = mulberry32(7);
    for (let trial = 0; trial < 200; trial++) {
      const alphabet = ["a", "b", "c", "d"];
      const pick = (len: number) => Array.from({ length: len }, () => alphabet[Math.floor(random() * alphabet.length)]!);
      const a = pick(Math.floor(random() * 12));
      const b = random() < 0.5 ? [...a.slice(0, Math.floor(random() * (a.length + 1))), ...pick(Math.floor(random() * 4))] : pick(Math.floor(random() * 12));
      const match = computePrefixMatch(request(a, 0), request(b, 1));
      const context = match.diff.filter((l) => l.type === "context").length;
      const removed = match.diff.filter((l) => l.type === "remove").length;
      const added = match.diff.filter((l) => l.type === "add").length;
      expect(context).toBe(lcsLength(a, b));
      expect(context + removed).toBe(a.length);
      expect(context + added).toBe(b.length);
    }
  });

  it("stays minimal on long requests with scattered edits", () => {
    const random = mulberry32(42);
    for (let trial = 0; trial < 20; trial++) {
      const a = Array.from({ length: 150 + Math.floor(random() * 150) }, (_, i) => `seg ${i % 37}`);
      const b = [...a];
      for (let edit = 0; edit < 1 + Math.floor(random() * 25); edit++) {
        const at = Math.floor(random() * (b.length + 1));
        const roll = random();
        if (roll < 0.4) b.splice(at, 1);
        else if (roll < 0.8) b.splice(at, 0, `new ${edit}`);
        else b[Math.min(at, b.length - 1)] = `changed ${edit}`;
      }
      const match = computePrefixMatch(request(a, 0), request(b, 1));
      // withContext trims long unchanged runs into "⋯ N unchanged segments ⋯" markers; count them back in.
      const context = match.diff.reduce((sum, l) => {
        if (l.type !== "context") return sum;
        const skipped = /^⋯ (\d+) unchanged segments? ⋯$/.exec(l.text);
        return sum + (skipped ? Number(skipped[1]) : 1);
      }, 0);
      expect(context).toBe(lcsLength(a, b));
    }
  });

  it("stays fast on a long conversation that only appends", () => {
    const history = Array.from({ length: 3000 }, (_, i) => `turn ${i}: ${"x".repeat(i % 7)}`);
    const started = performance.now();
    const match = computePrefixMatch(request(history, 0), request([...history, "one more turn"], 1));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(match.matchedSegments).toBe(3000);
    expect(match.diff.some((l) => l.type === "add" && l.text.includes("one more turn"))).toBe(true);
  });
});
