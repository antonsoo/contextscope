// node replay.mjs OUTPUT DIST [before|after]; use the same script for a packed install.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const [outputArg, distArg = "dist", expectation = "after"] = process.argv.slice(2);
assert.ok(outputArg && ["before", "after"].includes(expectation));
const output = resolve(outputArg), dist = resolve(distArg);
mkdirSync(output, { recursive: true });
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(dist, "core/index.js")));
const capture = JSON.parse(readFileSync(new URL("capture.json", import.meta.url)));
const sha = data => createHash("sha256").update(data).digest("hex");
assert.equal(sha(readFileSync(new URL(capture.publicCatalog.ledger, import.meta.url))), capture.publicCatalog.sha256);
const baseline = expectation === "after"
  ? JSON.parse(readFileSync(new URL("results/before.json", import.meta.url))) : null;
const cases = [];
for (const item of capture.cases) {
  const packed = readFileSync(new URL("captures/" + item.file, import.meta.url));
  const raw = gunzipSync(packed);
  assert.equal(sha(packed), item.gzip.sha256); assert.equal(sha(raw), item.raw.sha256);
  const records = raw.toString().trim().split("\n").map(line => JSON.parse(line));
  const result = analyze(raw.toString()), report = JSON.parse(toJsonReport(result));
  assert.equal(report.parse.complete, true); assert.equal(report.reports.length, 2);
  assert.deepEqual(report.usageComparison.rows.map(row => row.reportedInputTokens),
    item.provider === "openai" ? [12000, 12000] : [12000, 12400]);
  assert.deepEqual(report.usageComparison.rows.map(row => row.reportedReadTokens), [0, 400]);
  const unavailable = expectation === "after" && item.unmodeledMcp;
  for (const row of report.reports) {
    if (unavailable) {
      assert.equal(row.totals.openaiTokens, null); assert.equal(row.totals.claudeTokensEstimate, null);
      assert.equal(row.percentOfContextWindow, undefined);
      assert.ok(row.segments.some(segment => segment.unmodeledContext === "mcp_tools"));
    } else assert.ok(row.totals.claudeTokensEstimate > 1024);
  }
  if (unavailable) {
    for (const scenario of ["actual", "optimized"]) for (const step of report.cacheSimulation[scenario]) {
      assert.equal(step.readTokens, null); assert.equal(step.uncachedTokens, null);
      assert.equal(step.writeTokens5m, null); assert.equal(step.writeTokens1h, null);
      assert.equal(step.costUsd, undefined); assert.match(step.unavailableReason, /MCP tool context/);
    }
    for (const row of report.usageComparison.rows) {
      assert.equal(row.estimatedInputTokens, null); assert.equal(row.simulatedReadTokens, null);
      assert.equal(row.inputDeltaTokens, null); assert.equal(row.readDeltaTokens, null);
      assert.equal(row.readOutcome, "unavailable");
    }
    // Original connector/listing units remain exact in the in-memory inspector.
    for (let i = 0; i < records.length; i++) {
      const original = records[i].request;
      const parsed = result.parse.requests[i];
      assert.deepEqual(parsed.raw, original);
      const path = item.provider === "openai" ? "tools[0]" : "mcp_servers[0]";
      const server = parsed.segments.find(segment => segment.path === path);
      assert.deepEqual(server.raw, item.provider === "openai" ? original.tools[0] : original.mcp_servers[0]);
      const user = parsed.segments.find(segment => segment.category === "user" && segment.text.includes("Inspect the retained"));
      assert.ok(user.claudeTokensEstimate > 1024);
    }
  } else assert.ok(Number.isFinite(report.cacheSimulation.actual[1].costUsd));
  if (baseline && !item.unmodeledMcp) {
    assert.deepEqual(report, baseline.cases.find(row => row.name === item.name).report);
  }
  const capturePath = fileURLToPath(new URL("captures/" + item.file, import.meta.url));
  const flags = ["analyze", capturePath, "--json", resolve(output, item.name + ".json"),
    "--html", resolve(output, item.name + ".html"), "--fail-on", "warning"];
  const cli = spawnSync(process.execPath, [resolve(dist, "cli/index.js"), ...flags], {
    encoding: "utf8", timeout: 30000,
  });
  assert.equal(cli.status, unavailable ? 2 : 0, cli.stderr);
  assert.deepEqual(JSON.parse(readFileSync(resolve(output, item.name + ".json"))), report);
  const html = readFileSync(resolve(output, item.name + ".html"));
  if (unavailable) {
    assert.match(cli.stdout, /MCP tool context is not modeled/);
    assert.ok(html.includes(Buffer.from("MCP tool context is not modeled")));
    if (item.provider === "anthropic") {
      const calibration = spawnSync(process.execPath, [resolve(dist, "cli/index.js"), "analyze", capturePath, "--calibrate"], {
        encoding: "utf8", timeout: 30000, env: { ...process.env, ANTHROPIC_API_KEY: "" },
      });
      assert.equal(calibration.status, 1); assert.match(calibration.stderr, /unmodeled media or tool context/);
    }
  }
  cases.push({ name: item.name, inputSha256: sha(raw), report, cliExitCode: cli.status,
    htmlSha256: sha(html), unknownMcp: item.unmodeledMcp, provider: item.provider });
}
const receipt = { expectation, node: process.version, artifact: "caller-supplied dist", scope: capture.scope, cases,
  unsupportedFiniteEstimates: cases.filter(item => item.unknownMcp && item.report.reports.some(
    row => row.totals.openaiTokens !== null || row.totals.claudeTokensEstimate !== null)).length };
writeFileSync(resolve(output, "replay.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ expectation, node: process.version, captures: cases.length,
  unsupportedFiniteEstimates: receipt.unsupportedFiniteEstimates,
  unchangedControlsCompared: baseline ? cases.filter(item => !item.unknownMcp).length : 0 }));
