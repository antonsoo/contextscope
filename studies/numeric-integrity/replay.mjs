import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cases } from "./cases.mjs";
const [dist, output, mode = "verify"] = process.argv.slice(2);
assert.ok(["baseline", "verify"].includes(mode));
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(dist, "core/index.js")));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scratch = mkdtempSync(resolve(tmpdir(), "contextscope-numbers-"));
const results = [];
try {
  for (const entry of cases) {
    let result, error;
    try { result = analyze(entry.input); } catch (e) { error = e.message; }
    if (mode === "verify") {
      assert.equal(!!error, entry.rejected, entry.name);
      if (error) assert.match(error, /would be rounded/);
    }
    if (result && entry.equalPrompt !== undefined) {
      const texts = result.parse.requests.map((r) => r.segments[0].text);
      assert.equal(texts[0] === texts[1], entry.equalPrompt, entry.name);
      assert.equal(result.cacheSimulation.actual[1].readTokens > 0, entry.equalPrompt, entry.name);
    }
    const inputPath = resolve(scratch, `${entry.name}.jsonl`);
    const reportPath = resolve(scratch, `${entry.name}-report.json`);
    writeFileSync(inputPath, entry.input);
    const cli = spawnSync(process.execPath, [resolve(dist, "cli/index.js"), "analyze", inputPath, "--json", reportPath], { encoding: "utf8" });
    assert.ifError(cli.error);
    assert.equal(cli.status, error ? 1 : 0, entry.name);
    assert.equal(existsSync(reportPath), !error, entry.name);
    if (result) assert.deepEqual(JSON.parse(readFileSync(reportPath, "utf8")), JSON.parse(toJsonReport(result)));
    else assert.match(cli.stderr, /would be rounded/);
    results.push({
      name: entry.name, inputSha256: sha(entry.input), expectedRejection: entry.rejected,
      accepted: !!result, error,
      ...(result ? {
        complete: result.parse.complete,
        firstSegments: result.parse.requests.map((r) => r.segments[0].text),
        prefixMatches: result.prefixMatches,
        readTokens: result.cacheSimulation.actual.map((step) => step.readTokens),
        reportSha256: sha(toJsonReport(result)),
      } : {}),
      cli: { status: cli.status, reportWritten: existsSync(reportPath), stderr: cli.stderr.replaceAll(scratch, "[scratch]") },
    });
  }
  writeFileSync(output, JSON.stringify({ node: process.version, mode, results }, null, 2) + "\n");
  console.log(`${results.length} library and CLI workflows captured (${mode})`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
