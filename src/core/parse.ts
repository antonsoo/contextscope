import type { ParsedRequest, ParseResult, ParseWarning, Provider } from "./types.js";
import { detectFormat, detectProvider } from "./detect.js";
import { parseAnthropicRequest } from "./parse-anthropic.js";
import { parseOpenAiRequest } from "./parse-openai.js";
import { memoizedCounter } from "./token-counter.js";
import { JsonIntegrityError, readJson } from "./read-json.js";

export class ContextScopeParseError extends Error {}

/** Splits raw input text into an array of request objects: a JSON array, a single JSON object, or JSONL (one JSON object per line, blank lines ignored). */
function splitRequests(input: string): { values: unknown[]; sources: NonNullable<ParsedRequest["source"]>[]; warnings: ParseWarning[]; sourceRecords: number } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new ContextScopeParseError("Input is empty.");
  }

  // Try whole-input JSON first (single object or array).
  try {
    const parsed = readJson(trimmed);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (values.length === 0) throw new ContextScopeParseError("The input array is empty: no requests to analyze.");
    return { values, sources: values.map((_, recordIndex) => ({ recordIndex })), warnings: [], sourceRecords: values.length };
  } catch (err) {
    if (err instanceof JsonIntegrityError) throw new ContextScopeParseError(err.message);
    if (err instanceof ContextScopeParseError) throw err;
    // Fall through to JSONL.
  }

  const lines = input.split("\n");
  const values: unknown[] = [];
  const sources: NonNullable<ParsedRequest["source"]>[] = [];
  const warnings: ParseWarning[] = [];
  let sourceRecords = 0;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.length === 0) return;
    const recordIndex = sourceRecords++;
    try {
      values.push(readJson(t));
      sources.push({ recordIndex, line: i + 1 });
    } catch (err) {
      if (err instanceof JsonIntegrityError) throw new ContextScopeParseError(`Line ${i + 1}: ${err.message}`);
      warnings.push({ sourceLine: i + 1, message: `Line ${i + 1}: could not parse as JSON. Skipped; analysis is incomplete.` });
    }
  });

  if (values.length === 0) {
    throw new ContextScopeParseError("No valid JSON objects found (input is neither valid JSON nor valid JSONL).");
  }
  return { values, sources, warnings, sourceRecords };
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

/** A capture can mix raw requests and different gateway wrappers; choose per record. */
function unwrapRecord(value: unknown, recordIndex: number): { value: unknown; envelope?: string } {
  if (!isRecord(value)) return { value };
  const candidates = ENVELOPE_FIELDS.map((field) => ({ envelope: field, value: unwrapField(value[field]) })).filter((candidate) => looksLikeRequestBody(candidate.value));
  if (candidates.length > 1 || (looksLikeRequestBody(value) && candidates.length > 0)) {
    throw new ContextScopeParseError(`Source record ${recordIndex + 1} has ambiguous request bodies. Keep one body or analyze each capture separately.`);
  }
  return candidates[0] ?? { value };
}

// Some gateways log the body as a JSON string rather than an object.
function unwrapField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return readJson(value);
  } catch (err) {
    if (err instanceof JsonIntegrityError) throw new ContextScopeParseError(err.message);
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
  const { values: rawValues, sources, warnings, sourceRecords } = splitRequests(input);

  const records = rawValues.map((value, i) => unwrapRecord(value, sources[i]!.recordIndex));
  const values = records.map((record) => record.value);
  const envelope = records.every((record) => record.envelope === records[0]!.envelope) ? records[0]!.envelope : undefined;

  const providers = values.map(detectProvider);
  if (!formatOverride && new Set(providers.filter((provider) => provider !== undefined)).size > 1) {
    throw new ContextScopeParseError("Mixed provider log contains both Anthropic and OpenAI requests. Split it by provider before analysis; their serialization and caching differ.");
  }
  const format = formatOverride ?? providers.find((provider) => provider !== undefined) ?? detectFormat(values[0]);
  const parser = format === "openai" ? parseOpenAiRequest : parseAnthropicRequest;

  const counter = memoizedCounter();
  let complete = warnings.length === 0;
  let skippedRecords = sourceRecords - values.length;
  const requests = values.map((value, i) => {
    const source = { ...sources[i]!, ...(records[i]!.envelope ? { envelope: records[i]!.envelope } : {}) };
    if (providers[i] && providers[i] !== format) {
      complete = false;
      warnings.push({ requestIndex: i, ...(source.line ? { sourceLine: source.line } : {}), message: `Request ${i + 1} has ${providers[i]} provider evidence but the format override selects ${format}. Some content may not be analyzed; split the log by provider.` });
    }
    return { ...parser(value, i, counter), source };
  });
  if (format === "openai") warnings.push(...openAiStateWarnings(values));
  requests.forEach((request, i) => {
    if (request.segments.length === 0) {
      complete = false;
      skippedRecords++;
      warnings.push({
        requestIndex: i,
        ...(request.source.line ? { sourceLine: request.source.line } : {}),
        message: `Request ${i + 1} has no tools, system prompt or messages - is it an API request body? (Response objects and usage records aren't analyzable.)`,
      });
    }
  });

  return {
    format,
    complete,
    sourceRecords,
    skippedRecords,
    autoDetected: formatOverride === undefined,
    envelope,
    requests,
    warnings,
  };
}
