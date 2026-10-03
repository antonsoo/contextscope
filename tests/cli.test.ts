import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "../src/cli/args.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";
import { analyze } from "../src/core/analyze.js";

describe("parseArgs", () => {
  it("parses the full option set", () => {
    expect(parseArgs(["analyze", "s.jsonl", "--format", "openai", "--model", "gpt-6-luna", "--fail-on", "warning", "-v", "--calibrate", "--html", "r.html"])).toMatchObject({
      command: "analyze",
      file: "s.jsonl",
      format: "openai",
      model: "gpt-6-luna",
      failOn: "warning",
      verbose: true,
      calibrate: true,
      html: "r.html",
    });
  });

  it.each([
    [["analyze", "f", "--format", "gemini"], /--format must be/],
    [["analyze", "f", "--fail-on", "fatal"], /--fail-on must be/],
    [["analyze", "f", "--model"], /--model needs a value/],
    [["analyze", "f", "--model", "--verbose"], /--model needs a value/],
    [["analyze", "f", "--frobnicate"], /Unknown option "--frobnicate"/],
    [["analyze", "a.jsonl", "b.jsonl"], /Only one input file/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError);
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe("renderTerminalReport", () => {
  const system = [{ type: "text", text: `Now: 2026-09-24T10:00:00Z. ${"Stable instructions. ".repeat(300)}`, cache_control: { type: "ephemeral" } }];
  const session = Array.from({ length: 40 }, (_, i) => ({
    model: "claude-opus-5",
    system: [{ ...system[0]!, text: system[0]!.text.replace("10:00:00", `10:${String(i).padStart(2, "0")}:00`) }],
    messages: Array.from({ length: i + 1 }, (_, t) => ({ role: "user", content: `turn ${t}` })),
  }));
  const result = analyze(JSON.stringify(session));

  it("reports a recurring finding once, with the requests it spans", () => {
    const text = renderTerminalReport(result);
    expect(text.match(/contains a value that changes every request/g)).toHaveLength(1);
    expect(text).toContain("requests 2–40, 39×");
    expect(text).toContain("priced as Claude Opus 5 (from the requests)");
  });

  it("abbreviates a long cache table unless verbose", () => {
    const short = renderTerminalReport(result);
    expect(short).toContain("⋯ 25 more requests (--verbose) ⋯");
    expect(short).not.toContain("req 20 ");
    expect(short).toContain("req 40 ");
    const verbose = renderTerminalReport(result, { verbose: true });
    expect(verbose).toContain("req 20 ");
    expect(verbose).toContain("Request 1  ");
  });

  it("names the segment where the prefix keeps breaking", () => {
    expect(renderTerminalReport(result)).toContain('39 of 39 pairs rewrite content already sent, starting at "system block 1"');
  });

  it("says when a model has no pricing entry", () => {
    const unknown = analyze(JSON.stringify({ model: "claude-opus-9", messages: [{ role: "user", content: "hi" }] }));
    expect(renderTerminalReport(unknown)).toContain('priced as Claude Sonnet 5.5 ("claude-opus-9" is not in the pricing table)');
  });
});

describe("text from the requests", () => {
  it("reaches the terminal report as visible escapes, not as control characters", () => {
    // A model name (or a label, or a finding about a tool) holding a terminal escape sequence went
    // to the terminal as it was; this one retitles the window.
    const osc = `${String.fromCharCode(0x1b)}]0;pwned${String.fromCharCode(7)}`;
    const body = { model: `claude-x${osc}`, max_tokens: 10, system: "You help.", messages: [{ role: "user", content: `Hi${osc}` }] };
    const text = renderTerminalReport(analyze(JSON.stringify(body)), { verbose: true });
    expect(text).not.toContain(String.fromCharCode(7));
    expect(text).not.toContain(`${String.fromCharCode(0x1b)}]`);
    expect(text).toContain('"claude-x\\x1b]0;pwned\\x07" is not in the pricing table');
  });
});

describe("--version", () => {
  it("is parsed with or without a command, and VERSION matches package.json", async () => {
    expect(parseArgs(["--version"])).toMatchObject({ command: undefined, version: true });
    expect(parseArgs(["analyze", "-V"])).toMatchObject({ command: "analyze", version: true });
    const { VERSION } = await import("../src/cli/version.js");
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

describe("--json", () => {
  const toolResult = "x".repeat(20_000);
  const session = Array.from({ length: 6 }, (_, i) => ({
    model: "claude-opus-5",
    system: "You are a careful assistant.",
    messages: Array.from({ length: i + 1 }, (_, t) => ({ role: "user", content: `turn ${t}: ${toolResult}` })),
  }));
  const input = JSON.stringify(session);
  const result = analyze(input);

  it("writes the analysis without the request content", async () => {
    const { toJsonReport } = await import("../src/cli/json-report.js");
    const text = toJsonReport(result);
    // Serializing the result whole wrote every request body, segment text and original block.
    expect(JSON.stringify(result).length).toBeGreaterThan(input.length * 2);
    expect(text.length).toBeLessThan(input.length / 5);
    expect(text).not.toContain(toolResult);

    const report = JSON.parse(text) as { parse: { requests: { segments: Record<string, unknown>[] }[] }; reports: { segments: Record<string, unknown>[]; totals: { openaiTokens: number } }[]; findings: unknown[] };
    expect(report.parse.requests).toHaveLength(6);
    expect(report.parse.requests[5]).not.toHaveProperty("raw");
    const segment = report.reports[5]!.segments.at(-1)!;
    expect(Object.keys(segment).sort()).toEqual(["category", "charLength", "claudeTokensEstimate", "id", "label", "openaiTokens", "path"]);
    expect(segment["path"]).toBe("messages[5].content[0]"); // a string body counts as its first block
    expect(segment["charLength"]).toBe(`turn 5: ${toolResult}`.length);
    expect(report.reports[5]!.totals.openaiTokens).toBe(result.reports[5]!.totals.openaiTokens);
    expect(report.findings).toHaveLength(result.findings.length);
  });
});

describe("readInputFile", () => {
  it("says what to do about a log too large to load", async () => {
    const { readInputFile } = await import("../src/cli/read-input.js");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { gzipSync } = await import("node:zlib");
    const dir = mkdtempSync(join(tmpdir(), "contextscope-"));
    writeFileSync(join(dir, "big.jsonl"), "x".repeat(4096));
    writeFileSync(join(dir, "big.jsonl.gz"), gzipSync("x".repeat(4096)));
    expect(readInputFile(join(dir, "big.jsonl"), 4096)).toHaveLength(4096);
    expect(() => readInputFile(join(dir, "big.jsonl"), 1024)).toThrow(/the most this tool can load at once is 0\.001 MB; split it/);
    // The limit is on what the file unpacks to, not on its size on disk.
    expect(() => readInputFile(join(dir, "big.jsonl.gz"), 1024)).toThrow(/it holds 0\.004 MB of JSON/);
  });
});

