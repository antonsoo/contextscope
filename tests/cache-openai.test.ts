import { describe, expect, it } from "vitest";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";
import { computeAllPrefixMatches } from "../src/core/prefix.js";
import { simulateOpenAiCacheSequence } from "../src/core/cache-openai.js";
import { findOpenAiModel } from "../src/core/pricing.js";

const MODEL = "gpt-6-sol";
const LONG_STABLE_SYSTEM = "You are a meticulous, detail-oriented coding assistant. ".repeat(120);

function req(userText: string) {
  return {
    model: MODEL,
    messages: [
      { role: "system", content: LONG_STABLE_SYSTEM },
      { role: "user", content: userText },
    ],
  };
}

describe("simulateOpenAiCacheSequence", () => {
  it("caches nothing on the first request (cold cache)", () => {
    const requests = [parseOpenAiRequest(req("turn 1"), 0)];
    const steps = simulateOpenAiCacheSequence(requests, [], MODEL);
    expect(steps[0]!.readTokens).toBe(0);
  });

  it("caches the shared prefix on request 2, rounded down to 128 tokens", () => {
    const requests = [parseOpenAiRequest(req("turn 1"), 0), parseOpenAiRequest(req("turn 2"), 1)];
    const matches = computeAllPrefixMatches(requests);
    const steps = simulateOpenAiCacheSequence(requests, matches, MODEL);
    expect(steps[1]!.readTokens).toBeGreaterThan(0);
    expect(steps[1]!.readTokens % 128).toBe(0);
    expect(steps[1]!.readTokens).toBeLessThanOrEqual(matches[0]!.matchedOpenaiTokens);
  });

  it("caches nothing below the 1024-token minimum", () => {
    const short = { model: MODEL, messages: [{ role: "system", content: "short" }, { role: "user", content: "hi" }] };
    const requests = [parseOpenAiRequest(short, 0), parseOpenAiRequest(short, 1)];
    const matches = computeAllPrefixMatches(requests);
    const steps = simulateOpenAiCacheSequence(requests, matches, MODEL);
    expect(steps[1]!.readTokens).toBe(0);
  });

  it("prices cached vs uncached tokens using the model's cached-input rate", () => {
    const model = findOpenAiModel(MODEL);
    const requests = [parseOpenAiRequest(req("turn 1"), 0), parseOpenAiRequest(req("turn 2"), 1)];
    const matches = computeAllPrefixMatches(requests);
    const steps = simulateOpenAiCacheSequence(requests, matches, MODEL);
    const step = steps[1]!;
    const expectedCost = step.uncachedTokens * (model.inputPricePerMTok / 1_000_000) + step.readTokens * (model.cachedInputPricePerMTok / 1_000_000);
    expect(step.costUsd).toBeCloseTo(expectedCost, 10);
    // cached tokens must be materially cheaper per-token than uncached, per the fetched pricing.
    expect(model.cachedInputPricePerMTok).toBeLessThan(model.inputPricePerMTok);
  });
});
