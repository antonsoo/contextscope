// A synthetic paired capture about Contextscope's own JSON reader. All response counts
// are deliberately authored examples, never presented as measurements from a live API.
import { readFileSync, writeFileSync } from "node:fs";

const source = ["read-json.ts", "parse.ts"].map((name) => `File: src/core/${name}\n${readFileSync(new URL(`../src/core/${name}`, import.meta.url), "utf8")}`).join("\n\n");
const messages = [
  { role: "system", content: "Review the supplied JSON capture reader. Preserve source positions across skipped lines, reject ambiguous envelopes, and keep malformed evidence visible. Explain each change." },
  { role: "user", content: `Review these files for ambiguous request or response records.\n\n${source}` },
];
const usage = [
  { prompt_tokens: 4800, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens: 120 },
  { prompt_tokens: 5100, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens: 90 },
  { prompt_tokens: 5400, prompt_tokens_details: { cached_tokens: 4096 }, completion_tokens: 100 },
  { prompt_tokens: 5700, completion_tokens: 80 },
  { prompt_tokens: 6000, prompt_tokens_details: { cached_tokens: 6001 }, completion_tokens: 60 },
  undefined,
];
const replies = ["Check usage provenance next.", "Keep missing counters distinct from zero.", "Inspect counters that exceed input totals.", "Keep original line positions in the export.", "Summarize the review."];
const records = usage.map((counts, index) => {
  if (index) messages.push({ role: "assistant", content: "I reviewed that part of the reader." }, { role: "user", content: replies[index - 1] });
  return { capture_note: "Synthetic demonstration. Response counters are authored, not live API measurements.", request: { model: "gpt-6-sol", messages: messages.map((message) => ({ ...message })) }, ...(counts ? { response: { usage: counts } } : {}) };
});
const content = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
writeFileSync(new URL("../examples/reported-cache-usage.jsonl", import.meta.url), content);
console.log(`${records.length} paired/request-only records, ${Buffer.byteLength(content)} bytes`);
