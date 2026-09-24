// The single source of truth for these files is /examples at the repo root (also shipped with
// the CLI). The flagship pair is a realistic ~5.5 MB session, so each is loaded via a dynamic
// `import()` - its own chunk, fetched only if the user actually picks that example - rather than
// a static `?raw` import, which would inline all four files (11+ MB) into the app's main bundle
// and make even the drop-zone screen slow to load.
export interface BuiltInExample {
  id: string;
  label: string;
  description: string;
  format: "anthropic" | "openai";
  model: string;
  approxSizeMb: number;
  load: () => Promise<string>;
}

async function loadRaw(importer: () => Promise<{ default: string }>): Promise<string> {
  return (await importer()).default;
}

export const BUILT_IN_EXAMPLES: BuiltInExample[] = [
  {
    id: "cache-bust",
    label: "Cache bust: timestamp in system prompt",
    description:
      "Synthetic 24-turn coding-agent session, ~79K tokens by the last request. A timestamp inside the system prompt busts the cache on every single turn.",
    format: "anthropic",
    model: "claude-sonnet-5",
    approxSizeMb: 5.7,
    load: () => loadRaw(() => import("../../../examples/anthropic-agent-cache-bust.jsonl?raw")),
  },
  {
    id: "cache-fixed",
    label: "Cache fixed: same session, timestamp removed",
    description: "The same synthetic session with the timestamp removed from the cached prefix - the cache hits from turn 2 onward.",
    format: "anthropic",
    model: "claude-sonnet-5",
    approxSizeMb: 5.7,
    load: () => loadRaw(() => import("../../../examples/anthropic-agent-cache-fixed.jsonl?raw")),
  },
  {
    id: "duplicate-tool-results",
    label: "Duplicate content: same file read 3 times",
    description: "Synthetic session where an agent re-reads an unchanged file three times in one conversation.",
    format: "anthropic",
    model: "claude-sonnet-5",
    approxSizeMb: 0.13,
    load: () => loadRaw(() => import("../../../examples/anthropic-duplicate-tool-results.jsonl?raw")),
  },
  {
    id: "openai-tools-reordered",
    label: "OpenAI: tools reordered mid-session",
    description: "Synthetic OpenAI Chat Completions session where the tool list order flips between two requests.",
    format: "openai",
    model: "gpt-6-sol",
    approxSizeMb: 0.13,
    load: () => loadRaw(() => import("../../../examples/openai-agent-tools-reordered.jsonl?raw")),
  },
];
