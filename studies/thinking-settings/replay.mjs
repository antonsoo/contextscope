// node studies/thinking-settings/replay.mjs OUTPUT [DIST] [--verify]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const [output, ...options] = process.argv.slice(2);
const dist = options.find((s) => s !== "--verify") ?? "dist";
const verify = options.includes("--verify");
const root = new URL("./captures/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const results = manifest.cases.map((capture) => {
  const packed = readFileSync(new URL(capture.file, root)), raw = gunzipSync(packed);
  assert.equal(hash(packed), capture.gzipSha256);
  assert.equal(hash(raw), capture.rawSha256);
  assert.equal(raw.length, capture.rawBytes);
  const analysis = analyze(raw.toString("utf8"));
  const report = JSON.parse(toJsonReport(analysis));
  const segments = analysis.reports[0].segments;
  const firstUser = segments.slice(0, segments.findIndex((s) => s.path.startsWith("messages[0]")) + 1)
    .reduce((n, s) => n + s.claudeTokensEstimate, 0);
  const all = analysis.reports[0].totals.claudeTokensEstimate;
  const expectedReads = capture.expectedReadBoundaries.map((s) => s === "none" ? 0 : s === "all" ? all : firstUser);
  const discrepancies = [];
  for (const scenario of ["actual", "optimized"]) {
    const steps = report.cacheSimulation[scenario];
    if (JSON.stringify(steps.map((s) => s.readTokens)) !== JSON.stringify(expectedReads)) discrepancies.push(scenario);
    steps.forEach((s, i) => assert.equal(s.readTokens + s.writeTokens5m + s.writeTokens1h + s.uncachedTokens,
      analysis.reports[i].totals.claudeTokensEstimate));
  }
  if (verify) assert.deepEqual(discrepancies, [], capture.name);
  return { name: capture.name, inputSha256: capture.rawSha256, expectedReads, discrepancies,
    cacheSimulation: report.cacheSimulation, prefixMatches: report.prefixMatches,
    findings: report.findings, report };
});
const evidence = { provenance: manifest.provenance,
  note: "Expected boundaries test the documented message invalidation plus an explicitly conservative all-level scope; these are not observed provider cache results.",
  implementationSha256: Object.fromEntries(["core/cache-anthropic.js", "core/parse-anthropic.js", "core/findings.js"].map((name) => [name, hash(readFileSync(resolve(dist, name)))])),
  workflows: results.length, workflowsWithDiscrepancies: results.filter((r) => r.discrepancies.length).length,
  cases: results };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ workflows: evidence.workflows, discrepancies: evidence.workflowsWithDiscrepancies,
  cases: results.map(({ name, expectedReads, cacheSimulation }) => ({ name, expectedReads, actualReads: cacheSimulation.actual.map((s) => s.readTokens) })) }));
