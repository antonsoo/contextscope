/**
 * Optional calibration against Anthropic's real token-counting endpoint.
 *
 * `POST /v1/messages/count_tokens` (verified via the claude-api skill's
 * bundled reference, shared/token-counting.md) returns an exact,
 * model-specific `input_tokens` count. Called directly from the browser with
 * `anthropic-dangerous-direct-browser-access: true`, which is Anthropic's
 * documented opt-out of the SDK's server-side-only CORS restriction. The key
 * never leaves the browser tab and is never written to storage - the caller
 * holds it in memory only, for the duration of one calibration pass.
 */

const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
const ANTHROPIC_VERSION = "2023-06-01";

export interface CalibrationRequest {
  segmentKey: string;
  text: string;
}

export interface CalibrationResult {
  segmentKey: string;
  tokens: number;
}

export class CalibrationError extends Error {}

/**
 * Counts tokens for a batch of segments against a real Claude model. Issues
 * one request per segment (the endpoint has no batch mode) with a small
 * concurrency cap so a large session doesn't fan out hundreds of parallel
 * requests at once.
 */
export async function calibrateSegments(
  apiKey: string,
  model: string,
  segments: CalibrationRequest[],
  concurrency = 4,
): Promise<CalibrationResult[]> {
  const results: CalibrationResult[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= segments.length) return;
      const segment = segments[i];
      if (!segment) continue;
      const tokens = await countTokens(apiKey, model, segment.text);
      results.push({ segmentKey: segment.segmentKey, tokens });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, worker));
  return results;
}

async function countTokens(apiKey: string, model: string, text: string): Promise<number> {
  const response = await fetch(COUNT_TOKENS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CalibrationError(`count_tokens failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const data = (await response.json()) as { input_tokens: number };
  return data.input_tokens;
}
