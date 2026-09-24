import { describe, expect, it } from "vitest";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { computeAllPrefixMatches } from "../src/core/prefix.js";
import { simulateAnthropicCacheSequence } from "../src/core/cache-anthropic.js";
import { findAnthropicModel } from "../src/core/pricing.js";

const MODEL = "claude-sonnet-5"; // 1024-token minimum cacheable prefix
const LONG_STABLE_PROMPT = "You are a meticulous, detail-oriented coding assistant. ".repeat(120); // ~4100 chars, well over 1024 est. tokens

function withCacheControlSystem(system: string, userText: string) {
  return {
    model: MODEL,
    tools: [{ name: "search", description: "search the web", input_schema: { type: "object" } }],
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
  };
}

describe("simulateAnthropicCacheSequence - stable prefix", () => {
  it("reads on request 2 exactly what request 1 wrote, and writes nothing new", () => {
    const requests = [
      parseAnthropicRequest(withCacheControlSystem(LONG_STABLE_PROMPT, "turn 1"), 0),
      parseAnthropicRequest(withCacheControlSystem(LONG_STABLE_PROMPT, "turn 2"), 1),
    ];
    const matches = computeAllPrefixMatches(requests);
    const steps = simulateAnthropicCacheSequence(requests, matches, MODEL, false);

    expect(steps[0]!.writeTokens5m).toBeGreaterThan(0);
    expect(steps[0]!.readTokens).toBe(0);

    expect(steps[1]!.readTokens).toBe(steps[0]!.writeTokens5m);
    expect(steps[1]!.writeTokens5m).toBe(0);
    expect(steps[1]!.writeTokens1h).toBe(0);
  });

  it("keeps reading across a longer steady loop (3+ requests)", () => {
    const requests = [1, 2, 3, 4].map((n) => parseAnthropicRequest(withCacheControlSystem(LONG_STABLE_PROMPT, `turn ${n}`), n - 1));
    const matches = computeAllPrefixMatches(requests);
    const steps = simulateAnthropicCacheSequence(requests, matches, MODEL, false);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.readTokens).toBeGreaterThan(0);
      expect(steps[i]!.writeTokens5m).toBe(0);
    }
  });
});

describe("simulateAnthropicCacheSequence - volatile prefix (the flagship example)", () => {
  function withTimestamp(n: number) {
    const iso = new Date(Date.UTC(2026, 8, 24, 10, n, 0)).toISOString();
    return withCacheControlSystem(`Current time: ${iso}. ${LONG_STABLE_PROMPT}`, `turn ${n}`);
  }

  it("never gets a cache hit when a timestamp sits inside the cached block", () => {
    const requests = [0, 1, 2].map((n) => parseAnthropicRequest(withTimestamp(n), n));
    const matches = computeAllPrefixMatches(requests, false);
    const steps = simulateAnthropicCacheSequence(requests, matches, MODEL, false);
    for (const step of steps) {
      expect(step.readTokens).toBe(0);
    }
    // every request pays the full write premium - the signature of a busted cache.
    expect(steps[1]!.writeTokens5m).toBeGreaterThan(0);
    expect(steps[2]!.writeTokens5m).toBeGreaterThan(0);
  });

  it("recovers cache hits once the timestamp is normalized out of the prefix (the 'optimized' fix)", () => {
    const requests = [0, 1, 2].map((n) => parseAnthropicRequest(withTimestamp(n), n));
    const optimizedMatches = computeAllPrefixMatches(requests, true);
    const steps = simulateAnthropicCacheSequence(requests, optimizedMatches, MODEL, true);
    expect(steps[1]!.readTokens).toBeGreaterThan(0);
    expect(steps[2]!.readTokens).toBeGreaterThan(0);
  });
});

describe("simulateAnthropicCacheSequence - below minimum cacheable length", () => {
  it("never reads or writes when the breakpoint covers fewer tokens than the model's minimum", () => {
    const model = findAnthropicModel(MODEL);
    expect(model.minCacheableTokens).toBe(1024);
    const requests = [0, 1].map((n) => parseAnthropicRequest(withCacheControlSystem("short stable prompt", `turn ${n}`), n));
    const matches = computeAllPrefixMatches(requests);
    const steps = simulateAnthropicCacheSequence(requests, matches, MODEL, false);
    for (const step of steps) {
      expect(step.readTokens).toBe(0);
      expect(step.writeTokens5m).toBe(0);
      expect(step.writeTokens1h).toBe(0);
    }
  });
});
