import type { Provider, ReportedUsage, UsageCounter } from "./types.js";
import { readJson } from "./read-json.js";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function empty(sources: string[], status: ReportedUsage["status"], issues: string[] = []): ReportedUsage {
  return { sources, schema: "unknown", status, inputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, outputTokens: null, counters: [], issues, notes: [] };
}

/**
 * Only same-record pairs are joined. A request body can itself contain arbitrary tool data
 * named usage/response, so response adapters are enabled only for an unwrapped request.
 * SSE deltas and response-only records must be assembled/paired by the caller first.
 */
export function readReportedUsage(record: unknown, envelope: string | undefined, provider: Provider): ReportedUsage | undefined {
  if (!envelope || !object(record)) return undefined;
  const candidates: { path: string; value: unknown }[] = [];
  const invalidBodies: string[] = [];
  const decode = (value: unknown, path: string): unknown => {
    if (typeof value !== "string") return value;
    try { return readJson(value); }
    catch { invalidBodies.push(path); return undefined; }
  };
  const addUsage = (value: unknown, path: string): void => {
    if (object(value) && Object.hasOwn(value, "usage")) candidates.push({ path: `${path}.usage`, value: value["usage"] });
  };
  if (Object.hasOwn(record, "usage")) candidates.push({ path: "usage", value: record["usage"] });
  for (const field of ["response", "response_body"]) {
    const response = decode(record[field], field);
    addUsage(response, field);
    if (field === "response" && object(response) && Object.hasOwn(response, "body")) {
      addUsage(decode(response["body"], "response.body"), "response.body");
    }
  }
  if (invalidBodies.length) return empty([...candidates.map((c) => c.path), ...invalidBodies], "invalid", invalidBodies.map((path) => `${path} is not a valid JSON response body.`));
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) return empty(candidates.map((c) => c.path), "invalid", ["Multiple response usage objects in one record; keep one unambiguous response per request."]);
  const candidate = candidates[0]!;
  return normalizeUsage(candidate.value, candidate.path, provider);
}

