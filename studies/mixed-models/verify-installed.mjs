// Run after the general installed-artifact check in ../cache-accounting/verify-installed.mjs.
// node studies/mixed-models/verify-installed.mjs INSTALL_PREFIX OUTPUT_DIR [NODE_BINARY ...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const [prefix, output, ...engines] = process.argv.slice(2);
const cli = resolve(prefix, "node_modules/@antonsoloviev/contextscope/dist/cli/index.js");
mkdirSync(output, { recursive: true });
const fixture = resolve("examples/anthropic-mixed-models.jsonl.gz");
const json = resolve(output, "mixed.json");
const html = resolve(output, "mixed.html");
const results = [];
const records = gunzipSync(readFileSync(fixture)).toString().trim().split("\n").map((line) => JSON.parse(line));
// The largest request is the minority Opus model, unlike the original reproduction.
records[2].system[0].text += " Additional evidence for this request.".repeat(200);
const calibrationInput = resolve(output, "calibration-input.json");
writeFileSync(calibrationInput, JSON.stringify(records));
const preload = resolve(output, "offline-count-tokens.mjs");
// The subprocess cannot make an inference/counting HTTP call: fetch is replaced before imports.
writeFileSync(preload, `
globalThis.fetch = async (url, init) => {
  if (url !== "https://api.anthropic.com/v1/messages/count_tokens") throw new Error("Unexpected URL");
  const body = JSON.parse(init.body);
  if (body.model !== process.env.EXPECTED_COUNT_MODEL) throw new Error("Wrong calibration model: " + body.model);
  if (!body.system[0].text.includes("Additional evidence")) throw new Error("Wrong calibration request");
  return new Response(JSON.stringify({ input_tokens: 5000 }), { status: 200 });
};
`);
for (const node of engines.length ? engines : [process.execPath]) {
  const version = spawnSync(node, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  const run = spawnSync(node, [cli, "analyze", fixture, "--json", json, "--html", html], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(json, "utf8"));
  assert.deepEqual(report.reports.map((r) => r.model.id), records.map((r) => r.model));
  assert.equal(report.cacheSimulation.actual[3].readTokens, 0);
  assert.equal(report.cacheSimulation.actual[3].uncachedTokens, 3696);
  assert.ok(Math.abs(report.cacheSimulation.actual[3].costUsd - 0.01848) < 1e-12);
  assert.match(readFileSync(html, "utf8"), /req 4<\/td><td>Claude Opus 4.5<\/td><td>0<\/td><td>0<\/td><td>0<\/td><td>3,696<\/td><td>\$0.0185/);
  for (const override of [undefined, "claude-sonnet-4-5"]) {
    const args = ["--import", pathToFileURL(preload).href, cli, "analyze", calibrationInput, "--calibrate", "--json", json];
    if (override) args.push("--model", override);
    const calibrated = spawnSync(node, args, { encoding: "utf8", env: {
      PATH: process.env.PATH, ANTHROPIC_API_KEY: "offline-test-placeholder", EXPECTED_COUNT_MODEL: override ?? "claude-opus-4-5",
    } });
    assert.equal(calibrated.status, 0, calibrated.stderr);
    assert.match(calibrated.stdout, /calibrated: request 3 is 5,000 tokens/);
    assert.match(calibrated.stdout, new RegExp(override ?? "claude-opus-4-5"));
  }
  results.push({ nodeVersion: version.stdout.trim(), mixedModelPricing: true, perRequestModelExport: true, offlineHtmlRows: true, calibrationUsesLargestRequestsModel: true, calibrationHonorsOverride: true, providerCalls: 0 });
}
writeFileSync(resolve(output, "mixed-installed-verification.json"), JSON.stringify({ results }, null, 2) + "\n");
console.log(JSON.stringify(results));
