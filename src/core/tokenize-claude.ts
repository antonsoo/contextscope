/**
 * Estimated token counts for Claude models.
 *
 * Anthropic does not publish Claude's tokenizer, so there is no exact,
 * offline way to count Claude tokens - the only exact source is the
 * `POST /v1/messages/count_tokens` API (see `calibrate.ts`). Every count this
 * module produces is a heuristic estimate and MUST be labeled "≈" in any UI
 * or report; never present it as exact.
 *
 * Method: a length-based estimate, characters-per-token, with the divisor
 * adjusted by how "dense" the text is (ratio of non-alphanumeric,
 * non-whitespace characters - punctuation, brackets, operators). Prose
 * tokenizes at roughly 3.8-4.2 characters/token in English; code and JSON,
 * which are punctuation-heavy, tokenize noticeably denser (BPE splits on
 * symbol boundaries more often), commonly 2.7-3.3 characters/token. This is
 * the same order-of-magnitude heuristic widely used for quick token
 * estimates across BPE tokenizers in general (it is not Claude-specific,
 * because no Claude-specific public data exists); `calibrate.ts` lets a user
 * with an API key replace it with real counts.
 */

const PROSE_CHARS_PER_TOKEN = 4.0;
const DENSE_CHARS_PER_TOKEN = 2.9;

/** Fraction of characters that are not a letter, digit, or plain space. */
function symbolDensity(text: string): number {
  if (text.length === 0) return 0;
  let symbolCount = 0;
  for (const ch of text) {
    if (!/[\p{L}\p{N} ]/u.test(ch)) symbolCount++;
  }
  return symbolCount / text.length;
}

export function estimateClaudeTokens(text: string): number {
  if (text.length === 0) return 0;
  const density = symbolDensity(text);
  // Linearly interpolate the divisor between the prose and dense endpoints,
  // using density 0.15 (typical English punctuation rate) as the "pure prose"
  // anchor and 0.45+ (JSON/code) as the "pure dense" anchor.
  const t = Math.min(1, Math.max(0, (density - 0.15) / (0.45 - 0.15)));
  const charsPerToken = PROSE_CHARS_PER_TOKEN + t * (DENSE_CHARS_PER_TOKEN - PROSE_CHARS_PER_TOKEN);
  return Math.max(1, Math.round(text.length / charsPerToken));
}
