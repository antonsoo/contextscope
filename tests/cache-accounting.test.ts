import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { simulateAnthropicCacheSequence } from "../src/core/cache-anthropic.js";
import { prefixPaths } from "../src/core/threads.js";
import type { CacheTtl } from "../src/core/types.js";

const MODEL = "claude-sonnet-4-5";
type Marker = CacheTtl | null;
const body = (markers: Marker[], count = markers.length) => ({
  model: MODEL,
  max_tokens: 64,
  messages: [{ role: "user", content: Array.from({ length: count }, (_, i) => ({
    type: "text", text: `Reference section ${i}: ${"Stable technical reference. ".repeat(200)}`,
    ...(markers[i] ? { cache_control: { type: "ephemeral", ttl: markers[i] } } : {}),
  })) }],
});

function simulate(markers: Marker[][], optimized = false) {
  // Exact controlled block sizes isolate cache accounting from the Claude estimator.
  const requests = markers.map((m, i) => parseAnthropicRequest(body(m), i, () => ({ openai: 2000, claude: 2000 })));
  return simulateAnthropicCacheSequence(requests, prefixPaths(requests, false), MODEL, optimized);
}

describe("Anthropic cache accounting across breakpoints", () => {
  it.each(["5m", "1h"] as const)("does not bill an earlier %s miss inside a later cache hit", (ttl) => {
    const step = simulate([[null, "5m"], [ttl, "5m"]])[1]!;
    expect(step).toMatchObject({ readTokens: 4000, writeTokens5m: 0, writeTokens1h: 0, uncachedTokens: 0 });
    expect(step.costUsd).toBeCloseTo(0.0012, 10);
  });

  it("partitions a mixed-TTL request after finding the longest hit", () => {
    const step = simulate([[null, "5m"], ["1h", null, "1h", "5m", null]])[1]!;
    expect(step).toMatchObject({ readTokens: 4000, writeTokens1h: 2000, writeTokens5m: 2000, uncachedTokens: 2000 });
    expect(step.costUsd).toBeCloseTo(0.0267, 10);
  });

  it("matches the documented A/B/C billing partition for every valid four-block placement", () => {
    const placements: Marker[][] = [];
    for (let mask = 0; mask < 81; mask++) {
      let n = mask;
      const markers = Array.from({ length: 4 }, () => {
        const marker = ([null, "1h", "5m"] as const)[n % 3]!;
        n = Math.floor(n / 3);
        return marker;
      });
      const short = markers.indexOf("5m");
      if (short < 0 || !markers.slice(short).includes("1h")) placements.push(markers);
    }
    for (const prior of placements) for (const current of placements) {
      const step = simulate([prior, current])[1]!;
      const last = current.findLastIndex((m) => m !== null);
      const hit = prior.findLastIndex((m, i) => m !== null && i <= last);
      const a = (hit + 1) * 2000;
      const b = Math.max(a, (current.lastIndexOf("1h") + 1) * 2000);
      const c = (last + 1) * 2000;
      expect([step.readTokens, step.writeTokens1h, step.writeTokens5m, step.uncachedTokens], `${prior} -> ${current}`)
        .toEqual([a, b - a, c - b, 8000 - c]);
    }
  });

  it.each([19, 20, 21])("checks the breakpoint itself plus at most 19 preceding positions (%i appended)", (appended) => {
    const current: Marker[] = [...Array<null>(appended).fill(null), "5m"];
    const step = simulate([["5m"], current])[1]!;
    expect(step.readTokens).toBe(appended < 20 ? 2000 : 0);
  });

  it("reports the exact lookback boundary in the full analysis", () => {
    const result = analyze(JSON.stringify([body(["5m"]), body([...Array<null>(20).fill(null), "5m"])]));
    expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
    expect(result.findings.filter((f) => f.kind === "lookback_window_exceeded")).toHaveLength(1);
  });

  it("makes room for an optimized tail marker when all four slots are occupied", () => {
    const markers: Marker[] = ["1h", "1h", "5m", "5m", null];
    const steps = simulate([markers, [...markers, null]], true);
    expect(steps[0]).toMatchObject({ readTokens: 0, writeTokens1h: 4000, writeTokens5m: 6000, uncachedTokens: 0 });
    expect(steps[1]).toMatchObject({ readTokens: 10000, writeTokens1h: 0, writeTokens5m: 2000, uncachedTokens: 0 });
  });

  it("never places the optimized marker on trailing thinking or empty text", () => {
    const raw = {
      model: MODEL,
      messages: [{ role: "user", content: [
        { type: "text", text: "Stable reference. ".repeat(400) },
        { type: "thinking", thinking: "retained reasoning", signature: "synthetic" },
        { type: "text", text: "" },
      ] }],
    };
    const requests = [0, 1].map((i) => parseAnthropicRequest(raw, i, () => ({ openai: 2000, claude: 2000 })));
    const steps = simulateAnthropicCacheSequence(requests, prefixPaths(requests, false), MODEL, true);
    expect(steps[0]).toMatchObject({ writeTokens5m: 2000, uncachedTokens: 4000 });
    expect(steps[1]).toMatchObject({ readTokens: 2000, writeTokens5m: 0, uncachedTokens: 4000 });
  });
});
