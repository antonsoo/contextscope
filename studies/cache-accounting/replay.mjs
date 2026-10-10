// Synthetic counterexamples, not provider measurements. Run after npm run build:core:
// node studies/cache-accounting/replay.mjs [output.json] [dist-directory]
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const [output, dist = "dist"] = process.argv.slice(2);
const { analyze } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const marker = (ttl) => ({ cache_control: { type: "ephemeral", ttl } });
const request = (early) => ({
  model: "claude-sonnet-4-5", max_tokens: 100,
  system: [{ type: "text", text: "Stable project specification. ".repeat(400), ...(early ? marker(early) : {}) }],
  messages: [{ role: "user", content: [{ type: "text", text: "Reference context. ".repeat(400), ...marker("5m") }] }],
});
const blocks = (count, marked) => ({
  model: "claude-sonnet-4-5", max_tokens: 100,
  messages: [{ role: "user", content: Array.from({ length: count }, (_, i) => ({
    type: "text", text: `Section ${i}: ${"Stable technical reference. ".repeat(200)}`,
    ...(marked.includes(i) ? marker("5m") : {}),
  })) }],
});
const cases = [
  { name: "earlier-1h-marker-under-existing-hit", requests: [request(null), request("1h")] },
  { name: "earlier-5m-marker-under-existing-hit", requests: [request(null), request("5m")] },
  { name: "nineteen-new-positions", requests: [blocks(1, [0]), blocks(20, [19])] },
  { name: "twenty-new-positions", requests: [blocks(1, [0]), blocks(21, [20])] },
  { name: "optimized-four-existing-markers", requests: [blocks(5, [0, 1, 2, 3]), blocks(6, [0, 1, 2, 3])] },
];
const results = cases.map(({ name, requests }) => {
  const result = analyze(JSON.stringify(requests));
  const steps = (scenario) => result.cacheSimulation[scenario].map((step, i) => {
    const estimatedInputTokens = result.reports[i].totals.claudeTokensEstimate;
    const accountedTokens = step.readTokens + step.writeTokens5m + step.writeTokens1h + step.uncachedTokens;
    return { ...step, estimatedInputTokens, accountedTokens, excessTokens: accountedTokens - estimatedInputTokens };
  });
  return { name, actual: steps("actual"), optimized: steps("optimized"), findings: result.findings.map(({ kind, requestIndex }) => ({ kind, requestIndex })) };
});
const evidence = { synthetic: true, note: "Controlled requests using estimated tokens; no API calls or observed charges.", cases: results };
const json = JSON.stringify(evidence, null, 2) + "\n";
if (output) writeFileSync(output, json);
else console.log(json);
mkdirSync("examples", { recursive: true });
writeFileSync("examples/anthropic-cache-breakpoints.jsonl.gz", gzipSync(cases[0].requests.map((r) => JSON.stringify(r)).join("\n") + "\n"));
