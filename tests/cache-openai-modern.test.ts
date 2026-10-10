import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";
import { simulateOpenAiCacheSequence } from "../src/core/cache-openai.js";
import { prefixPaths } from "../src/core/threads.js";

const text = (n: number, marked = false) => ({ type: "input_text", text: `Stable reference ${n}.`, ...(marked ? { prompt_cache_breakpoint: { mode: "explicit" } } : {}) });
const user = (n: number) => ({ role: "user", content: [text(n)] });
const request = (input: unknown[], mode = "implicit") => ({ model: "gpt-6-sol", input, prompt_cache_options: { mode } });
const explicit = (markers: boolean[]) => request([{ role: "user", content: markers.map((marked, i) => text(i, marked)) }], "explicit");
const simulate = (raw: unknown[], tokens = 2001) => {
  const requests = raw.map((body, i) => parseOpenAiRequest(body, i, () => ({ openai: tokens, claude: tokens })));
  const steps = simulateOpenAiCacheSequence(requests, prefixPaths(requests, false), undefined);
  steps.forEach((step, i) => {
    const total = requests[i]!.segments.reduce((sum, s) => sum + s.openaiTokens, 0);
    expect(step.readTokens + (step.writeTokens30m ?? 0) + step.uncachedTokens).toBe(total);
    expect(step.costUsd).toBeCloseTo((step.uncachedTokens * 2 + (step.writeTokens30m ?? 0) * 2.5 + step.readTokens * 0.2) / 1e6, 12);
  });
  return steps;
};

