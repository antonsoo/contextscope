import { bytesToText, readBoundedStream } from "./gunzip.js";

// Fetch examples only when chosen. Every request and decoded stream belongs to an abortable
// import, and uses the same byte limits as local files. Static hosts may decode gzip themselves.
export interface BuiltInExample {
  id: string;
  label: string;
  description: string;
  approxSizeMb: number;
  load: (signal: AbortSignal) => Promise<string>;
}

async function loadAsset(filename: string, signal: AbortSignal): Promise<string> {
  const url = `${import.meta.env.BASE_URL}examples/${filename}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not fetch example "${filename}" (${response.status})`);
  if (!response.body) throw new Error("The example response has no body.");
  return bytesToText(await readBoundedStream(response.body, { signal }), { signal });
}

export const BUILT_IN_EXAMPLES: BuiltInExample[] = [
  {
    id: "mixed-models",
    label: "Model routing: same prompt, different cache minimums",
    description: "Synthetic Sonnet 4.5 / Opus 4.5 log. The same short prefix caches on Sonnet and stays uncached on Opus. Each request uses its own model's rules and prices; no live measurements.",
    approxSizeMb: 0.06,
    load: (signal) => loadAsset("anthropic-mixed-models.jsonl.gz", signal),
  },
  {
    id: "reported-cache-usage",
    label: "Reported usage: predicted hits, recorded zeroes",
    description: "Synthetic six-request review of Contextscope's JSON reader. Authored response counters include zero reads, a hit, missing counts and an invalid count. No live API measurements.",
    approxSizeMb: 0.1,
    load: (signal) => loadAsset("reported-cache-usage.jsonl", signal),
  },
  {
    id: "cache-bust",
    label: "Cache bust: timestamp in system prompt",
    description:
      "Synthetic 24-turn coding-agent session, ~79K tokens by the last request. A timestamp inside the system prompt busts the cache on every single turn.",
    approxSizeMb: 0.48,
    load: (signal) => loadAsset("anthropic-agent-cache-bust.jsonl.gz", signal),
  },
  {
    id: "cache-fixed",
    label: "Cache fixed: same session, timestamp removed",
    description: "The same synthetic session with the timestamp removed from the cached prefix - the simulation predicts cache hits from turn 2 onward.",
    approxSizeMb: 0.48,
    load: (signal) => loadAsset("anthropic-agent-cache-fixed.jsonl.gz", signal),
  },
  {
    id: "duplicate-tool-results",
    label: "Duplicate content: same file read 3 times",
    description: "Synthetic session where an agent re-reads an unchanged file three times in one conversation.",
    approxSizeMb: 0.13,
    load: (signal) => loadAsset("anthropic-duplicate-tool-results.jsonl", signal),
  },
  {
    id: "openai-tools-reordered",
    label: "OpenAI: tools reordered mid-session",
    description: "Synthetic OpenAI Chat Completions session where the tool list order flips between two requests.",
    approxSizeMb: 0.13,
    load: (signal) => loadAsset("openai-agent-tools-reordered.jsonl", signal),
  },
];
