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
 * tokenizes at roughly 3.3 characters/token on the agent transcripts it was
 * fitted to; code and JSON, which are punctuation-heavy, tokenize denser (BPE
 * splits on symbol boundaries more often), about 2.5 characters/token.
 * `calibrate.ts` lets a user with an API key replace it with real counts.
 */

// Fitted to the input tokens Anthropic reported for 5,160 agent steps (coding-agent trajectories on
// Claude Sonnet 4.5, Opus 4.5, Haiku 4.5 and Opus 4.6, half of the trajectories held out); see
// studies/real-trajectories/README.md. The earlier 4.0 and 2.9 undercounted that content by 20-30%.
// These models share a tokenizer; Claude Opus 4.7 and later use a newer one that Anthropic documents
// as producing about 30% more tokens, which this estimate does not model.
const PROSE_CHARS_PER_TOKEN = 3.3;
const DENSE_CHARS_PER_TOKEN = 2.5;

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

/** Fraction of characters that are not a letter, digit, or plain space. */
function symbolDensity(text: string): number {
  if (text.length === 0) return 0;
  let symbolCount = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    // ASCII fast path; the Unicode property test only runs for non-ASCII characters.
    if (code < 128) {
      const isAlnumOrSpace = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 32;
      if (!isAlnumOrSpace) symbolCount++;
    } else if (!LETTER_OR_NUMBER.test(ch)) {
      symbolCount++;
    }
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