describe("modern OpenAI breakpoint caching", () => {
  it("does not read or write in explicit-only mode without markers", () => {
    const raw = explicit([false]);
    const steps = simulate([raw, raw, request([user(0)])]);
    expect(steps.map((s) => [s.readTokens, s.writeTokens30m, s.uncachedTokens]))
      .toEqual([[0, 0, 2001], [0, 0, 2001], [0, 2001, 0]]);
  });

  it("writes at 1.25x and reads exact eligible boundaries without rounding to 128", () => {
    const raw = request([user(0)]);
    const steps = simulate([raw, raw]);
    expect(steps[0]).toMatchObject({ cacheMode: "implicit", readTokens: 0, writeTokens30m: 2001, costUsd: 0.0050025 });
    expect(steps[1]).toMatchObject({ readTokens: 2001, writeTokens30m: 0, costUsd: 0.0004002 });
  });

  it.each([1023, 1024])("applies the visible prefix minimum at %i tokens", (tokens) => {
    const raw = request([user(0)]);
    const steps = simulate([raw, raw], tokens);
    expect(steps[0]!.writeTokens30m).toBe(tokens < 1024 ? 0 : tokens);
    expect(steps[1]!.readTokens).toBe(tokens < 1024 ? 0 : tokens);
  });

  it.each([272000, 272001])("prices the whole long-context request at the correct tier (%i tokens)", (tokens) => {
    const raw = request([user(0)]);
    const requests = [raw, raw].map((body, i) => parseOpenAiRequest(body, i, () => ({ openai: tokens, claude: tokens })));
    const steps = simulateOpenAiCacheSequence(requests, prefixPaths(requests, false), undefined);
    const multiplier = tokens === 272000 ? 1 : 2;
    expect(steps[0]!.costUsd).toBeCloseTo(tokens * 2.5 * multiplier / 1e6, 12);
    expect(steps[1]!.costUsd).toBeCloseTo(tokens * 0.2 * multiplier / 1e6, 12);
  });

  it("diagnoses cache boundaries within a key even when thread inference chooses another setup", () => {
    const reference = "Stable evidence for the decision. ".repeat(400);
    const body = (key: string, tail: string, mode = "implicit") => ({ ...request([{ role: "developer", content: reference }, { role: "user", content: tail }], mode), prompt_cache_key: key });
    const result = analyze(JSON.stringify([body("disabled", "a", "explicit"), body("working", "a"), body("working", "b")]));
    expect(result.findings.filter((f) => f.kind === "openai_cache_boundary")).toMatchObject([{ requestIndex: 2, detail: expect.stringContaining("with request 2") }]);
    expect(result.findings.filter((f) => f.kind === "openai_cache_disabled")).toMatchObject([{ requestIndex: 0 }]);
  });

  it("keeps nested schema fields named like cache controls in the prefix", () => {
    const body = (description: string) => ({ ...request([user(0)]), tools: [{ type: "function", name: "read", parameters: { type: "object", properties: { prompt_cache_breakpoint: { type: "string", description } } } }] });
    expect(simulate([body("first schema"), body("different schema")])[1]!.readTokens).toBe(0);
  });

  it("leaves the tail beyond an explicit breakpoint at ordinary input price", () => {
    const first = explicit([true, false]);
    const second = request([{ role: "user", content: [text(0, true), text(99)] }], "explicit");
    const steps = simulate([first, second]);
    expect(steps[0]).toMatchObject({ writeTokens30m: 2001, uncachedTokens: 2001 });
    expect(steps[1]).toMatchObject({ readTokens: 2001, writeTokens30m: 0, uncachedTokens: 2001 });
  });

  it("does not look up an old endpoint absent from the incoming explicit boundaries", () => {
    const steps = simulate([explicit([true, false]), explicit([false, true])]);
    expect(steps[1]).toMatchObject({ readTokens: 0, writeTokens30m: 4002 });
  });

  it("marker movement does not change prompt content or create a false miss", () => {
    const steps = simulate([explicit([false, true]), explicit([true, true])]);
    expect(steps[1]).toMatchObject({ readTokens: 4002, writeTokens30m: 0, uncachedTokens: 0 });
  });

  it("extending one message loses its old implicit endpoint; appending a message preserves it", () => {
    const first = request([user(0)]);
    expect(simulate([first, request([{ role: "user", content: [text(0), text(1)] }])])[1]!.readTokens).toBe(0);
    expect(simulate([first, request([user(0), user(1)])])[1]!.readTokens).toBe(2001);
    expect(simulate([first, request([{ role: "user", content: [text(0, true), text(1)] }])])[1]!.readTokens).toBe(2001);
  });

  it.each([20, 21])("looks back at up to 20 earlier eligible endings (%i appended)", (appended) => {
    const steps = simulate([request([user(0)]), request(Array.from({ length: appended + 1 }, (_, i) => user(i)))]);
    expect(steps[1]!.readTokens).toBe(appended === 20 ? 2001 : 0);
  });

  it("keeps the initial developer group as a lookup boundary beyond the message window", () => {
    const setup = [{ role: "developer", content: [text(0)] }, { role: "developer", content: [text(1)] }];
    const steps = simulate([request(setup), request([...setup, ...Array.from({ length: 30 }, (_, i) => user(i + 2))])]);
    expect(steps[0]!.writeTokens30m).toBe(4002);
    expect(steps[1]!.readTokens).toBe(4002);
  });

  it("does not write a later developer or trailing assistant message implicitly", () => {
    const raw = request([user(0), { role: "developer", content: [text(1)] }, { role: "assistant", content: [text(2)] }]);
    const steps = simulate([raw, raw]);
    expect(steps[0]).toMatchObject({ writeTokens30m: 2001, uncachedTokens: 4002 });
    expect(steps[1]).toMatchObject({ readTokens: 2001, writeTokens30m: 0, uncachedTokens: 4002 });
  });

  it("writes only the latest four explicit markers", () => {
    const steps = simulate([explicit([true, true, true, true, true]), explicit([true])]);
    expect(steps[0]!.writeTokens30m).toBe(10005);
    expect(steps[1]!.readTokens).toBe(0); // first marker was not one of the four writes
  });

  it.each([52, 53])("follows the guide's first-two plus latest-fifty lookup window (%i markers)", (count) => {
    const steps = simulate([explicit([false, false, true]), explicit(Array<boolean>(count).fill(true))]);
    expect(steps[1]!.readTokens).toBe(count === 52 ? 6003 : 0);
  });

  it("reserves one of four write slots for the implicit endpoint", () => {
    const first = request([{ role: "user", content: [text(0, true), text(1, true), text(2, true), text(3, true), text(4)] }]);
    const steps = simulate([first, explicit([true])]);
    expect(steps[1]!.readTokens).toBe(0);
  });

  it("only treats the last tool response in a consecutive group as an implicit ending", () => {
    const output = (i: number) => ({ type: "function_call_output", call_id: `call-${i}`, output: `result ${i}` });
    const steps = simulate([request([output(0)]), request([output(0), output(1)])]);
    expect(steps[1]!.readTokens).toBe(0);
    expect(steps[1]!.writeTokens30m).toBe(4002);
  });

  it("honors explicit markers inside multipart function output while preserving call routing", () => {
    const output = (call: string, n: number) => ({ type: "function_call_output", call_id: call, output: [text(0, true), text(n)] });
    const steps = simulate([request([output("a", 1)], "explicit"), request([output("a", 2)], "explicit"), request([output("b", 2)], "explicit")]);
    expect(steps.map((s) => s.readTokens)).toEqual([0, 2001, 0]);
    expect(steps[1]!.uncachedTokens).toBe(2001);
  });

  it("keeps case-sensitive cache keys and renderer settings isolated", () => {
    const raw = request([user(0)]);
    const steps = simulate([{ ...raw, prompt_cache_key: "TenantA" }, { ...raw, prompt_cache_key: "tenanta" }, { ...raw, prompt_cache_key: "TenantA" },
      { ...raw, prompt_cache_key: "TenantA", reasoning: { effort: "high" } }]);
    expect(steps.map((s) => s.readTokens)).toEqual([0, 0, 2001, 0]);
  });

  it("does not merge structured-output schemas whose property order changed", () => {
    const field = { type: "string" };
    const raw = request([user(0)]);
    const body = (properties: Record<string, unknown>) => ({ ...raw, text: { format: { type: "json_schema", name: "result", schema: { type: "object", properties } } } });
    const steps = simulate([body({ evidence: field, decision: field }), body({ decision: field, evidence: field }), body({ evidence: field, decision: field })]);
    expect(steps.map((step) => step.readTokens)).toEqual([0, 0, 2001]);
  });

  it("exercises actual Responses and Chat parsing without invented cache reads", () => {
    const content = "Stable evidence for the decision. ".repeat(400);
    for (const shape of [{ input: [{ role: "user", content }] }, { messages: [{ role: "user", content }] }]) {
      const raw = { model: "gpt-6-sol", prompt_cache_options: { mode: "explicit" }, ...shape };
      const result = analyze(JSON.stringify([raw, raw]));
      expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
      expect(result.cacheSimulation.actual[1]!.costUsd).toBe(result.cacheSimulation.actual[0]!.costUsd);
    }
  });

  it.each([{ mode: "automatic" }, { ttl: "1h" }, "implicit"])("rejects unsupported cache options %j", (options) => {
    expect(() => simulate([{ ...request([user(0)]), prompt_cache_options: options }])).toThrow(/Request 1: prompt_cache_options/);
  });
});
