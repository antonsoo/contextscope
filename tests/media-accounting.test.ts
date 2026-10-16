import { describe, it, expect, vi } from "vitest";
import { analyze, calibrateRequest, countRequestTokens, countTokensBody, toJsonReport } from "../src/core/index.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";
import { unmodeledMedia } from "../src/core/media-accounting.js";
import { renderHtmlReport } from "../src/cli/html-report.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";

const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "not-a-token-stream" } };
const text = { type: "text", text: "Review the retained record." };
const claude = (block: unknown = text) => ({ model: "claude-sonnet-4-6", max_tokens: 100,
  messages: [{ role: "user", content: [text, block] }] });
const gpt = (block: unknown) => ({ model: "gpt-5.1", input: [{ role: "user", content: [{ type: "input_text", text: text.text }, block] }] });

describe("media transport does not establish token counts", () => {
  it("never sends a media payload to the text tokenizer, and preserves original identity", () => {
    const counter = vi.fn(() => ({ openai: 13, claude: 17 }));
    const a = parseAnthropicRequest(claude(image), 0, counter);
    expect(counter.mock.calls).toHaveLength(1);
    expect(a.segments[1]).toMatchObject({ text: "", charLength: 0, openaiTokens: null, claudeTokensEstimate: null, unmodeledContent: ["image"], raw: image });
    expect(a.segments[1]!.prefix!.content).toEqual(image);
    const request = claude(image);
    const changed = claude({ ...image, source: { ...image.source, data: "different-payload" } });
    const result = analyze(JSON.stringify([request, changed, changed]));
    expect(result.prefixMatches.map(p => p.matchedSegments)).toEqual([1, 2]);
    const textCount = analyze(JSON.stringify(request)).reports[0]!.segments[0]!.claudeTokensEstimate;
    expect(result.prefixMatches.map(p => p.matchedClaudeTokensEstimate)).toEqual([textCount, null]);
    expect(result.prefixMatches[0]!.diff.some(line => line.text.includes("media content; token count unavailable"))).toBe(true);
    expect(result.prefixMatches[0]!.diff.some(line => line.text.includes("prompt metadata or message boundary changed"))).toBe(false);
  });

  it.each(["tool_result", "mcp_tool_result"])("recognizes an image nested inside %s", type => {
    const result = analyze(JSON.stringify(claude({ type, content: [text, image] })));
    expect(result.reports[0]!.totals.claudeTokensEstimate).toBeNull();
    expect(result.reports[0]!.segments[1]!.unmodeledContent).toEqual(["image"]);
  });

  it("recognizes custom-document images and opaque documents returned by web fetch", () => {
    expect(unmodeledMedia({ type: "document", source: { type: "content", content: [text, image] } }, "anthropic")).toEqual(["image"]);
    expect(unmodeledMedia({ type: "web_fetch_tool_result", content: { type: "web_fetch_result", content: {
      type: "document", source: { type: "url", url: "https://example.invalid/record.pdf" },
    } } }, "anthropic")).toEqual(["document"]);
    expect(unmodeledMedia({ type: "document", source: { type: "text", data: "Plain source" } }, "anthropic")).toEqual([]);
    expect(unmodeledMedia({ type: "document", source: { type: "content", content: [text] } }, "anthropic")).toEqual([]);
  });

  it.each(["input_image", "input_file", "input_audio", "computer_screenshot"])("keeps %s unavailable in OpenAI content", type => {
    const request = parseOpenAiRequest(gpt({ type, file_id: "synthetic", image_url: "https://example.invalid/source" }), 0);
    expect(request.segments[1]!.openaiTokens).toBeNull();
  });

  it("never follows tool inputs, schemas or quoted JSON into media controls", () => {
    for (const provider of ["anthropic", "openai"] as const) {
      expect(unmodeledMedia({ type: "tool_use", input: image }, provider)).toEqual([]);
      expect(unmodeledMedia({ type: "text", text: JSON.stringify(image) }, provider)).toEqual([]);
      expect(unmodeledMedia({ name: "inspect", input_schema: { examples: [image] } }, provider)).toEqual([]);
    }
    const result = analyze(JSON.stringify(claude({ type: "text", text: JSON.stringify(image) })));
    expect(result.reports[0]!.totals.claudeTokensEstimate).toBeGreaterThan(0);
    expect(result.cacheSimulation.actual[0]!.uncachedTokens).toBeGreaterThan(0);
  });
});

