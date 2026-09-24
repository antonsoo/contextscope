#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { analyze } from "../core/index.js";
import { renderTerminalReport } from "./terminal-report.js";
import { renderHtmlReport } from "./html-report.js";
import { bold, red } from "./ansi.js";

const HELP = `contextscope — see what's in your LLM context window

Usage:
  contextscope analyze <file> [options]

Options:
  --format <anthropic|openai>   Override auto-detected format
  --model <id>                  Model id for context-window and pricing lookups
  --html <out.html>             Also write a self-contained HTML report
  --json <out.json>             Also write the raw analysis result as JSON
  -h, --help                    Show this help
`;

interface CliArgs {
  command: string | undefined;
  file: string | undefined;
  format: "anthropic" | "openai" | undefined;
  model: string | undefined;
  html: string | undefined;
  json: string | undefined;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  const command = args[0]?.startsWith("-") ? undefined : args.shift();
  const out: CliArgs = { command, file: undefined, format: undefined, model: undefined, html: undefined, json: undefined, help: false };
  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--format":
        out.format = args.shift() as "anthropic" | "openai";
        break;
      case "--model":
        out.model = args.shift();
        break;
      case "--html":
        out.html = args.shift();
        break;
      case "--json":
        out.json = args.shift();
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        if (out.file === undefined) out.file = arg;
        break;
    }
  }
  return out;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.command) {
    process.stdout.write(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  if (opts.command !== "analyze") {
    process.stderr.write(red(`Unknown command "${opts.command}". `) + "Only `analyze` is supported.\n\n");
    process.stdout.write(HELP);
    process.exit(1);
  }

  if (!opts.file) {
    process.stderr.write(red("Missing input file.") + "\n\n");
    process.stdout.write(HELP);
    process.exit(1);
  }

  let input: string;
  try {
    input = readFileSync(opts.file, "utf8");
  } catch (err) {
    process.stderr.write(red(`Could not read "${opts.file}": ${(err as Error).message}\n`));
    process.exit(1);
    return;
  }

  let result;
  try {
    result = analyze(input, { format: opts.format, model: opts.model });
  } catch (err) {
    process.stderr.write(red(`Could not analyze "${opts.file}": ${(err as Error).message}\n`));
    process.exit(1);
    return;
  }

  process.stdout.write(renderTerminalReport(result) + "\n");

  if (opts.html) {
    writeFileSync(opts.html, renderHtmlReport(result));
    process.stdout.write(bold(`\nHTML report written to ${opts.html}\n`));
  }
  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(result, null, 2));
    process.stdout.write(bold(`JSON result written to ${opts.json}\n`));
  }
}

main();
