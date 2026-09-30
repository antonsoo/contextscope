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
