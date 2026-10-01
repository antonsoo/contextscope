import type { FindingSeverity } from "../core/index.js";

export interface CliArgs {
  command: string | undefined;
  file: string | undefined;
  format: "anthropic" | "openai" | undefined;
  model: string | undefined;
  html: string | undefined;
  json: string | undefined;
  failOn: FindingSeverity | undefined;
  calibrate: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {}

/** Parses argv (without the node/script prefix). Throws UsageError with a user-facing message. */
export function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  const command = args[0]?.startsWith("-") ? undefined : args.shift();
  const out: CliArgs = {
    command,
    file: undefined,
    format: undefined,
    model: undefined,
    html: undefined,
    json: undefined,
    failOn: undefined,
    calibrate: false,
    verbose: false,
    help: false,
    version: false,
  };
  const value = (flag: string): string => {
    const v = args.shift();
    if (v === undefined || v.startsWith("-")) throw new UsageError(`${flag} needs a value.`);
    return v;
  };
  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--format": {
        const format = value(arg);
        if (format !== "anthropic" && format !== "openai") throw new UsageError(`--format must be "anthropic" or "openai", not "${format}".`);
        out.format = format;
        break;
      }
      case "--model":
        out.model = value(arg);
        break;
      case "--html":
        out.html = value(arg);
        break;
      case "--json":
        out.json = value(arg);
        break;
      case "--fail-on": {
        const level = value(arg);
        if (level !== "error" && level !== "warning" && level !== "info") throw new UsageError(`--fail-on must be error, warning or info, not "${level}".`);
        out.failOn = level;
        break;
      }
      case "--calibrate":
        out.calibrate = true;
        break;
      case "-v":
      case "--verbose":
        out.verbose = true;
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-V":
      case "--version":
        out.version = true;
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") throw new UsageError(`Unknown option "${arg}".`);
        if (out.file !== undefined) throw new UsageError(`Only one input file is supported (got "${out.file}" and "${arg}").`);
        out.file = arg;
        break;
    }
  }
  return out;
}
