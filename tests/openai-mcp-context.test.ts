import { describe, expect, it, vi } from "vitest";
import { analyze, toJsonReport } from "../src/core/index.js";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";

const tool = { type: "mcp", server_label: "diagnostics", server_url: "https://alpha.example.com/mcp",
  require_approval: "never" };
const text = "Inspect the retained incident evidence. ".repeat(1600);
const body = (settings: Record<string, unknown> = {}) => ({ model: "gpt-5.1", input: text, ...settings });

describe("Responses MCP context", () => {
  it("recognizes MCP declaration-only captures whose model and input are absent", () => {
    const result = analyze(JSON.stringify({ tools: [tool] }));
    expect(result.parse.format).toBe("openai");
    expect(result.reports[0]!.totals.openaiTokens).toBeNull();
  });

  it.each([
    tool,
    { type: "mcp", server_label: "drive", connector_id: "connector_googledrive", authorization: "synthetic-unused" },
    { type: "mcp", server_label: "diagnostics", tunnel_id: "tunnel_synthetic" },
  ])("retains the connector as an unknown unit without tokenizing connection metadata", definition => {
    const counter = vi.fn(() => ({ openai: 12, claude: 20 }));
    const request = parseOpenAiRequest(body({ tools: [definition] }), 0, counter);
    expect(counter).toHaveBeenCalledTimes(1);
    expect(request.segments[0]).toMatchObject({ path: "tools[0]", raw: definition, text: "", charLength: 0,
      unmodeledContext: "mcp_tools", openaiTokens: null, claudeTokensEstimate: null });
    expect(request.segments[1]).toMatchObject({ openaiTokens: 12, claudeTokensEstimate: 20 });
  });

  it.each(["mcp_list_tools", "mcp_call", "mcp_approval_request", "mcp_approval_response"])(
    "keeps %s protocol items inspectable instead of counting their serialized metadata", type => {
      const item = { type, id: "controlled", server_label: "diagnostics", tools: [],
        name: "inspect", arguments: "{}", output: "Retained result.", approval_request_id: "approval_controlled", approve: false };
      const counter = vi.fn(() => ({ openai: 12, claude: 20 }));
      const request = parseOpenAiRequest(body({ input: [item, { role: "user", content: text }] }), 0, counter);
      expect(counter).toHaveBeenCalledTimes(1);
      expect(request.segments[0]).toMatchObject({ path: "input[0]", raw: item,
        unmodeledContext: "mcp_tools", openaiTokens: null, claudeTokensEstimate: null });
    });

  it("withholds sequence costs and retains reported counters, including zero reads", () => {
    const request = body({ tools: [tool] });
    const rows = [0, 400].map(read => ({ request, response: { usage: { input_tokens: 12000,
      input_tokens_details: { cached_tokens: read }, output_tokens: 10, total_tokens: 12010 } } }));
    const result = analyze(JSON.stringify(rows));
    for (const report of result.reports) {
      expect(report.totals).toEqual({ openaiTokens: null, claudeTokensEstimate: null });
      expect(report.percentOfContextWindow).toBeUndefined();
    }
    for (const scenario of [result.cacheSimulation.actual, result.cacheSimulation.optimized]) for (const step of scenario) {
      expect(step).toMatchObject({ readTokens: null, writeTokens5m: null, writeTokens1h: null, uncachedTokens: null });
      expect(step.costUsd).toBeUndefined();
    }
    expect(result.usageComparison.rows.map(row => row.reportedReadTokens)).toEqual([0, 400]);
    for (const row of result.usageComparison.rows) {
      expect(row.estimatedInputTokens).toBeNull(); expect(row.simulatedReadTokens).toBeNull();
      expect(row.inputDeltaTokens).toBeNull(); expect(row.readDeltaTokens).toBeNull();
    }
    expect(result.findings.some(f => f.kind === "openai_mcp_context")).toBe(true);
    expect(result.findings.some(f => f.kind === "openai_unmodeled_context")).toBe(false);
    expect(toJsonReport(result)).not.toContain("alpha.example.com");
  });

  it("does not confuse function names, quoted MCP data or schemas with connector configuration", () => {
    const result = analyze(JSON.stringify(body({ tools: [{ type: "function", name: "mcp", description: "mcp_list_tools",
      parameters: { type: "object", properties: { type: { const: "mcp" } } } }],
    input: [{ role: "user", content: JSON.stringify(tool) },
      { type: { toString: "mcp_call" }, role: "user", content: "Retained malformed-type content." }] })));
    expect(result.parse.requests[0]!.segments.some(segment => segment.unmodeledContext)).toBe(false);
    expect(result.reports[0]!.totals.openaiTokens).toBeGreaterThan(0);
  });
});
