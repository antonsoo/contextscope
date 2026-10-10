// Controlled mixed-model counterexample, never a provider measurement.
// node studies/mixed-models/replay.mjs DIST OUTPUT
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const [dist = "dist", output = "studies/mixed-models/after.json"] = process.argv.slice(2);
const { analyze } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const models = ["claude-sonnet-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "claude-opus-4-5", "claude-sonnet-4-5"];
const requests = models.map((model, i) => ({ model, max_tokens: 64,
  system: [{ type: "text", text: "Reference material for the assistant, kept verbatim. ".repeat(230), cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: `task ${i}` }],
}));
const text = requests.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync("examples/anthropic-mixed-models.jsonl.gz", gzipSync(text));
const combined = analyze(text);
const isolated = new Map(models.map((model) => [model, analyze(JSON.stringify(requests.filter((r) => r.model === model)))]));
const seen = new Map();
const rows = models.map((model, i) => {
  const offset = seen.get(model) ?? 0;
  seen.set(model, offset + 1);
  return { request: i + 1, capturedModel: model, assumedModel: combined.reports[i].model ?? combined.model,
    combined: combined.cacheSimulation.actual[i], isolated: isolated.get(model).cacheSimulation.actual[offset] };
});
writeFileSync(output, JSON.stringify({ kind: "synthetic counterexample", rows, totals: {
  combined: combined.cacheSimulation.totalActualCostUsd,
  isolated: [...isolated.values()].reduce((sum, result) => sum + result.cacheSimulation.totalActualCostUsd, 0),
} }, null, 2) + "\n");
console.log(JSON.stringify({ output, totals: combined.cacheSimulation.totalActualCostUsd }));
