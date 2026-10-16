// node studies/stored-context/replay.mjs OUTPUT [DIST] [--verify]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const [output, ...options] = process.argv.slice(2);
const verify = options.includes("--verify"), dist = options.find(s => s !== "--verify") ?? "dist";
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const manifest = JSON.parse(readFileSync(new URL("./captures/manifest.json", import.meta.url)));
const baseline = verify ? JSON.parse(readFileSync(new URL("./results/before.json", import.meta.url))) : null;
const hash = data => createHash("sha256").update(data).digest("hex");
const cases = manifest.cases.map(capture => {
  const packed = readFileSync(new URL("./captures/" + capture.file, import.meta.url)), raw = gunzipSync(packed);
  assert.equal(hash(packed), capture.gzip.sha256); assert.equal(hash(raw), capture.raw.sha256);
  const value = { name: capture.name, inputSha256: hash(raw), discrepancies: [] };
  try {
    const result = analyze(raw.toString());
    const report = JSON.parse(toJsonReport(result)); value.report = report;
    const unknown = capture.unresolvedPaths.some(paths => paths.length);
    if (capture.expectedError) value.discrepancies.push("expected-refusal");
    if (report.parse.skippedRecords !== capture.expectedSkippedRecords) value.discrepancies.push("record-coverage");
    if (report.reports.length !== capture.unresolvedPaths.length) value.discrepancies.push("retained-request-count");
    if (capture.name === "response-object-control" && report.reports[1]?.segments.length !== 0) value.discrepancies.push("response-echo-counted-as-request");
    for (let i = 0; i < capture.unresolvedPaths.length; i++) {
      const current = report.reports[i];
      if (!current) { value.discrepancies.push(`request-${i + 1}:missing`); continue; }
      for (const path of capture.unresolvedPaths[i]) {
        const segment = current.segments.find(s => s.path === path);
        if (!segment || !segment.unmodeledContext || segment.openaiTokens !== null || segment.claudeTokensEstimate !== null) value.discrepancies.push(`request-${i + 1}:unresolved-${path}`);
      }
      if (capture.unresolvedPaths[i].length) {
        if (current.totals.openaiTokens !== null || current.totals.claudeTokensEstimate !== null || current.percentOfContextWindow !== undefined) value.discrepancies.push(`request-${i + 1}:fabricated-total`);
      } else if (current.totals.openaiTokens === null || current.totals.claudeTokensEstimate === null) value.discrepancies.push(`request-${i + 1}:lost-visible-count`);
    }
    for (const scenario of ["actual", "optimized"]) for (const step of report.cacheSimulation[scenario]) {
      if (unknown) {
        if (step.readTokens !== null || step.uncachedTokens !== null || step.writeTokens5m !== null || step.writeTokens1h !== null || step.costUsd !== undefined) value.discrepancies.push(`${scenario}:fabricated-cache-state`);
      } else {
        assert.equal(step.readTokens + step.writeTokens5m + step.writeTokens1h + (step.writeTokens30m ?? 0) + step.uncachedTokens,
          report.reports[step.requestIndex].totals.openaiTokens);
      }
    }
    if (capture.pairedSyntheticUsage) {
      assert.deepEqual(report.usageComparison.rows.map(r => r.reportedInputTokens), [12000, 12000]);
      assert.deepEqual(report.usageComparison.rows.map(r => r.reportedReadTokens), [0, 400]);
      if (report.usageComparison.rows.some(r => r.estimatedInputTokens !== null || r.simulatedReadTokens !== null || r.inputDeltaTokens !== null || r.readDeltaTokens !== null || r.readOutcome !== "unavailable")) value.discrepancies.push("synthetic-usage:invented-comparison");
      if (verify) assert.deepEqual(report.parse.requests.map(r => r.reportedUsage), baseline.cases.find(c => c.name === capture.name).report.parse.requests.map(r => r.reportedUsage));
    }
    if (verify && ["store-control", "null-control", "literal-control"].includes(capture.name)) {
      assert.deepEqual(report, baseline.cases.find(c => c.name === capture.name).report, capture.name + ": complete control changed");
    }
  } catch (error) {
    value.error = { name: error.name, message: error.message };
    value.discrepancies = capture.expectedError && error.message.toLowerCase().includes(capture.expectedError) ? [] : ["unexpected-refusal"];
  }
  if (verify) assert.deepEqual(value.discrepancies, [], capture.name);
  return value;
});
const implementation = Object.fromEntries(["openai-context.js", "parse-openai.js", "parse.js", "detect.js", "cache-openai.js", "media-accounting.js", "report.js"].map(name => {
  const path = resolve(dist, "core", name); return [name, existsSync(path) ? hash(readFileSync(path)) : null];
}));
const value = { provenance: manifest.provenance, implementation, cases,
  workflowsWithDiscrepancies: cases.filter(c => c.discrepancies.length).length };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(value, null, 2) + "\n");
console.log(JSON.stringify({ workflows: cases.length, discrepancies: value.workflowsWithDiscrepancies }));
