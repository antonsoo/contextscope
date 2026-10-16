import { describe, expect, it } from "vitest";
import { anthropicInjectedSettings } from "../src/core/anthropic-injected-settings.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { simulateAnthropicCacheSequence } from "../src/core/cache-anthropic.js";
import { prefixPaths } from "../src/core/threads.js";
import { analyze } from "../src/core/analyze.js";
import { countRequestTokens, countTokensBody } from "../src/core/calibrate.js";

const marker = { cache_control: { type: "ephemeral" } };
const format = { type: "json_schema", schema: { type: "object", properties: {
  answer: { type: "string", description: "Supported answer" }, accepted: { type: "boolean" },
}, required: ["answer", "accepted"], additionalProperties: false } };
function body(settings: Record<string, unknown> = {}) {
  return { model: "claude-sonnet-4-6", max_tokens: 4096,
    tools: [{ name: "lookup", input_schema: { type: "object" }, ...marker }],
    system: [{ type: "text", text: "Project rules. ".repeat(300), ...marker }],
    messages: [{ role: "user", content: [{ type: "text", text: "Source records. ".repeat(300), ...marker }] }] as { role: string; content: unknown[] }[],
    ...settings };
}
function doc(enabled?: boolean, type = "document") {
  return { type, ...(type === "document"
    ? { source: { type: "text", media_type: "text/plain", data: "A retained record." } }
    : { source: "kb://reference", title: "Reference", content: [{ type: "text", text: "A retained record." }] }),
    ...(enabled === undefined ? {} : { citations: { enabled } }) };
}
function simulate(raw: unknown[], optimized = false) {
  const requests = raw.map((r, i) => parseAnthropicRequest(r, i, () => ({ openai: 1500, claude: 1500 })));
  return simulateAnthropicCacheSequence(requests, prefixPaths(requests, optimized), undefined, optimized);
}
function settings(raw: unknown) { return anthropicInjectedSettings({ raw, index: 0 }); }

describe("structured output prompt cache", () => {
  it.each([false, true])("isolates changed format and restores an earlier format (optimized=%s)", optimized => {
    const a = body({ output_config: { format } }), b = body({ output_config: { format: { ...format, schema: { type: "boolean" } } } });
    expect(simulate([a, b, a], optimized).map(s => [s.readTokens, s.writeTokens5m]))
      .toEqual([[0, 4500], [0, 4500], [4500, 0]]);
  });
  it("retains schema descriptions and property order even when compiled grammar could match", () => {
    const description = structuredClone(format); description.schema.properties.answer.description = "A different request";
    const order = structuredClone(format); order.schema.properties = { accepted: order.schema.properties.accepted, answer: order.schema.properties.answer };
    const a = body({ output_config: { format } });
    for (const changed of [description, order]) expect(simulate([a, body({ output_config: { format: changed } })])[1]!.readTokens).toBe(0);
  });
  it("normalizes nullable omission and the supported legacy alias", () => {
    expect(simulate([body(), body({ output_config: { format: null } })])[1]!.readTokens).toBe(4500);
    expect(simulate([body({ output_config: { format, effort: "high" } }), body({ output_format: format, output_config: { effort: "high" } })])[1]!.readTokens).toBe(4500);
    expect(() => settings(body({ output_config: { format }, output_format: format }))).toThrow(/select one output format/);
  });
  it.each([false, "json", { type: "text" }, { type: "json_schema", schema: [] }])("refuses unsupported format %j instead of simulating a plain prompt", format => {
    expect(() => parseAnthropicRequest(body({ output_config: { format } }), 0)).toThrow(/output format must/);
  });
  it("explains unknown injected token costs and format scope separately", () => {
    const a = body({ output_config: { format } }), b = body();
    const result = analyze(JSON.stringify([a, b]));
    expect(result.findings.some(f => f.kind === "anthropic_injected_prompt" && f.requestIndex === 0)).toBe(true);
    expect(result.findings.some(f => f.kind === "anthropic_output_cache_scope" && f.detail.includes("Grammar compilation"))).toBe(true);
  });
});

