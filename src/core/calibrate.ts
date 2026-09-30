/**
 * Optional calibration against Anthropic's token-counting endpoint.
 *
 * Claude token counts elsewhere in contextscope are heuristic estimates.
 * `POST /v1/messages/count_tokens` returns the real, model-specific input
 * token count for a whole request body - tools, system prompt, messages and
 * the framing around them - and the endpoint is free to call. One call on one
 * request gives the ratio of real to estimated tokens for this workload;
 * passing that ratio as `claudeTokenScale` rescales every estimate in the
 * analysis, so the cost figures rest on a measured count instead of the
 * heuristic alone. It is still a scale factor: segments whose text is denser
 * or sparser than the calibrated request's average keep some error.
 *
 * In a browser the call is made directly from the page with
 * `anthropic-dangerous-direct-browser-access: true`, Anthropic's documented
 * opt-in for CORS. The key is held by the caller in memory only.
 */
import type { ParsedRequest } from "./types.js";

const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
const ANTHROPIC_VERSION = "2023-06-01";

// The request fields count_tokens understands; everything else (max_tokens, stream, metadata,
// temperature...) affects the response, not the prompt, and would be rejected or ignored.
const PROMPT_FIELDS = ["system", "tools", "messages", "tool_choice", "thinking"] as const;

export interface CalibrationResult {
  requestIndex: number;
  model: string;
  /** Input tokens reported by count_tokens for the whole request. */
  exactTokens: number;
  /** The heuristic estimate for the same request (sum of its segments' unscaled estimates). */
  estimatedTokens: number;
  /** exactTokens / estimatedTokens - pass as AnalysisOptions.claudeTokenScale. */
  scale: number;
}

export class CalibrationError extends Error {}

export interface CountTokensOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Send the browser CORS opt-in header. Defaults to true when running in a page. */
  browser?: boolean;
}

/** The count_tokens request body for one parsed request, priced as `model`. */
export function countTokensBody(request: ParsedRequest, model: string): Record<string, unknown> {
  const raw = request.raw !== null && typeof request.raw === "object" ? (request.raw as Record<string, unknown>) : {};
  const body: Record<string, unknown> = { model };
  for (const field of PROMPT_FIELDS) if (raw[field] !== undefined) body[field] = raw[field];
  if (!Array.isArray(body["messages"]) || body["messages"].length === 0) {
    throw new CalibrationError(`Request ${request.index + 1} has no messages, so there is nothing to count.`);
  }
  return body;
}

export function calibrationScale(exactTokens: number, estimatedTokens: number): number {
  if (!(exactTokens > 0) || !(estimatedTokens > 0)) throw new CalibrationError("Cannot calibrate against an empty request.");
  return exactTokens / estimatedTokens;
}

/** Counts one request exactly and returns the scale that maps the heuristic onto it. */
export async function countRequestTokens(apiKey: string, model: string, request: ParsedRequest, options: CountTokensOptions = {}): Promise<CalibrationResult> {
  if (request.provider !== "anthropic") throw new CalibrationError("Calibration uses Anthropic's count_tokens endpoint, so it only applies to Anthropic requests.");
  if (apiKey.trim() === "") throw new CalibrationError("An Anthropic API key is required.");
  const body = countTokensBody(request, model);
  const fetchImpl = options.fetchImpl ?? fetch;
  const browser = options.browser ?? typeof window !== "undefined";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey.trim(),
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (browser) headers["anthropic-dangerous-direct-browser-access"] = "true";

  let response: Response;
  try {
    response = await fetchImpl(COUNT_TOKENS_URL, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    throw new CalibrationError(`Could not reach api.anthropic.com: ${(err as Error).message}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CalibrationError(`count_tokens failed (HTTP ${response.status}): ${errorMessage(text)}`);
  }
  const data = (await response.json()) as { input_tokens?: unknown };
  if (typeof data.input_tokens !== "number") throw new CalibrationError("count_tokens returned no input_tokens field.");

  const estimatedTokens = request.segments.reduce((sum, s) => sum + s.claudeTokensEstimate, 0);
  return {
    requestIndex: request.index,
    model,
    exactTokens: data.input_tokens,
    estimatedTokens,
    scale: calibrationScale(data.input_tokens, estimatedTokens),
  };
}

function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") return parsed.error.message;
  } catch {
    // not JSON - fall through to the raw text
  }
  return body.slice(0, 200) || "(empty response)";
}
