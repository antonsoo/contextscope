// Interleave the 240 hash-verified reconstructed histories in 40 six-stream batches.
// Oracle: a model's requests must have the same accounting alone and in a mixed log.
// This changes event ordering; it is a regression experiment, not captured live traffic.
// node studies/mixed-models/interleave-corpus.mjs SCRATCH BASELINE_DIST OUTPUT [MAX_BATCHES]
// Checkpoints after each batch. Resume only with identical compiled code and source manifest.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { analyze, clearTokenCache, normalizeModelId } from "../../dist/core/index.js";

const [scratch, baselineDist, output, maxBatches = "40"] = process.argv.slice(2);
const before = await import(pathToFileURL(resolve(baselineDist, "core/index.js")).href);
const reconstruction = JSON.parse(readFileSync(resolve(scratch, "reconstruction.json"), "utf8"));
const groups = Map.groupBy(reconstruction.sources, (source) => source.entry);
assert.equal(groups.size, 6);
for (const sources of groups.values()) assert.equal(sources.length, 40);
const fingerprint = (dist) => {
  const hash = createHash("sha256");
  for (const file of readdirSync(resolve(dist, "core")).filter((f) => f.endsWith(".js")).sort()) hash.update(file).update(readFileSync(resolve(dist, "core", file)));
  return hash.digest("hex");
};
const implementations = { before: fingerprint(baselineDist), after: fingerprint("dist") };
const existing = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : undefined;
if (existing) {
  assert.equal(existing.manifestSha256, reconstruction.manifestSha256);
  assert.deepEqual(existing.implementations, implementations);
}
const batches = existing?.batches ?? [];
const end = Math.min(40, batches.length + Number(maxBatches));
assert.ok(Number.isInteger(end) && end > 0);
function checkpoint() {
  const totals = {};
  for (const batch of batches) for (const key of ["requests", "beforeDifferentRows", "afterDifferentRows", "beforeDifferentTokenPartitions", "afterDifferentTokenPartitions", "beforeCostUsd", "afterCostUsd", "isolatedCostUsd"]) totals[key] = (totals[key] ?? 0) + batch[key];
  writeFileSync(output, JSON.stringify({ note: "Artificial interleaving of reconstructed public histories, not live measurements. Differences count actual plus optimized rows. Oracle is baseline analysis partitioned by model.", complete: batches.length === 40, implementations, manifestSha256: reconstruction.manifestSha256, totals, batches }, null, 2) + "\n");
  return totals;
}
for (let batch = batches.length; batch < end; batch++) {
  const sources = [...groups.values()].map((sources) => sources[batch]);
  const streams = sources.map((source) => {
    const bytes = gunzipSync(readFileSync(resolve(scratch, "bodies", source.entry, source.file.replace(".traj.json", ".jsonl.gz"))));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.requestsSha256);
    return bytes.toString().trim().split("\n").slice(1).map((line) => JSON.parse(line).body);
  });
  const requests = [];
  for (let offset = 0; offset < Math.max(...streams.map((s) => s.length)); offset++) {
    for (const stream of streams) if (offset < stream.length) requests.push(stream[offset]);
  }
  const perModel = Map.groupBy(requests, (request) => normalizeModelId(request.model));
  const references = new Map([...perModel].map(([model, requests]) => [model, before.analyze(JSON.stringify(requests))]));
  const text = JSON.stringify(requests);
  const old = before.analyze(text);
  const current = analyze(text);
  const seen = new Map();
  const data = { batch: batch + 1, requests: requests.length, models: [...perModel.keys()], beforeDifferentRows: 0, afterDifferentRows: 0,
    beforeDifferentTokenPartitions: 0, afterDifferentTokenPartitions: 0, beforeCostUsd: old.cacheSimulation.totalActualCostUsd,
    afterCostUsd: current.cacheSimulation.totalActualCostUsd, isolatedCostUsd: [...references.values()].reduce((s, r) => s + r.cacheSimulation.totalActualCostUsd, 0),
    sources: sources.map(({ entry, file, requestsSha256 }) => ({ entry, file, requestsSha256 })) };
  for (let i = 0; i < requests.length; i++) {
    const model = normalizeModelId(requests[i].model);
    const offset = seen.get(model) ?? 0;
    seen.set(model, offset + 1);
    for (const scenario of ["actual", "optimized"]) {
      const expected = references.get(model).cacheSimulation[scenario][offset];
      for (const [label, result] of [["before", old], ["after", current]]) {
        const step = result.cacheSimulation[scenario][i];
        const fields = ["readTokens", "writeTokens5m", "writeTokens1h", "uncachedTokens"];
        const sameTokens = fields.every((field) => step[field] === expected[field]);
        if (!sameTokens) data[`${label}DifferentTokenPartitions`]++;
        if (!sameTokens || Math.abs(step.costUsd - expected.costUsd) > 1e-12) data[`${label}DifferentRows`]++;
      }
    }
    assert.equal(current.reports[i].model.id, model);
  }
  assert.equal(data.afterDifferentRows, 0);
  assert.ok(Math.abs(data.afterCostUsd - data.isolatedCostUsd) < 1e-9);
  batches.push(data);
  checkpoint();
  before.clearTokenCache(); clearTokenCache();
  console.log(`Batch ${batch + 1}/40: ${data.requests} requests; before ${data.beforeDifferentRows}, after ${data.afterDifferentRows} differing rows (actual + optimized)`);
}
console.log(JSON.stringify(checkpoint()));
