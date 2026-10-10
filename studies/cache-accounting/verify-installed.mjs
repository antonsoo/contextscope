// Exercise the compiled, installed package, without source imports or development scripts.
// node studies/cache-accounting/verify-installed.mjs INSTALL_PREFIX OUTPUT_DIR [NODE_BINARY ...]
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const [prefix, output, ...engines] = process.argv.slice(2);
const cli = resolve(prefix, "node_modules/@antonsoloviev/contextscope/dist/cli/index.js");
mkdirSync(output, { recursive: true });
const samples = readdirSync("examples").filter((f) => /\.jsonl(?:\.gz)?$/.test(f)).sort();
const results = [];
for (const node of engines.length ? engines : [process.execPath]) {
  const version = spawnSync(node, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  const nodeVersion = version.stdout.trim();
  for (const sample of samples) {
    const json = resolve(output, "report.json");
    const html = resolve(output, "report.html");
    const run = spawnSync(node, [cli, "analyze", resolve("examples", sample), "--json", json, "--html", html], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    assert.equal(run.status, 0, `${nodeVersion} / ${sample}: ${run.stderr}`);
    const report = JSON.parse(readFileSync(json, "utf8"));
    for (const scenario of ["actual", "optimized"]) report.cacheSimulation[scenario].forEach((step, i) => {
      const total = report.reports[i].totals[report.parse.format === "anthropic" ? "claudeTokensEstimate" : "openaiTokens"];
      assert.equal(step.readTokens + step.writeTokens5m + step.writeTokens1h + step.uncachedTokens, total);
    });
    if (sample === "anthropic-cache-breakpoints.jsonl.gz") {
      const second = report.cacheSimulation.actual[1];
      assert.equal(second.readTokens, 5939);
      assert.equal(second.writeTokens1h, 0);
      assert.equal(second.writeTokens5m, 0);
      assert.ok(Math.abs(second.costUsd - 0.0017817) < 1e-12);
      assert.match(readFileSync(html, "utf8"), /req 2<\/td><td>5,939<\/td><td>0<\/td><td>0<\/td><td>0<\/td><td>\$0\.0018/);
    }
    results.push({ nodeVersion, sample, requests: report.parse.requests.length, exit: run.status, partitionsConserveTokens: true });
    console.log(`${nodeVersion}: ${sample} (${report.parse.requests.length} requests)`);
  }
  const invalid = resolve(output, "invalid.json");
  const priorReport = resolve(output, "preserve.json");
  const sentinel = "Existing report must survive invalid input.\n";
  writeFileSync(priorReport, sentinel);
  writeFileSync(invalid, JSON.stringify({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: Array.from({ length: 5 }, () => ({ type: "text", text: "reference", cache_control: { type: "ephemeral" } })) }] }));
  const rejected = spawnSync(node, [cli, "analyze", invalid, "--json", priorReport], { encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /5 cache breakpoints exceed Anthropic's limit of 4/);
  assert.equal(rejected.stdout, "");
  assert.equal(readFileSync(priorReport, "utf8"), sentinel);
}
writeFileSync(resolve(output, "installed-verification.json"), JSON.stringify({ results, invalidInputPreservesReports: true }, null, 2) + "\n");
