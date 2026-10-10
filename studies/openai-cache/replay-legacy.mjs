// Compare the existing historical approximation with the new model dispatch.
// node studies/openai-cache/replay-legacy.mjs BASELINE_DIST CURRENT_DIST OUTPUT.json
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [baseline, current, output, file] = process.argv.slice(2);
if (file) {
  const prior = await import(pathToFileURL(resolve(baseline, "core/index.js")));
  const now = await import(pathToFileURL(resolve(current, "core/index.js")));
  const trajectory = JSON.parse(readFileSync(file, "utf8"));
  const captures = trajectory.messages.flatMap((message, i) => {
    const response = message.extra?.response;
    if (message.role !== "assistant" || !response?.usage) return [];
    return [{ request: { model: response.model, messages: trajectory.messages.slice(0, i).map(({ role, content }) => ({ role, content })) }, response }];
  });
  const oldResult = prior.analyze(JSON.stringify(captures));
  const result = now.analyze(JSON.stringify(captures));
  assert.equal(result.parse.requests.length, captures.length);
  for (const scenario of ["actual", "optimized"]) result.cacheSimulation[scenario].forEach((step, i) => {
    assert.equal(step.cacheMode, "legacy");
    assert.equal(step.readTokens, oldResult.cacheSimulation[scenario][i].readTokens);
    assert.equal(step.uncachedTokens, oldResult.cacheSimulation[scenario][i].uncachedTokens);
    assert.equal(step.writeTokens30m, undefined);
    const rate = captures[i].request.model.startsWith("gpt-5.1") ? 1.25 : 1.75;
    assert.ok(Math.abs(step.costUsd - rate * (step.uncachedTokens + step.readTokens * 0.1) / 1e6) < 1e-12);
  });
  result.reports.forEach((report, i) => {
    assert.equal(report.model.unrecognized, undefined);
    assert.equal(report.totals.openaiTokens, captures[i].response.usage.prompt_tokens);
  });
  assert.deepEqual(result.usageComparison, oldResult.usageComparison);
  console.log(JSON.stringify({ requests: captures.length, simulatedReads: result.usageComparison.cacheRead.simulatedTokens,
    reportedReads: result.usageComparison.cacheRead.reportedTokens, estimatedInput: result.usageComparison.input.simulatedTokens,
    oldCost: oldResult.cacheSimulation.totalActualCostUsd, cost: result.cacheSimulation.totalActualCostUsd }));
} else {
  const start = performance.now();
  const manifestBytes = readFileSync("studies/real-trajectories/manifest.json");
  const manifest = JSON.parse(manifestBytes);
  const rows = [];
  for (const [entry, data] of Object.entries(manifest.entries)) {
    if (!/mini-v1\.(15|17)\.\d_gpt/.test(entry)) continue;
    for (const [name, metadata] of Object.entries(data.files)) {
      const source = resolve("studies/real-trajectories/cache", entry, name);
      assert.equal(sha(readFileSync(source)), metadata.sha256);
      const run = spawnSync(process.execPath, [process.argv[1], baseline, current, output, source], { encoding: "utf8", maxBuffer: 2e6 });
      assert.equal(run.status, 0, run.stderr);
      rows.push({ entry, file: name, sourceSha256: metadata.sha256, ...JSON.parse(run.stdout) });
    }
    console.log(`${entry}: ${rows.length} files checked`);
  }
  assert.equal(rows.length, 120);
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const result = { manifestSha256: sha(manifestBytes), files: rows.length, requests: sum("requests"),
    changedCachePartitions: 0, changedUsageComparisons: 0, inputCountDisagreements: 0,
    costFormulaDisagreements: 0, simulatedReads: sum("simulatedReads"), reportedReads: sum("reportedReads"),
    estimatedInput: sum("estimatedInput"), oldCost: sum("oldCost"), cost: sum("cost"),
    elapsedSeconds: (performance.now() - start) / 1000, rows };
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, rows: undefined }));
}