describe("citation system prompt settings", () => {
  it.each([false, true])("preserves tools while invalidating earlier system/messages (optimized=%s)", optimized => {
    const a = body(); a.messages[0]!.content.push(doc(false));
    const b = body(); b.messages[0]!.content.push(doc(true));
    expect(simulate([a, b, a], optimized).map(s => s.readTokens)).toEqual([0, 1500, optimized ? 6000 : 4500]);
  });
  it.each(["tool_result", "mcp_tool_result"])("recognizes a citable document inside %s", type => {
    const a = body(); a.messages[0]!.content.push({ type, content: [doc(true)] });
    expect(settings(a).citations).toBe(true);
    expect(settings(body({ output_config: { format }, messages: [{ role: "user", content: [{ type: "tool_use", input: doc(true) }] }] })).citations).toBe(false);
  });
  it("recognizes search results but ignores quoted JSON and data in tool schemas", () => {
    const a = body(); a.messages[0]!.content.push(doc(true, "search_result"));
    expect(settings(a).citations).toBe(true);
    const b = body(); b.messages[0]!.content.push({ type: "text", text: JSON.stringify(doc(true)) });
    Object.assign(b.tools[0]!.input_schema, { examples: [doc(true)] });
    expect(settings(b).citations).toBe(false);
  });
  it("uses disabled as the documented default without conflating response citation arrays", () => {
    const a = body(); a.messages[0]!.content.push(doc());
    const b = body(); b.messages[0]!.content.push(doc(false));
    expect(settings(a).citations).toBe(false); expect(settings(b).citations).toBe(false);
    const c = body(); c.messages[0]!.content.push({ ...doc(), citations: {} });
    expect(settings(c).citations).toBe(false);
    a.messages[0]!.content.push({ type: "text", text: "A quoted answer", citations: [{ type: "char_location", cited_text: "source" }] });
    expect(settings(a).citations).toBe(false);
  });
  it("refuses mixed, malformed and format-incompatible citation settings", () => {
    const a = body(); a.messages[0]!.content.push(doc(true), doc(false));
    expect(() => parseAnthropicRequest(a, 0)).toThrow(/mixed citation/);
    const b = body(); b.messages[0]!.content.push({ ...doc(), citations: { enabled: "true" } });
    expect(() => parseAnthropicRequest(b, 0)).toThrow(/must be boolean/);
    const c = body({ output_config: { format } }); c.messages[0]!.content.push(doc(true));
    expect(() => parseAnthropicRequest(c, 0)).toThrow(/citations and structured output/);
  });
});

describe("calibration body fidelity", () => {
  it("forwards output format, effort, speed and automatic caching while preserving schema order", async () => {
    const raw = body({ output_config: { effort: "high", format }, speed: "standard", ...marker });
    const request = parseAnthropicRequest(raw, 0);
    const count = countTokensBody(request, raw.model);
    expect(count.output_config).toBe(raw.output_config);
    expect(count.speed).toBe("standard"); expect(count.cache_control).toEqual(marker.cache_control);
    expect(count).not.toHaveProperty("max_tokens");
    expect(JSON.stringify((count.output_config as { format: unknown }).format)).toBe(JSON.stringify(format));
    let sent: unknown;
    await countRequestTokens("synthetic", raw.model, request, { browser: false, fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init!.body)); return new Response(JSON.stringify({ input_tokens: 100 }), { status: 200 });
    } });
    expect(sent).toEqual(count);
  });
  it("migrates legacy format without mutating the original request", () => {
    const raw = body({ output_format: format, output_config: { effort: "high" } });
    const count = countTokensBody(parseAnthropicRequest(raw, 0), raw.model);
    expect(count.output_config).toEqual({ effort: "high", format });
    expect(count).not.toHaveProperty("output_format");
    expect(raw.output_config).toEqual({ effort: "high" });
  });
});
