import { describe, expect, it, vi } from "vitest";
import { analyze, toJsonReport } from "../src/core/index.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { calibrateRequest, countRequestTokens, countTokensBody } from "../src/core/calibrate.js";
import { computePrefixMatch } from "../src/core/prefix.js";
import { renderHtmlReport } from "../src/cli/html-report.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";

const server = (name = "alpha") => ({ type: "url", name: "diagnostics", url: `https://${name}.example.com/mcp` });
const body = (settings: Record<string, unknown> = {}) => ({ model: "claude-sonnet-4-6", max_tokens: 64,
  messages: [{ role: "user", content: "Inspect the retained incident evidence. ".repeat(1600) }],
  cache_control: { type: "ephemeral" }, ...settings });
const toolset = { type: "mcp_toolset", mcp_server_name: "diagnostics" };

describe("Anthropic connector context", () => {
  it("recognizes connector-shaped captures whose model field is absent", () => {
    const result = analyze(JSON.stringify({ mcp_servers: [server()], tools: [toolset],
      messages: [{ role: "user", content: "Retained user text." }] }));
    expect(result.parse.format).toBe("anthropic");
    expect(result.reports[0]!.totals.claudeTokensEstimate).toBeNull();
  });

  it("retains native connector settings without counting the URL or configuration as definitions", () => {
    const counter = vi.fn(() => ({ openai: 12, claude: 20 }));
    const raw = body({ mcp_servers: [server()], tools: [toolset] });
    const request = parseAnthropicRequest(raw, 0, counter);
    expect(counter).toHaveBeenCalledTimes(1);
    expect(request.segments.slice(0, 2)).toMatchObject([
      { path: "mcp_servers[0]", raw: server(), unmodeledContext: "mcp_tools",
        text: "", charLength: 0, openaiTokens: null, claudeTokensEstimate: null },
      { path: "tools[0]", raw: toolset, unmodeledContext: "mcp_tools",
        text: "", charLength: 0, openaiTokens: null, claudeTokensEstimate: null },
    ]);
    expect(request.segments[2]).toMatchObject({ openaiTokens: 12, claudeTokensEstimate: 20,
      cacheControl: { type: "ephemeral", automatic: true } });
    expect(raw).toEqual(body({ mcp_servers: [server()], tools: [toolset] }));
  });

  it.each([
    { mcp_servers: [server()] },
    { mcp_servers: [server()], tools: [{ ...toolset, default_config: { defer_loading: true } }] },
    { mcp_servers: [server()], tools: [{ ...toolset, tools: [{ name: "inspect", description: "Read evidence", input_schema: { type: "object" } }] }] },
    { tools: [{ ...toolset, cache_control: { type: "ephemeral", ttl: "1h" } }] },
    { messages: [{ role: "assistant", content: [{ type: "mcp_tool_listing", mcp_server_name: "diagnostics",
      tools: [{ name: "inspect", input_schema: { type: "object" } }] }] }] },
    { messages: [{ role: "assistant", content: [{ type: "mcp_tool_use", id: "mcptoolu_mock", name: "inspect",
      server_name: "diagnostics", input: { record: "incident" } }] }] },
    { messages: [{ role: "user", content: [{ type: "mcp_tool_result", tool_use_id: "mcptoolu_mock",
      content: [{ type: "text", text: "Retained evidence" }] }] }] },
  ])("withholds unimplemented MCP rendering without discarding its source: %j", settings => {
    const result = analyze(JSON.stringify(body(settings)));
    expect(result.reports[0]!.totals).toEqual({ openaiTokens: null, claudeTokensEstimate: null });
    expect(result.reports[0]!.percentOfContextWindow).toBeUndefined();
    expect(result.findings.some(f => f.kind === "anthropic_mcp_context")).toBe(true);
    expect(result.findings.some(f => f.kind === "openai_unmodeled_context")).toBe(false);
    expect(result.cacheSimulation.actual[0]).toMatchObject({ readTokens: null, uncachedTokens: null });
  });

  it("cannot turn a server switch into a cache hit or normalized prefix equality", () => {
    const raw = [body({ mcp_servers: [server()], tools: [toolset] }),
      body({ mcp_servers: [server("beta")], tools: [toolset] })];
    const result = analyze(JSON.stringify([body(), ...raw, body()]));
    expect(result.reports[0]!.totals.claudeTokensEstimate).toBeGreaterThan(1024);
    expect(result.reports[3]!.totals).toEqual(result.reports[0]!.totals);
    for (const steps of [result.cacheSimulation.actual, result.cacheSimulation.optimized]) for (const step of steps) {
      expect(step).toMatchObject({ readTokens: null, writeTokens5m: null, writeTokens1h: null, uncachedTokens: null });
      expect(step.costUsd).toBeUndefined();
      expect(step.unavailableReason).toContain("MCP tool context");
    }
    for (const optimized of [false, true]) {
      expect(computePrefixMatch(result.parse.requests[1]!, result.parse.requests[2]!, optimized).matchedSegments).toBe(0);
    }
    for (const report of [renderTerminalReport(result, { verbose: true }), renderHtmlReport(result)]) {
      expect(report).toContain("MCP tool context is not modeled");
      expect(report).not.toMatch(/NaN|Infinity|would save/);
    }
  });

  it("keeps recorded usage while withholding an invented comparison", () => {
    const result = analyze(JSON.stringify({ request: body({ mcp_servers: [server()], tools: [toolset] }),
      response: { usage: { input_tokens: 12000, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 400, output_tokens: 10 } } }));
    expect(result.usageComparison.rows[0]).toMatchObject({ reportedInputTokens: 12400,
      reportedReadTokens: 400, estimatedInputTokens: null, simulatedReadTokens: null,
      inputDeltaTokens: null, readDeltaTokens: null, readOutcome: "unavailable" });
    const report = toJsonReport(result);
    expect(report).toContain('"unmodeledContext": "mcp_tools"');
    expect(report).not.toContain("alpha.example.com");
  });

  it("refuses calibration before any request and never builds a body with the server silently omitted", async () => {
    const request = parseAnthropicRequest(body({ mcp_servers: [server()], tools: [toolset] }), 0);
    const fetchImpl = vi.fn();
    expect(() => calibrateRequest(request, "claude-sonnet-4-6", 12000)).toThrow(/unmodeled/);
    expect(() => countTokensBody(request, "claude-sonnet-4-6")).toThrow(/different prompt/);
    await expect(countRequestTokens("synthetic-unused", "claude-sonnet-4-6", request, { fetchImpl })).rejects.toThrow(/unmodeled/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("counts ordinary tools and quoted connector-shaped data as before", () => {
    const raw = body({ mcp_servers: [], tools: [{ name: "inspect", description: "mcp_toolset",
      input_schema: { type: "object", properties: { mcp_servers: { type: "array" } } } }],
    messages: [{ role: "user", content: JSON.stringify({ mcp_servers: [server()], tools: [toolset] }) }] });
    const result = analyze(JSON.stringify(raw));
    expect(result.parse.requests[0]!.segments.some(s => s.unmodeledContext)).toBe(false);
    expect(result.reports[0]!.totals.claudeTokensEstimate).toBeGreaterThan(0);
  });
});
