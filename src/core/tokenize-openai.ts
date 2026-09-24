/**
 * Exact token counts via `gpt-tokenizer`, a pure-JS port of OpenAI's tiktoken.
 * o200k_base is the encoding used by GPT-4o and newer OpenAI models; it is
 * also our best available proxy for a "typical BPE tokenizer" and is what we
 * calibrate the Claude estimate against in tests.
 */
import { encode } from "gpt-tokenizer/encoding/o200k_base";

export function countOpenaiTokens(text: string): number {
  if (text.length === 0) return 0;
  return encode(text).length;
}
