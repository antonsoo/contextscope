// node studies/openai-cache/replay.mjs DIST OUTPUT
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [dist = "dist", output = "studies/openai-cache/after.json"] = process.argv.slice(2);
const { analyze } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const text = gunzipSync(readFileSync("examples/openai-cache-modes.jsonl.gz")).toString();
const result = analyze(text);
const outputData = { kind: "synthetic SDK-serialized requests; no provider measurements", rows: result.parse.requests.map((r, i) => ({
  request: i + 1, key: r.raw.prompt_cache_key, mode: r.raw.prompt_cache_options.mode,
  totalTokens: result.reports[i].totals.openaiTokens, ...result.cacheSimulation.actual[i],
})), totalCostUsd: result.cacheSimulation.totalActualCostUsd, findings: result.findings };
writeFileSync(output, JSON.stringify(outputData, null, 2) + "\n");
console.log(JSON.stringify(outputData.rows));
