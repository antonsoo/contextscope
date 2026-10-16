import { describe, expect, it } from "vitest";
import { anthropicMessageCacheScope } from "../src/core/anthropic-cache-scope.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { simulateAnthropicCacheSequence } from "../src/core/cache-anthropic.js";
import { prefixPaths } from "../src/core/threads.js";
import { analyze } from "../src/core/analyze.js";

const marker = { cache_control: { type: "ephemeral" } };
const image = { type: "image", source: { type: "url", url: "https://example.com/diagram.png" } };
function body(choice: unknown = { type: "auto" }, setupMarker = true) {
  return {
    model: "claude-sonnet-4-5", tool_choice: choice,
    tools: [{ name: "lookup", input_schema: { type: "object" } }],
    system: [{ type: "text", text: "Stable project notes. ".repeat(250), ...(setupMarker ? marker : {}) }],
    messages: [{ role: "user", content: [{ type: "text", text: "Stable reference text. ".repeat(250), ...marker }] }] as { role: string; content: unknown[] }[],
  };
}
function scope(raw: unknown) { return anthropicMessageCacheScope(parseAnthropicRequest(raw, 0)); }
function simulate(raw: unknown[], optimized = false) {
  // Exactly 1100 per block: isolate cache-scope decisions from token estimation.
  // A real media import now has unknown counts. Here only, supply an explicit
  // synthetic per-block count, as a future media-aware caller could do.
  const requests = raw.map((r, i) => parseAnthropicRequest(r, i, () => ({ openai: 1100, claude: 1100 })));
  for (const request of requests) for (const segment of request.segments) if (segment.unmodeledContent) {
    segment.openaiTokens = 1100; segment.claudeTokensEstimate = 1100;
    delete segment.unmodeledContent;
  }
  return simulateAnthropicCacheSequence(requests, prefixPaths(requests, optimized), undefined, optimized);
}