describe("unknowns survive reports, cache state and captured usage", () => {
  it("withholds whole-sequence simulation instead of seeding later requests from unknown lengths", () => {
    const result = analyze(JSON.stringify([claude(), claude(image), claude()]));
    expect(result.reports[0]!.totals.claudeTokensEstimate).toBeGreaterThan(0);
    expect(result.reports[1]!.totals).toEqual({ openaiTokens: null, claudeTokensEstimate: null });
    expect(result.reports[1]!.percentOfContextWindow).toBeUndefined();
    for (const scenario of [result.cacheSimulation.actual, result.cacheSimulation.optimized]) for (const step of scenario) {
      expect(step).toMatchObject({ readTokens: null, writeTokens5m: null, writeTokens1h: null, uncachedTokens: null });
      expect(step.costUsd).toBeUndefined();
    }
    expect(result.cacheSimulation.totalActualCostUsd).toBeUndefined();
    expect(toJsonReport(result)).toContain('"unmodeledContent"');
    expect(toJsonReport(result)).not.toContain(image.source.data);
    for (const output of [renderHtmlReport(result), renderTerminalReport(result, { verbose: true })]) {
      expect(output).toContain("Media token counts are unavailable");
      expect(output).not.toMatch(/NaN|Infinity|would save/);
    }
  });

  it.each([0, 400])("keeps synthetic captured reads of %s known without inventing a comparison", reads => {
    const result = analyze(JSON.stringify({ request: claude(image), response: { usage: {
      input_tokens: 800, cache_read_input_tokens: reads, cache_creation_input_tokens: 0, output_tokens: 10,
    } } }));
    expect(result.usageComparison.rows[0]).toMatchObject({ reportedInputTokens: 800 + reads,
      reportedReadTokens: reads, estimatedInputTokens: null, simulatedReadTokens: null,
      inputDeltaTokens: null, readDeltaTokens: null, readOutcome: "unavailable" });
    expect(result.usageComparison.cacheRead).toMatchObject({ reportedTokens: reads, simulatedTokens: null, deltaTokens: null });
    expect(result.parse.requests[0]!.reportedUsage!.counters.some(c => c.path.endsWith("cache_read_input_tokens") && c.value === reads)).toBe(true);
  });

  it("keeps zero text counts distinct from unavailable media counts under scaling", () => {
    const empty = analyze(JSON.stringify({ ...claude(), messages: [{ role: "user", content: [] }] }));
    expect(empty.reports[0]!.totals).toEqual({ openaiTokens: 0, claudeTokensEstimate: 0 });
    expect(empty.cacheSimulation.actual[0]!.uncachedTokens).toBe(0);
    const result = analyze(JSON.stringify(claude(image)), { claudeTokenScale: 2 });
    expect(result.reports[0]!.segments[1]!.claudeTokensEstimate).toBeNull();
    expect(result.reports[0]!.totals.claudeTokensEstimate).toBeNull();
  });

  it("retains unsupported-cache-setting diagnostics even when media counts are unknown", () => {
    expect(() => analyze(JSON.stringify({ ...gpt({ type: "input_image", image_url: "source" }), prompt_cache_options: { mode: "unsupported" } }))).toThrow(/prompt_cache_options/);
    expect(() => analyze(JSON.stringify({ ...gpt({ type: "input_image", image_url: "source" }), prompt_cache_options: { mode: "explicit" } }))).toThrow(/legacy caching/);
    expect(() => analyze(JSON.stringify({ ...claude(image), cache_control: { type: "ephemeral", ttl: "invalid" } }))).toThrow(/TTL/);
  });

  it("does not recommend duplicate removal based on encoded payload size", () => {
    const repeated = { type: "text", text: "Retain this source evidence and its original context. ".repeat(100) };
    const media = { ...image, source: { ...image.source, data: "aGVsbG8=".repeat(300) } };
    const request = claude({ type: "tool_result", tool_use_id: "capture-a", content: [media] });
    request.messages[0]!.content.push({ type: "tool_result", tool_use_id: "capture-b", content: [media] }, repeated, repeated);
    const result = analyze(JSON.stringify(request));
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]!.members.map(m => m.segmentId)).toEqual(["messages[0].content[3]", "messages[0].content[4]"]);
  });

  it("refuses scalar media calibration before any provider call but retains the native count body", async () => {
    const request = parseAnthropicRequest(claude(image), 0);
    expect(() => calibrateRequest(request, request.model!, 1200)).toThrow(/unmodeled media/);
    const fetchImpl = vi.fn();
    await expect(countRequestTokens("synthetic", request.model!, request, { fetchImpl })).rejects.toThrow(/unmodeled media/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((countTokensBody(request, request.model!).messages as { content: unknown[] }[])[0]!.content[1]).toEqual(image);
  });
});
