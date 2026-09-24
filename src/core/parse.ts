import type { ParseResult, ParseWarning, Provider } from "./types.js";
import { detectFormat } from "./detect.js";
import { parseAnthropicRequest } from "./parse-anthropic.js";
import { parseOpenAiRequest } from "./parse-openai.js";

export class ContextScopeParseError extends Error {}

/** Splits raw input text into an array of request objects: a JSON array, a single JSON object, or JSONL (one JSON object per line, blank lines ignored). */
function splitRequests(input: string): { values: unknown[]; warnings: ParseWarning[] } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ContextScopeParseError("Input is empty.");
  }

  // Try whole-input JSON first (single object or array).
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return { values: parsed, warnings: [] };
    return { values: [parsed], warnings: [] };
  } catch {
    // Fall through to JSONL.
  }

  const lines = trimmed.split("\n");
  const values: unknown[] = [];
  const warnings: ParseWarning[] = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.length === 0) return;
    try {
      values.push(JSON.parse(t));
    } catch (err) {
      warnings.push({ requestIndex: i, message: `Line ${i + 1}: could not parse as JSON (${(err as Error).message}). Skipped.` });
    }
  });

  if (values.length === 0) {
    throw new ContextScopeParseError("No valid JSON objects found (input is neither valid JSON nor valid JSONL).");
  }
  return { values, warnings };
}

export function parseInput(input: string, formatOverride?: Provider): ParseResult {
  const { values, warnings } = splitRequests(input);

  const format = formatOverride ?? detectFormat(values[0]);
  const parser = format === "openai" ? parseOpenAiRequest : parseAnthropicRequest;

  const requests = values.map((value, i) => parser(value, i));

  return {
    format,
    autoDetected: formatOverride === undefined,
    requests,
    warnings,
  };
}