describe("Anthropic message-cache settings", () => {
  it.each([false, true])("invalidates only message entries and retains earlier scopes (optimized=%s)", (optimized) => {
    const steps = simulate([body(), body({ type: "any" }), body(), body({ type: "any" })], optimized);
    expect(steps.map((s) => [s.readTokens, s.writeTokens5m])).toEqual([[0, 3300], [2200, 1100], [3300, 0], [3300, 0]]);
  });

  it.each([false, true])("does not invent a setup entry inside a cached message prefix (optimized=%s)", (optimized) => {
    const steps = simulate([body({ type: "auto" }, false), body({ type: "any" }, false), body({ type: "auto" }, false)], optimized);
    expect(steps.map((s) => s.readTokens)).toEqual([0, 0, 3300]);
  });

  it("treats omitted choices and disabled=false as the documented defaults", () => {
    const omitted = body();
    delete (omitted as { tool_choice?: unknown }).tool_choice;
    expect(simulate([omitted, body({ type: "auto" }), body({ disable_parallel_tool_use: false, type: "auto" })]).map((s) => s.readTokens)).toEqual([0, 3300, 3300]);
    const noTools = { ...omitted, tools: [] };
    expect(simulate([noTools, { ...noTools, tool_choice: { type: "none" } }]).map((s) => s.readTokens)).toEqual([0, 2200]);
  });

  it("ignores key order but retains parallel policy and the forced tool name", () => {
    const first = body({ type: "tool", name: "lookup", disable_parallel_tool_use: true });
    const reordered = body({ disable_parallel_tool_use: true, name: "lookup", type: "tool" });
    expect(simulate([first, reordered, body({ type: "tool", name: "lookup" })]).map((s) => s.readTokens)).toEqual([0, 3300, 2200]);
    expect(scope(body({ type: "tool", name: "lookup" }))).not.toEqual(scope(body({ type: "tool", name: "other" })));
  });

  it("never volatile-normalizes settings in the optimized scenario", () => {
    const names = ["b7f81470-1ce0-4a22-9b1e-06872c3fda80", "013bd2af-d420-4599-a2bf-ae150c07d211"];
    const sequence = names.map((name) => ({ ...body({ type: "tool", name }), tools: names.map((tool) => ({ name: tool, input_schema: { type: "object" } })) }));
    expect(simulate(sequence, true).map((s) => s.readTokens)).toEqual([0, 3300]);
  });

  it("keeps model identity independent of the settings scope", () => {
    const other = { ...body({ type: "any" }), model: "claude-sonnet-5" };
    expect(simulate([body(), other, body({ type: "any" }), body()]).map((s) => s.readTokens)).toEqual([0, 0, 2200, 3300]);
  });

  it("scopes role:system messages as messages", () => {
    const a = body(); a.messages[0]!.role = "system";
    const b = body({ type: "any" }); b.messages[0]!.role = "system";
    expect(simulate([a, b]).map((s) => s.readTokens)).toEqual([0, 2200]);
  });

  it("keeps mixed-TTL accounting disjoint after a settings miss", () => {
    const a = body(), b = body({ type: "any" });
    for (const r of [a, b]) r.system[0]!.cache_control = Object.assign({}, marker.cache_control, { ttl: "1h" });
    const steps = simulate([a, b]);
    expect(steps.map((s) => [s.readTokens, s.writeTokens1h, s.writeTokens5m, s.uncachedTokens])).toEqual([[0, 2200, 1100, 0], [2200, 0, 1100, 0]]);
  });

  it.each([false, true])("invalidates message entries when an image is added after a marker (optimized=%s)", (optimized) => {
    const withImage = body(); withImage.messages[0]!.content.push(image);
    expect(simulate([body(), withImage, body(), withImage], optimized).map((s) => s.readTokens)).toEqual([0, 2200, 3300, optimized ? 4400 : 3300]);
  });

  it.each(["tool_result", "mcp_tool_result", "document"])("finds actual image content inside %s", (type) => {
    const block = type === "document" ? { type, source: { type: "content", content: [image] } } : { type, content: [image] };
    const withImage = body(); withImage.messages[0]!.content.push(block);
    expect(scope(withImage).hasImages).toBe(true);
    expect(simulate([body(), withImage]).map((s) => s.readTokens)).toEqual([0, 2200]);
  });

  it("does not treat tool input, tool schemas, or quoted image JSON as an image", () => {
    const json = body();
    json.messages[0]!.content.push({ type: "tool_use", input: image }, { type: "text", text: JSON.stringify(image) });
    Object.assign(json.tools[0]!.input_schema, { properties: { description: { const: image } } });
    expect(scope(json).hasImages).toBe(false);
  });

  it("changing an image after the marker keeps the existing image-present scope", () => {
    const a = body(), b = body();
    a.messages[0]!.content.push(image);
    b.messages[0]!.content.push({ ...image, source: { type: "url", url: "https://example.com/other.png" } });
    expect(simulate([a, b]).map((s) => s.readTokens)).toEqual([0, 3300]);
  });

  it("explains the changed settings without changing content-prefix evidence", () => {
    const result = analyze(JSON.stringify([body(), body({ type: "any" }), body()]));
    expect(result.prefixMatches.every((m) => m.matchedSegments === 3)).toBe(true);
    const finding = result.findings.find((f) => f.kind === "anthropic_message_cache_scope");
    expect(finding).toMatchObject({ severity: "info", requestIndex: 1, title: "Message cache settings changed" });
    expect(finding!.detail).toContain("tool_choice");
    expect(finding!.detail).toContain("earlier request with the current settings");
    expect(result.cacheSimulation.actual[2]!.readTokens).toBe(result.cacheSimulation.actual[0]!.writeTokens5m);
  });

  it("does not warn about harmless settings changes when only setup is marked", () => {
    const a = body(), b = body({ type: "any" });
    for (const r of [a, b]) r.messages = [{ role: "user", content: [{ type: "text", text: "Unmarked turn" }] }];
    expect(analyze(JSON.stringify([a, b])).findings.some((f) => f.kind === "anthropic_message_cache_scope")).toBe(false);
  });
});
