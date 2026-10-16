// node studies/media-accounting/replay.mjs OUTPUT [DIST] [--verify]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const [output, ...options] = process.argv.slice(2);
const dist = options.find(s => s !== "--verify") ?? "dist";
const verify = options.includes("--verify");
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const root = new URL("./captures/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
const baseline = verify ? JSON.parse(readFileSync(new URL("./results/before.json", import.meta.url))) : null;
const hash = data => createHash("sha256").update(data).digest("hex");
const cases = manifest.cases.map(capture => {
  const packed = readFileSync(new URL(capture.file, root)), raw = gunzipSync(packed);
  assert.equal(hash(packed), capture.gzip.sha256); assert.equal(hash(raw), capture.raw.sha256);
  const result = analyze(raw.toString("utf8"));
  const report = JSON.parse(toJsonReport(result));
  const discrepancies = [];
  const partial = capture.unmodeledPaths.some(paths => paths.length);
  for (let i = 0; i < capture.unmodeledPaths.length; i++) {
    const paths = capture.unmodeledPaths[i];
    const segments = report.reports[i].segments;
    for (const path of paths) {
      const segment = segments.find(s => s.path === path);
      assert(segment, `${capture.name}: missing source path ${path}`);
      if (segment.openaiTokens !== null || segment.claudeTokensEstimate !== null) discrepancies.push(`request-${i + 1}:media-counted-as-text`);
    }
    if (paths.length) {
      if (report.reports[i].totals.openaiTokens !== null || report.reports[i].totals.claudeTokensEstimate !== null) discrepancies.push(`request-${i + 1}:fabricated-total`);
      if (report.reports[i].percentOfContextWindow !== undefined) discrepancies.push(`request-${i + 1}:fabricated-window-percent`);
    } else {
      assert(Number.isSafeInteger(report.reports[i].totals.openaiTokens));
      assert(Number.isSafeInteger(report.reports[i].totals.claudeTokensEstimate));
    }
  }
  for (const scenario of ["actual", "optimized"]) for (const step of report.cacheSimulation[scenario]) {
    if (partial) {
      if (step.readTokens !== null || step.writeTokens5m !== null || step.writeTokens1h !== null || step.uncachedTokens !== null || step.costUsd !== undefined) discrepancies.push(`${scenario}:fabricated-cache-count`);
    } else {
      assert.equal(step.readTokens + step.writeTokens5m + step.writeTokens1h + (step.writeTokens30m ?? 0) + step.uncachedTokens,
        report.reports[step.requestIndex].totals[capture.api === "anthropic" ? "claudeTokensEstimate" : "openaiTokens"]);
    }
  }
  if (capture.pairedSyntheticUsage) {
    for (const row of report.usageComparison.rows) {
      assert.equal(row.reportedInputTokens, 1200); assert.equal(row.reportedReadTokens, 400);
      if (row.estimatedInputTokens !== null || row.simulatedReadTokens !== null || row.readOutcome !== "unavailable") discrepancies.push("synthetic-usage:invented-comparison");
    }
    assert.equal(report.usageComparison.input.reportedTokens, 2400);
    assert.equal(report.usageComparison.cacheRead.reportedTokens, 800);
    if (verify) assert.deepEqual(report.parse.requests.map(r => r.reportedUsage),
      baseline.cases.find(c => c.name === capture.name).report.parse.requests.map(r => r.reportedUsage));
  }
  if (verify && !partial) assert.deepEqual(report, baseline.cases.find(c => c.name === capture.name).report, `${capture.name}: complete text control changed`);
  if (verify) assert.deepEqual(discrepancies, [], capture.name);
  return { name: capture.name, rawSha256: hash(raw), discrepancies, report };
});
const implementation = Object.fromEntries(["media-accounting.js", "parse-anthropic.js", "parse-openai.js", "report.js", "cache-anthropic.js", "cache-openai.js", "usage-comparison.js"].map(name => {
  const file = resolve(dist, "core", name);
  return [name, existsSync(file) ? hash(readFileSync(file)) : null];
}));
const value = { provenance: manifest.provenance, implementation, cases,
  workflowsWithDiscrepancies: cases.filter(c => c.discrepancies.length).length };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(value, null, 2) + "\n");
console.log(JSON.stringify({ workflows: cases.length, workflowDiscrepancies: value.workflowsWithDiscrepancies }));
