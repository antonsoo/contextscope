import { describe, expect, it } from "vitest";
import { CalibrationError, calibrateRequest, calibrationScale, countRequestTokens, countTokensBody } from "../src/core/calibrate.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";
import { analyze } from "../src/core/analyze.js";

const body = {
  model: "claude-sonnet-5",
  max_tokens: 4096,
  stream: true,
  metadata: { user_id: "u1" },
  system: "You are terse.",
  tools: [{ name: "search", description: "search", input_schema: { type: "object" } }],
  tool_choice: { type: "auto" },
  messages: [{ role: "user", content: "hello there, how are you today?" }],
};
const request = parseAnthropicRequest(body, 0);

function fakeFetch(status: number, payload: unknown, seen?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (seen) {
      seen.url = String(url);
      if (init) seen.init = init;
    }
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status });
  }) as typeof fetch;
}

describe("countTokensBody", () => {
  it("keeps only the fields that make up the prompt", () => {
    expect(countTokensBody(request, "claude-opus-5")).toEqual({
      model: "claude-opus-5",
      system: body.system,
      tools: body.tools,
      tool_choice: body.tool_choice,
      messages: body.messages,
    });
  });

  it("refuses a request with nothing to count", () => {
    expect(() => countTokensBody(parseAnthropicRequest({ model: "x" }, 3), "claude-opus-5")).toThrow(/Request 4 has no messages/);
  });
});

describe("countRequestTokens", () => {
  it("returns the exact count and the scale against the heuristic", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const estimated = request.segments.reduce((sum, s) => sum + s.claudeTokensEstimate, 0);
    const result = await countRequestTokens("sk-test", "claude-sonnet-5", request, { fetchImpl: fakeFetch(200, { input_tokens: estimated * 2 }, seen), browser: false });
    expect(result).toMatchObject({ requestIndex: 0, model: "claude-sonnet-5", exactTokens: estimated * 2, estimatedTokens: estimated });
    expect(result.scale).toBeCloseTo(2);
    expect(seen.url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
    const headers = seen.init!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBeUndefined();
    expect(JSON.parse(String(seen.init!.body))).not.toHaveProperty("max_tokens");
  });

  it("sends the CORS opt-in header only from a browser", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await countRequestTokens("sk-test", "claude-sonnet-5", request, { fetchImpl: fakeFetch(200, { input_tokens: 10 }, seen), browser: true });
    expect((seen.init!.headers as Record<string, string>)["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("surfaces the API's own error message", async () => {
    const error = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
    await expect(countRequestTokens("bad", "claude-sonnet-5", request, { fetchImpl: fakeFetch(401, error), browser: false })).rejects.toThrow("count_tokens failed (HTTP 401): invalid x-api-key");
  });

  it("rejects a response without input_tokens, a blank key, and non-Anthropic requests", async () => {
    await expect(countRequestTokens("sk", "m", request, { fetchImpl: fakeFetch(200, {}), browser: false })).rejects.toBeInstanceOf(CalibrationError);
    await expect(countRequestTokens("  ", "m", request, { fetchImpl: fakeFetch(200, { input_tokens: 5 }), browser: false })).rejects.toThrow(/API key/);
    const openai = parseOpenAiRequest({ model: "gpt-6-sol", messages: [{ role: "user", content: "hi" }] }, 0);
    await expect(countRequestTokens("sk", "m", openai, { fetchImpl: fakeFetch(200, { input_tokens: 5 }), browser: false })).rejects.toThrow(/only applies to Anthropic/);
  });
});

describe("analyze() with claudeTokenScale", () => {
  it("scales every Claude estimate, and the costs with them", () => {
    const input = JSON.stringify([body, body]);
    const raw = analyze(input);
    const scaled = analyze(input, { claudeTokenScale: 1.5 });
    expect(scaled.claudeTokenScale).toBe(1.5);
    const rawTotal = raw.reports[0]!.totals.claudeTokensEstimate;
    expect(scaled.reports[0]!.totals.claudeTokensEstimate).toBeGreaterThan(rawTotal * 1.4);
    expect(scaled.reports[0]!.totals.openaiTokens).toBe(raw.reports[0]!.totals.openaiTokens);
    expect(scaled.cacheSimulation.totalActualCostUsd!).toBeGreaterThan(raw.cacheSimulation.totalActualCostUsd!);
  });

  it("ignores a nonsensical scale", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(analyze(JSON.stringify(body), { claudeTokenScale: bad }).claudeTokenScale).toBe(1);
  });
});

describe("local measured calibration", () => {
  it("uses unscaled request estimates and preserves request/model provenance", () => {
    const local = calibrateRequest(request, "claude-sonnet-5", 1234);
    expect(local).toMatchObject({ requestIndex: 0, model: "claude-sonnet-5", exactTokens: 1234 });
    expect(local.scale * local.estimatedTokens).toBeCloseTo(1234);
    expect(calibrateRequest(request, "claude-sonnet-5", 1234)).toEqual(local);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid measured count %s", (count) => {
    expect(() => calibrateRequest(request, "m", count)).toThrow(CalibrationError);
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid reference estimate %s", (count) => {
    expect(() => calibrationScale(10, count)).toThrow(CalibrationError);
  });

  it.each([null, [], {}, { input_tokens: 1.5 }, { input_tokens: 0 }, { input_tokens: 1e100 }])("rejects malformed API counts %j", async (payload) => {
    await expect(countRequestTokens("sk", "m", request, { fetchImpl: fakeFetch(200, payload), browser: false })).rejects.toBeInstanceOf(CalibrationError);
  });
});
