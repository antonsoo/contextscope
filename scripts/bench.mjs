// Times analyze() on the flagship example and on a generated 300-request session.
//   npm run build:core && node scripts/bench.mjs [runs]
// Prints the median of `runs` (default 9) after one warm-up, so numbers are comparable across
// commits on the same machine. The stress session is deterministic: 300 requests of a growing
// conversation (tool calls, tool results, a timestamped system prompt), ~2.9 MB of JSONL.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { analyze } from "../dist/core/index.js";

const runs = Number(process.argv[2] ?? 9);

function median(fn) {
  fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function stressSession(requests) {
  const tools = Array.from({ length: 12 }, (_, i) => ({ name: `tool_${i}`, description: `Tool number ${i}. `.repeat(8), input_schema: { type: "object", properties: { arg: { type: "string" } } } }));
  const lines = [];
  const messages = [{ role: "user", content: "Refactor the billing module and keep the tests green." }];
  for (let i = 0; i < requests; i++) {
    const minute = String(i % 60).padStart(2, "0");
    lines.push(
      JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        tools,
        system: [{ type: "text", text: `Now: 2026-09-24T10:${minute}:00Z. You are a careful coding agent.`, cache_control: { type: "ephemeral" } }],
        messages,
      }),
    );
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: `tool_${i % 12}`, input: { arg: `step ${i}` } }] });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `result of step ${i}: ${"ok ".repeat(10 + (i % 7))}` }] });
  }
  return lines.join("\n");
}

const flagship = gunzipSync(readFileSync(new URL("../examples/anthropic-agent-cache-bust.jsonl.gz", import.meta.url))).toString("utf8");
const stress = stressSession(300);
console.log(`flagship: 24 requests, ${(flagship.length / 1e6).toFixed(1)} MB  -> analyze() median ${median(() => analyze(flagship)).toFixed(0)} ms`);
console.log(`stress:  300 requests, ${(stress.length / 1e6).toFixed(1)} MB  -> analyze() median ${median(() => analyze(stress)).toFixed(0)} ms`);
