#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { analyze, countRequestTokens, parseInput, resolveModel, type AnalysisResult, type CalibrationResult, type FindingSeverity } from "../core/index.js";
import { parseArgs, type CliArgs } from "./args.js";
import { VERSION } from "./version.js";
import { renderTerminalReport } from "./terminal-report.js";
import { renderHtmlReport } from "./html-report.js";
import { readInputFile } from "./read-input.js";
import { toJsonReport } from "./json-report.js";
import { bold, red, visible } from "./ansi.js";

const HELP = `contextscope — see what's in your LLM context window

Usage:
  contextscope analyze <file> [options]

<file> is JSON, a JSON array, or JSONL of Anthropic Messages or OpenAI (Chat
Completions or Responses) request bodies, optionally gzipped. Batch-API files
and logs that wrap each body in "params", "body", "request" or "request_body"
are unwrapped automatically.

Options:
  --format <anthropic|openai>     Override auto-detected format
  --model <id>                    Price as this model (default: the model named in the requests)
  --calibrate                     Anthropic only: count the largest request exactly with the
                                  count_tokens endpoint (reads ANTHROPIC_API_KEY) and scale
                                  every Claude estimate to match
  --fail-on <error|warning|info>  Exit with status 2 if any finding is at least this severe
  --html <out.html>               Also write a self-contained HTML report
  --json <out.json>               Also write the analysis as JSON: counts, findings and cache
                                  steps for every request and segment, without the request text
  -v, --verbose                   Show every request's breakdown and every prefix/cache row
  -h, --help                      Show this help
  -V, --version                   Show the version

Exit status: 0 on success, 1 on bad arguments or unreadable input,
2 when --fail-on is set and a finding meets it.
`;

function fail(message: string, showHelp = false): never {
  process.stderr.write(red(visible(message)) + "\n");
  if (showHelp) process.stderr.write("\n" + HELP);
  process.exit(1);
}

async function calibrate(input: string, opts: CliArgs): Promise<CalibrationResult> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) fail("--calibrate needs an Anthropic API key in ANTHROPIC_API_KEY (count_tokens is free, but authenticated).");
  const parse = parseInput(input, opts.format);
  if (parse.format !== "anthropic") fail("--calibrate uses Anthropic's count_tokens endpoint, so it only applies to Anthropic requests.");
  const largest = parse.requests.reduce((best, r) => (total(r) > total(best) ? r : best));
  const model = resolveModel("anthropic", opts.model, parse.requests.map((r) => r.model));
  return countRequestTokens(apiKey, model.id, largest, { browser: false });
}

function total(request: { segments: { claudeTokensEstimate: number }[] }): number {
  return request.segments.reduce((sum, s) => sum + s.claudeTokensEstimate, 0);
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { info: 0, warning: 1, error: 2 };

async function main(): Promise<void> {
  let opts: CliArgs;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail((err as Error).message, true);
  }

  if (opts.version) {
    process.stdout.write(`contextscope ${VERSION}\n`);
    return;
  }
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!opts.command) fail("Missing command.", true);
  if (opts.command !== "analyze") fail(`Unknown command "${opts.command}". Only \`analyze\` is supported.`, true);
  if (!opts.file) fail("Missing input file.", true);

  let input: string;
  try {
    input = readInputFile(opts.file);
  } catch (err) {
    fail(`Could not read "${opts.file}": ${(err as Error).message}`);
  }

  let calibration: CalibrationResult | undefined;
  if (opts.calibrate) {
    try {
      calibration = await calibrate(input, opts);
    } catch (err) {
      fail(`Calibration failed: ${(err as Error).message}`);
    }
  }

  let result: AnalysisResult;
  try {
    result = analyze(input, { format: opts.format, model: opts.model, claudeTokenScale: calibration?.scale });
  } catch (err) {
    fail(`Could not analyze "${opts.file}": ${(err as Error).message}`);
  }

  process.stdout.write(renderTerminalReport(result, { verbose: opts.verbose, calibration }) + "\n");

  if (opts.html) {
    writeFileSync(opts.html, renderHtmlReport(result));
    process.stdout.write(bold(`\nHTML report written to ${opts.html}\n`));
  }
  if (opts.json) {
    writeFileSync(opts.json, toJsonReport(result));
    process.stdout.write(bold(`JSON result written to ${opts.json}\n`));
  }

  if (opts.failOn !== undefined) {
    const threshold = SEVERITY_RANK[opts.failOn];
    if (!result.parse.complete || result.findings.some((f) => SEVERITY_RANK[f.severity] >= threshold)) process.exitCode = 2;
  }
}

await main();
