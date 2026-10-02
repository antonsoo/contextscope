import type { ParseResult, ParseWarning, Provider } from "./types.js";
import { detectFormat } from "./detect.js";
import { parseAnthropicRequest } from "./parse-anthropic.js";
import { parseOpenAiRequest } from "./parse-openai.js";
import { memoizedCounter } from "./token-counter.js";

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

// Record fields that hold a request body in the batch-file and log formats people actually have:
// Anthropic Message Batches lines are {custom_id, params}, OpenAI Batch API lines are
// {custom_id, method, url, body}, and gateways/proxies commonly log {request: ...} or {request_body: ...}.
const ENVELOPE_FIELDS = ["params", "body", "request", "request_body"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function looksLikeRequestBody(value: unknown): boolean {
  return isRecord(value) && (Array.isArray(value["messages"]) || "input" in value || "instructions" in value);
}

/** The envelope field that wraps every request body in `values`, if there is one. */
function detectEnvelope(values: unknown[]): string | undefined {
  if (values.length === 0 || values.some(looksLikeRequestBody)) return undefined;
  for (const field of ENVELOPE_FIELDS) {
    if (values.every((v) => isRecord(v) && looksLikeRequestBody(unwrapField(v[field])))) return field;
  }
  return undefined;
}

// Some gateways log the body as a JSON string rather than an object.
function unwrapField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** "Request 2", "Requests 2-6", "Requests 2, 4 and 7": the requests one note is about. */
function requestList(indices: number[]): string {
  const numbers = indices.map((i) => i + 1);
  if (numbers.length === 1) return `Request ${numbers[0]}`;
  const contiguous = numbers.every((n, k) => k === 0 || n === numbers[k - 1]! + 1);
  if (contiguous) return `Requests ${numbers[0]}–${numbers[numbers.length - 1]}`;
  const shown = numbers.slice(0, 6).join(", ");
  return numbers.length > 6 ? `Requests ${shown} and ${numbers.length - 6} more` : `Requests ${shown}`;
}

function holdsExplicitBreakpoint(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsExplicitBreakpoint);
  if (!isRecord(value)) return false;
  if (isRecord(value["prompt_cache_breakpoint"])) return true;
  return Object.values(value).some(holdsExplicitBreakpoint);
}

/**
 * What an OpenAI request says about state this file cannot show, one note per kind however
 * many requests it applies to: history kept on OpenAI's servers, and cache breakpoints placed
 * by hand (`prompt_cache_options`, `prompt_cache_breakpoint`), which the simulation, a model
 * of OpenAI's automatic prefix caching, does not follow.
 */
function openAiStateWarnings(values: unknown[]): ParseWarning[] {
  const stored: number[] = [];
  const explicit: number[] = [];
  const explicitWithoutBreakpoint: number[] = [];
  values.forEach((raw, i) => {
    if (!isRecord(raw)) return;
    if (typeof raw["previous_response_id"] === "string" || raw["conversation"] != null) stored.push(i);
    const options = raw["prompt_cache_options"];
    const explicitMode = isRecord(options) && options["mode"] === "explicit";
    const breakpoints = holdsExplicitBreakpoint(raw["input"]) || holdsExplicitBreakpoint(raw["messages"]);
    if (explicitMode && !breakpoints) explicitWithoutBreakpoint.push(i);
    else if (explicitMode || breakpoints) explicit.push(i);
  });
  const out: ParseWarning[] = [];
  if (stored.length > 0) {
    const one = stored.length === 1;
    out.push({
      requestIndex: stored[0]!,
      message: `${requestList(stored)} ${one ? "continues" : "continue"} a stored response or conversation (previous_response_id, conversation), so ${one ? "its" : "their"} earlier turns live on OpenAI's servers, not in this file. Counts and the cache simulation cover only what ${one ? "the request itself carries" : "each request itself carries"}.`,
    });
  }
  if (explicitWithoutBreakpoint.length > 0) {
    const one = explicitWithoutBreakpoint.length === 1;
    out.push({
      requestIndex: explicitWithoutBreakpoint[0]!,
      message: `${requestList(explicitWithoutBreakpoint)} ${one ? "sets" : "set"} prompt_cache_options.mode to "explicit" and ${one ? "marks" : "mark"} no block with prompt_cache_breakpoint: OpenAI then caches nothing of ${one ? "it" : "them"}, while the simulation below still assumes automatic prefix caching.`,
    });
  }
  if (explicit.length > 0) {
    const one = explicit.length === 1;
    out.push({
      requestIndex: explicit[0]!,
      message: `${requestList(explicit)} ${one ? "places" : "place"} cache breakpoints by hand (prompt_cache_options, prompt_cache_breakpoint). The simulation models OpenAI's automatic prefix caching only, so reads and writes at those breakpoints are not reflected in it.`,
    });
  }
  return out;
}

export function parseInput(input: string, formatOverride?: Provider): ParseResult {
  const { values: rawValues, warnings } = splitRequests(input);

  const envelope = detectEnvelope(rawValues);
  const values = envelope ? rawValues.map((v) => unwrapField((v as Record<string, unknown>)[envelope])) : rawValues;

  const format = formatOverride ?? detectFormat(values[0]);
  const parser = format === "openai" ? parseOpenAiRequest : parseAnthropicRequest;

  const counter = memoizedCounter();
  const requests = values.map((value, i) => parser(value, i, counter));
  if (format === "openai") warnings.push(...openAiStateWarnings(values));
  requests.forEach((request, i) => {
    if (request.segments.length === 0) {
      warnings.push({
        requestIndex: i,
        message: `Request ${i + 1} has no tools, system prompt or messages - is it an API request body? (Response objects and usage records aren't analyzable.)`,
      });
    }
  });

  return {
    format,
    autoDetected: formatOverride === undefined,
    envelope,
    requests,
    warnings,
  };
}
