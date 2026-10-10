import type { ParsedRequest, Segment } from "./types.js";
import { isRecord } from "./json-utils.js";
import { normalizeModelId } from "./pricing.js";
import { ContextScopeParseError } from "./parse-error.js";

export interface OpenAiCachePlan {
  mode: "implicit" | "explicit";
  /** Segment endpoints the incoming request can look up, not just the ones it writes. */
  lookup: number[];
  write: number[];
  explicit: number[];
}

function fail(request: ParsedRequest, detail: string): never {
  throw new ContextScopeParseError(`Request ${request.index + 1}: ${detail}`);
}

/** Cache options are control data, never tokens or prefix content. Validate before simulating. */
export function openAiCachePlan(request: ParsedRequest): OpenAiCachePlan {
  const raw = isRecord(request.raw) ? request.raw : {};
  const options = raw["prompt_cache_options"];
  if (options !== undefined && options !== null && (!isRecord(options)
    || (options.mode !== undefined && options.mode !== "implicit" && options.mode !== "explicit")
    || (options.ttl !== undefined && options.ttl !== "30m"))) {
    fail(request, 'prompt_cache_options requires mode "implicit" or "explicit" and an omitted or "30m" ttl.');
  }
  const mode = isRecord(options) && options.mode === "explicit" ? "explicit" : "implicit";
  const key = raw["prompt_cache_key"];
  if (key !== undefined && key !== null && typeof key !== "string") fail(request, "prompt_cache_key must be a string or null.");
  const explicit: number[] = [];
  request.segments.forEach((segment, index) => {
    if (!isRecord(segment.raw)) return;
    const marker = segment.raw["prompt_cache_breakpoint"];
    if (marker === undefined || marker === null) return;
    if (!isRecord(marker) || marker.mode !== "explicit") fail(request, `${segment.path}.prompt_cache_breakpoint requires mode "explicit".`);
    // Tool definitions, message headers and reasoning items cannot receive content-block markers.
    if (!/^(?:messages|input)\[\d+\]\.(?:content|output)\[\d+\]$/.test(segment.path)) {
      fail(request, `${segment.path}.prompt_cache_breakpoint is outside a supported content block.`);
    }
    explicit.push(index);
  });

  const { eligible, initialDeveloper } = eligibleEndings(raw, request.segments);
  const implicit = mode === "implicit" ? eligible.at(-1) : undefined;
  const write = [...explicit.slice(mode === "explicit" ? -4 : -3), ...(implicit === undefined ? [] : [implicit])];
  // The current caching guide specifies first 2 + latest 50; generated API reference prose
  // still says latest 80. Follow the guide, which the reference links for current behavior.
  const lookup = [...explicit.slice(0, 2), ...explicit.slice(-50)];
  if (mode === "implicit") {
    lookup.push(...eligible.slice(-21)); // latest endpoint and up to 20 earlier endings
    if (initialDeveloper !== undefined) lookup.push(initialDeveloper);
  }
  const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  return { mode, lookup: unique(lookup), write: unique(write), explicit };
}

function eligibleEndings(raw: Record<string, unknown>, segments: Segment[]): { eligible: number[]; initialDeveloper?: number } {
  const responses = !Array.isArray(raw["messages"]);
  const input = raw[responses ? "input" : "messages"];
  if (responses && typeof input === "string") {
    const end = segments.findIndex((s) => s.path === "input");
    const initialDeveloper = segments.findIndex((s) => s.path === "instructions");
    return { eligible: [initialDeveloper, end].filter((n) => n >= 0), ...(initialDeveloper < 0 ? {} : { initialDeveloper }) };
  }
  const items = Array.isArray(input) ? input : [];
  const prefix = responses ? "input" : "messages";
  const endings = new Map<number, number>();
  segments.forEach((segment, index) => {
    const match = /^(messages|input)\[(\d+)\]/.exec(segment.path);
    if (match?.[1] === prefix) endings.set(Number(match[2]), index);
  });
  const role = (item: unknown): string | undefined => {
    if (!isRecord(item)) return undefined;
    if (responses && typeof item.type === "string" && item.type.endsWith("_output")) return "tool";
    if (responses && item.type !== undefined && item.type !== "message") return undefined;
    return typeof item.role === "string" ? item.role : "user";
  };
  let initialDeveloper = responses ? segments.findIndex((s) => s.path === "instructions") : -1;
  let inInitialDevelopers = true;
  const eligible: number[] = [];
  items.forEach((item, i) => {
    const current = role(item);
    const developer = current === "developer" || current === "system";
    const end = endings.get(i);
    if (inInitialDevelopers && developer) {
      if (end !== undefined) initialDeveloper = end;
    } else inInitialDevelopers = false;
    if (end !== undefined && (current === "user" || (current === "tool" && role(items[i + 1]) !== "tool"))) eligible.push(end);
  });
  if (initialDeveloper >= 0) eligible.push(initialDeveloper);
  eligible.sort((a, b) => a - b);
  return { eligible, ...(initialDeveloper < 0 ? {} : { initialDeveloper }) };
}

/** Different cache keys and renderer settings cannot safely share a predicted hit.
 * Conservatively isolate the whole request when settings change; providers may retain a
 * smaller prefix. Keys and configuration strings are never volatile-normalized. */
export function openAiCacheScope(request: ParsedRequest): string {
  const raw = isRecord(request.raw) ? request.raw : {};
  const settings = Object.fromEntries(["reasoning", "reasoning_effort", "text", "response_format", "parallel_tool_calls", "tool_choice", "context_management"]
    .filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
  // Schema property order can affect the rendered instructions/output order. Preserve
  // nested setting order rather than canonicalizing two potentially different prompts.
  return JSON.stringify([request.model === undefined ? null : normalizeModelId(request.model),
    Array.isArray(raw["messages"]) ? "chat" : "responses", raw["prompt_cache_key"] ?? null, settings]);
}