function normalizeUsage(value: unknown, source: string, provider: Provider): ReportedUsage {
  if (value === null || value === undefined) return empty([source], "unavailable");
  if (!object(value)) return empty([source], "invalid", [`${source} must be an object or null.`]);
  const result = empty([source], "unavailable");
  const issues = result.issues;
  const counters = new Map<string, UsageCounter>();
  const has = (path: string): boolean => {
    let node: unknown = value;
    for (const key of path.split(".")) {
      if (!object(node) || !Object.hasOwn(node, key)) return false;
      node = node[key];
    }
    return true;
  };
  const count = (path: string): number | null => {
    const existing = counters.get(path);
    if (existing) return existing.value ?? null;
    let node: unknown = value;
    const keys = path.split(".");
    let malformed = false;
    for (const key of keys) {
      if (node === null || node === undefined) { node = undefined; break; }
      if (!object(node)) { malformed = true; break; }
      node = node[key];
    }
    const fullPath = `${source}.${path}`;
    if (!malformed && (node === undefined || node === null)) {
      counters.set(path, { path: fullPath, status: "missing" });
      return null;
    }
    if (!malformed && typeof node === "number" && Number.isSafeInteger(node) && node >= 0) {
      counters.set(path, { path: fullPath, status: "reported", value: node });
      return node;
    }
    counters.set(path, { path: fullPath, status: "invalid" });
    issues.push(`${fullPath} must be a nonnegative safe integer (or null when unavailable).`);
    return null;
  };
  const aliases = (primary: string, alternatives: string[]): number | null => {
    const names = [primary, ...alternatives.filter(has)];
    const values = names.map(count).filter((n): n is number => n !== null);
    if (new Set(values).size > 1) issues.push(`${source}: counters ${names.join(", ")} disagree.`);
    return values[0] ?? null;
  };
  const sum = (numbers: (number | null)[], label: string): number | null => {
    if (numbers.some((n) => n === null)) return null;
    const total = (numbers as number[]).reduce((a, b) => a + b, 0);
    if (Number.isSafeInteger(total)) return total;
    issues.push(`${source}: ${label} exceeds the safe integer range.`);
    return null;
  };

  const chat = ["prompt_tokens", "completion_tokens", "prompt_tokens_details"].some(has);
  const responses = has("input_tokens_details");
  const native = !chat && (["cache_read_input_tokens", "cache_creation_input_tokens", "cache_creation"].some(has) || provider === "anthropic");
  if ((chat && (has("input_tokens") || has("output_tokens") || responses)) || (responses && native)) {
    return empty([source], "invalid", [`${source} mixes incompatible usage schemas.`]);
  }

  let input: number | null;
  let read: number | null;
  let write: number | null;
  let output: number | null;
  let total: number | null = null;
  if (chat) {
    result.schema = "openai-chat";
    input = count("prompt_tokens");
    output = count("completion_tokens");
    // Gateway captures can include native aliases. Keep their provenance and reject
    // conflicts; historical LiteLLM totals need a separate ambiguity check below.
    read = aliases("prompt_tokens_details.cached_tokens", ["cache_read_input_tokens"]);
    write = aliases("prompt_tokens_details.cache_write_tokens", ["prompt_tokens_details.cache_creation_tokens", "cache_creation_input_tokens"]);
    if (has("total_tokens")) total = count("total_tokens");
  } else if (native) {
    result.schema = "anthropic";
    read = count("cache_read_input_tokens");
    write = count("cache_creation_input_tokens");
    input = sum([count("input_tokens"), read, write], "total input tokens");
    output = count("output_tokens");
  } else {
    result.schema = "openai-responses";
    input = count("input_tokens");
    output = count("output_tokens");
    read = count("input_tokens_details.cached_tokens");
    write = count("input_tokens_details.cache_write_tokens");
    if (has("total_tokens")) total = count("total_tokens");
  }
  if (input !== null && total !== null && output !== null && total !== sum([input, output], "input plus output tokens")) issues.push(`${source}.total_tokens disagrees with input plus output tokens.`);
  const gateway = chat && (provider === "anthropic" || has("cache_creation_input_tokens") || has("prompt_tokens_details.cache_creation_tokens"));
  if (gateway && write !== 0) {
    // Some LiteLLM versions exclude creation tokens from prompt_tokens; others include
    // them. The capture contains no versioned contract proving which sum was used.
    if (input !== null && read !== null && read > input) issues.push(`${source}: cache reads exceed prompt_tokens.`);
    input = null;
    result.notes.push("Gateway prompt_tokens may include or exclude cache creation, depending on the gateway version. Total input is unavailable unless cache creation is explicitly zero; original counters and cache reads are retained.");
  }
  if (input !== null) {
    if ((read !== null && read > input) || (write !== null && write > input)) issues.push(`${source}: cache reads or writes exceed total input tokens.`);
    if (read !== null && write !== null) {
      const cached = sum([read, write], "cache reads plus writes");
      if (cached !== null && cached > input) issues.push(`${source}: cache reads plus writes exceed total input tokens.`);
    }
  }
  for (const path of ["cache_creation", "prompt_tokens_details.cache_creation_token_details"]) {
    if (!has(path)) continue;
    const short = count(`${path}.ephemeral_5m_input_tokens`);
    const long = count(`${path}.ephemeral_1h_input_tokens`);
    const ttlTotal = sum([short, long], "cache write TTL breakdown");
    if (write !== null && ((short !== null && short > write) || (long !== null && long > write) || (ttlTotal !== null && ttlTotal !== write))) {
      issues.push(`${source}.${path} disagrees with total cache writes.`);
    }
  }
  result.counters = [...counters.values()];
  if (issues.length) { result.status = "invalid"; return result; }
  result.inputTokens = input;
  result.cacheReadTokens = read;
  result.cacheWriteTokens = write;
  result.outputTokens = output;
  result.status = [input, read, write, output].some((n) => n !== null) ? "valid" : "unavailable";
  return result;
}
