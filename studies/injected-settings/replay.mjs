// node studies/injected-settings/replay.mjs OUTPUT [DIST] [--verify]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";

const [output, ...options] = process.argv.slice(2);
const dist = options.find(s => s !== "--verify") ?? "dist";
const verify = options.includes("--verify");
const { analyze, toJsonReport, parseInput, countTokensBody } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const root = new URL("./captures/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
const hash = data => createHash("sha256").update(data).digest("hex");
const cases = manifest.cases.map(capture => {
  const packed = readFileSync(new URL(capture.file, root)), raw = gunzipSync(packed);
  assert.equal(hash(packed), capture.gzip.sha256); assert.equal(hash(raw), capture.raw.sha256);
  const result = { name: capture.name, inputSha256: hash(raw) };
  try {
    const analysis = analyze(raw.toString("utf8"));
    result.report = JSON.parse(toJsonReport(analysis));
    result.expectedReads = Object.fromEntries(["actual", "optimized"].map(scenario => [scenario,
      capture.expected[scenario].map((path, i) => {
        if (path === null) return 0;
        const segments = analysis.reports[i].segments, boundary = segments.findIndex(s => s.path === path);
        assert(boundary >= 0, `${capture.name}: missing expected boundary ${path}`);
        return segments.slice(0, boundary + 1).reduce((n, s) => n + s.claudeTokensEstimate, 0);
      })]));
    result.discrepancies = ["actual", "optimized"].filter(scenario =>
      JSON.stringify(analysis.cacheSimulation[scenario].map(s => s.readTokens)) !== JSON.stringify(result.expectedReads[scenario]));
    if (capture.expectedError) result.discrepancies.push("expected-refusal");
    for (const scenario of ["actual", "optimized"]) analysis.cacheSimulation[scenario].forEach((s, i) =>
      assert.equal(s.readTokens + s.writeTokens5m + s.writeTokens1h + s.uncachedTokens, analysis.reports[i].totals.claudeTokensEstimate));
  } catch (error) {
    result.error = { name: error.name, message: error.message };
    result.discrepancies = capture.expectedError && error.message.toLowerCase().includes(capture.expectedError) ? [] : ["unexpected-refusal"];
  }
  if (verify) assert.deepEqual(result.discrepancies, [], capture.name);
  return result;
});
const counts = manifest.countBodies.map(capture => {
  const bytes = readFileSync(new URL(capture.file, root)); assert.equal(hash(bytes), capture.sha256);
  const request = parseInput(JSON.stringify(capture.request)).requests[0];
  const actual = countTokensBody(request, request.model);
  const expected = JSON.parse(bytes);
  const matches = isDeepStrictEqual(actual, expected);
  // Key order is irrelevant in the API envelope; schemas still retain order.
  if (verify) assert.deepEqual(actual, expected, capture.name);
  return { name: capture.name, native: expected, actual, matches };
});
const implementation = Object.fromEntries(["cache-anthropic.js", "anthropic-injected-settings.js", "calibrate.js", "parse-anthropic.js", "findings.js"].map(name => {
  const file = resolve(dist, "core", name);
  return [name, existsSync(file) ? hash(readFileSync(file)) : null];
}));
const value = { provenance: manifest.provenance, implementation, cases, countBodies: counts,
  workflowsWithDiscrepancies: cases.filter(c => c.discrepancies.length).length,
  countBodiesWithDiscrepancies: counts.filter(c => !c.matches).length };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(value, null, 2) + "\n");
console.log(JSON.stringify({ cases: cases.length, workflowDiscrepancies: value.workflowsWithDiscrepancies,
  countDiscrepancies: value.countBodiesWithDiscrepancies }));
