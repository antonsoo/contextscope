import { bytesToText } from "./gunzip.js";

// The canonical source for every example is /examples at the repo root (also shipped with the
// CLI). The flagship pair is a realistic ~5.7 MB session, gzipped down to ~0.48 MB - small enough
// to commit, still too large to bundle. `scripts/generate-examples.mjs` copies the two .gz files
// into web/public/examples/ so Vite ships them as static assets (fetched only if the user picks
// that example, never bundled into app JS). `bytesToText` decompresses them with the browser's
// native DecompressionStream if the bytes are still gzip-compressed on arrival - some static
// servers (vite preview's included) transparently gzip-decode a `.gz` response via
// Content-Encoding, which `fetch()` then undoes before JS ever sees it, so the fetched bytes
// aren't reliably compressed by the time they get here. The two small examples are plain JSONL
// and stay as lazy `?raw` imports - there's no size problem there to solve.
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

async function loadGzippedAsset(filename: string): Promise<string> {
  const url = `${import.meta.env.BASE_URL}examples/${filename}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch example "${filename}" (${response.status})`);
  return bytesToText(new Uint8Array(await response.arrayBuffer()));
}

export const BUILT_IN_EXAMPLES: BuiltInExample[] = [
  {
    id: "cache-bust",
    label: "Cache bust: timestamp in system prompt",
    description:
      "Synthetic 24-turn coding-agent session, ~79K tokens by the last request. A timestamp inside the system prompt busts the cache on every single turn.",
    format: "anthropic",
    model: "claude-sonnet-5",
    approxSizeMb: 0.48,
    load: () => loadGzippedAsset("anthropic-agent-cache-bust.jsonl.gz"),
  },
  {
    id: "cache-fixed",
    label: "Cache fixed: same session, timestamp removed",
    description: "The same synthetic session with the timestamp removed from the cached prefix - the cache hits from turn 2 onward.",
    format: "anthropic",
    model: "claude-sonnet-5",
    approxSizeMb: 0.48,
    load: () => loadGzippedAsset("anthropic-agent-cache-fixed.jsonl.gz"),
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
