// The single source of truth for these files is /examples at the repo root (also shipped with
// the CLI); `?raw` imports the text at build time so the web app needs no runtime fetch.
import cacheBust from "../../../examples/anthropic-agent-cache-bust.jsonl?raw";
import cacheFixed from "../../../examples/anthropic-agent-cache-fixed.jsonl?raw";
import duplicateToolResults from "../../../examples/anthropic-duplicate-tool-results.jsonl?raw";
import openAiToolsReordered from "../../../examples/openai-agent-tools-reordered.jsonl?raw";

export interface BuiltInExample {
  id: string;
  label: string;
  description: string;
  format: "anthropic" | "openai";
  model: string;
  content: string;
}

export const BUILT_IN_EXAMPLES: BuiltInExample[] = [
  {
    id: "cache-bust",
    label: "Cache bust: timestamp in system prompt",
    description: "Synthetic 6-turn coding-agent session. A timestamp inside the system prompt busts the cache on every single turn.",
    format: "anthropic",
    model: "claude-sonnet-5",
    content: cacheBust,
  },
  {
    id: "cache-fixed",
    label: "Cache fixed: same session, timestamp removed",
    description: "The same synthetic session with the timestamp removed from the cached prefix - the cache hits from turn 2 onward.",
    format: "anthropic",
    model: "claude-sonnet-5",
    content: cacheFixed,
  },
  {
    id: "duplicate-tool-results",
    label: "Duplicate content: same file read 3 times",
    description: "Synthetic session where an agent re-reads an unchanged file three times in one conversation.",
    format: "anthropic",
    model: "claude-sonnet-5",
    content: duplicateToolResults,
  },
  {
    id: "openai-tools-reordered",
    label: "OpenAI: tools reordered mid-session",
    description: "Synthetic OpenAI Chat Completions session where the tool list order flips between two requests.",
    format: "openai",
    model: "gpt-6-sol",
    content: openAiToolsReordered,
  },
];
