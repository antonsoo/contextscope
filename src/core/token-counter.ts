import { countOpenaiTokens } from "./tokenize-openai.js";
import { estimateClaudeTokens } from "./tokenize-claude.js";

export interface TokenCounts {
  openai: number;
  claude: number;
}

export type TokenCounter = (text: string) => TokenCounts;

export const countTokens: TokenCounter = (text) => ({ openai: countOpenaiTokens(text), claude: estimateClaudeTokens(text) });

/**
 * A counter that tokenizes each distinct text once. An agent loop re-sends its
 * whole history on every request, so a 24-turn session carries ~1,300 segments
 * but only ~100 distinct ones; BPE-encoding each distinct text once is most of
 * the parse time saved. Scoped to one parse so nothing outlives the input.
 */
export function memoizedCounter(): TokenCounter {
  const cache = new Map<string, TokenCounts>();
  return (text) => {
    let counts = cache.get(text);
    if (counts === undefined) {
      counts = countTokens(text);
      cache.set(text, counts);
    }
    return counts;
  };
}
