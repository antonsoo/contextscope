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

export function parseInput(input: string, formatOverride?: Provider): ParseResult {
  const { values: rawValues, warnings } = splitRequests(input);

  const envelope = detectEnvelope(rawValues);
  const values = envelope ? rawValues.map((v) => unwrapField((v as Record<string, unknown>)[envelope])) : rawValues;

  const format = formatOverride ?? detectFormat(values[0]);
  const parser = format === "openai" ? parseOpenAiRequest : parseAnthropicRequest;

  const counter = memoizedCounter();
  const requests = values.map((value, i) => parser(value, i, counter));
  requests.forEach((request, i) => {
    const raw = values[i];
    if (format === "openai" && isRecord(raw) && typeof raw["previous_response_id"] === "string") {
      warnings.push({
        requestIndex: i,
        message: `Request ${i + 1} continues a stored response (previous_response_id), so its earlier turns live on OpenAI's servers, not in this file. Counts and the cache simulation cover only what the request itself carries.`,
      });
    }
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
