// node studies/stored-context/check-installed.mjs CONSUMER_DIR OUT_DIR NODE20_BINARY
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
  for (const name of ["previous-response-change", "item-reference-only", "reported-usage"]) {
    const json = resolve(output, `installed-${runtime}-${name}.json`), html = resolve(output, `installed-${runtime}-${name}.html`);
    const result = run(["analyze", `studies/stored-context/captures/${name}.jsonl.gz`, "--verbose", "--json", json, "--html", html]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(json)), evidence.cases.find(c => c.name === name).report);
    assert(!readFileSync(json, "utf8").includes("resp_controlled_"));
    writeFileSync(resolve(output, `installed-${runtime}-${name}.log`), result.stdout + result.stderr);
    reports.push({ name, exitCode: 0, jsonSha256: hash(readFileSync(json)), htmlSha256: hash(readFileSync(html)) });
  }
  const warning = run(["analyze", "studies/stored-context/captures/previous-response-change.jsonl.gz", "--fail-on", "warning"]);
  assert.equal(warning.status, 2);
  const refusedJson = resolve(output, `refusal-${runtime}.json`);
  writeFileSync(refusedJson, "previous report");
  const refused = run(["analyze", "studies/stored-context/captures/invalid-mutual-state.jsonl.gz", "--json", refusedJson]);
  assert.equal(refused.status, 1); assert.match(refused.stderr, /cannot combine/);
  assert(!/\n\s+at /.test(refused.stderr)); assert.equal(readFileSync(refusedJson, "utf8"), "previous report");
  writeFileSync(resolve(output, `refusal-${runtime}.log`), refused.stdout + refused.stderr);
  const plainJson = resolve(output, `control-${runtime}.json`);
  const plain = run(["analyze", "studies/stored-context/captures/literal-control.jsonl.gz", "--json", plainJson]);
  assert.equal(plain.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(plainJson)), evidence.cases.find(c => c.name === "literal-control").report);
  receipt.push({ runtime: spawnSync(node, ["--version"], { encoding: "utf8" }).stdout.trim(), executableBinWorks: true,
    replayWorkflows: 22, reports, warningGateExit: 2, refusalExit: 1,
    refusedOutputPreserved: true, textControlMatchesSource: true });
}
writeFileSync(resolve(output, "installed-cli-checks.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt.map(r => ({ runtime: r.runtime, reports: r.reports.length, replayWorkflows: r.replayWorkflows, binWorks: r.executableBinWorks }))));
