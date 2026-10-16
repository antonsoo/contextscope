// node studies/media-accounting/check-installed.mjs CONSUMER_DIR OUT_DIR NODE20_BINARY
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [consumer, output, node20] = process.argv.slice(2);
const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = JSON.parse(readFileSync(new URL("./results/after.json", import.meta.url)));
const bin = resolve(consumer, "node_modules/.bin/contextscope");
const dist = resolve(consumer, "node_modules/@antonsoloviev/contextscope/dist");
const hash = data => createHash("sha256").update(data).digest("hex");
const receipt = [];
for (const [runtime, node] of [["node24", process.execPath], ["node20", node20]]) {
  const env = { ...process.env, PATH: dirname(node) + ":" + process.env.PATH, ANTHROPIC_API_KEY: "" };
  const run = args => spawnSync(bin, args, { cwd: root, env, encoding: "utf8" });
  const version = run(["--version"]); assert.equal(version.status, 0); assert.match(version.stdout, /0\.3\.3/);
  const replay = spawnSync(node, [fileURLToPath(new URL("./replay.mjs", import.meta.url)), resolve(output, `installed-${runtime}.json`), dist, "--verify"], { cwd: root, encoding: "utf8" });
  assert.equal(replay.status, 0, replay.stderr);
  const reports = [];
  for (const name of ["anthropic-image-transports", "chat-image-transports", "responses-reported-usage"]) {
    const json = resolve(output, `installed-${runtime}-${name}.json`), html = resolve(output, `installed-${runtime}-${name}.html`);
    const result = run(["analyze", `studies/media-accounting/captures/${name}.jsonl.gz`, "--verbose", "--json", json, "--html", html]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(json)), evidence.cases.find(c => c.name === name).report);
    assert(!readFileSync(json, "utf8").includes("iVBORw0KGgo"));
    writeFileSync(resolve(output, `installed-${runtime}-${name}.log`), result.stdout + result.stderr);
    reports.push({ name, exitCode: 0, jsonSha256: hash(readFileSync(json)), htmlSha256: hash(readFileSync(html)) });
  }
  const warning = run(["analyze", "studies/media-accounting/captures/anthropic-image-transports.jsonl.gz", "--fail-on", "warning"]);
  assert.equal(warning.status, 2);
  const calJson = resolve(output, `calibration-${runtime}.json`);
  writeFileSync(calJson, "previous report");
  const cal = run(["analyze", "studies/media-accounting/captures/anthropic-image-transports.jsonl.gz", "--calibrate", "--json", calJson]);
  assert.equal(cal.status, 1); assert.match(cal.stderr, /media/i);
  assert(!/\n\s+at /.test(cal.stderr)); assert.equal(readFileSync(calJson, "utf8"), "previous report");
  writeFileSync(resolve(output, `calibration-${runtime}.log`), cal.stdout + cal.stderr);
  const plainJson = resolve(output, `control-${runtime}.json`);
  const plain = run(["analyze", "studies/media-accounting/captures/anthropic-literal-control.jsonl.gz", "--json", plainJson]);
  assert.equal(plain.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(plainJson)), evidence.cases.find(c => c.name === "anthropic-literal-control").report);
  receipt.push({ runtime: spawnSync(node, ["--version"], { encoding: "utf8" }).stdout.trim(), executableBinWorks: true,
    replayWorkflows: 17, reports, warningGateExit: 2, calibrationExit: 1,
    calibrationOutputPreserved: true, textControlMatchesSource: true });
}
writeFileSync(resolve(output, "installed-cli-checks.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt.map(r => ({ runtime: r.runtime, reports: r.reports.length, replayWorkflows: r.replayWorkflows, binWorks: r.executableBinWorks }))));
