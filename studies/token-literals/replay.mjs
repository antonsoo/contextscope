import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cases, oracleTexts } from "./cases.mjs";
const [root, output, mode = "verify", python] = process.argv.slice(2);
assert.ok(root && output && ["verify", "baseline"].includes(mode));
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(root, "dist/core/index.js")));
const { countOpenaiTokens } = await import(pathToFileURL(resolve(root, "dist/core/tokenize-openai.js")));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const temporary = mkdtempSync(resolve(tmpdir(), "contextscope-delimiters-"));
const rows = [], texts = [...oracleTexts], counts = [];
try {
  for (const c of cases) {
    let result, error;
    try { result = analyze(c.input); } catch (e) { error = e.message; }
    if (mode === "verify") assert.equal(!!error, c.reject, c.name);
    if (result) {
      assert.equal(result.parse.complete, true, c.name);
      for (const r of result.parse.requests) for (const s of r.segments) {
        texts.push(s.text); counts.push({ name: c.name, index: texts.length - 1, tokens: countOpenaiTokens(s.text), segmentTokens: s.openaiTokens, framingTokens: r.provider === "openai" && /^messages\[\d+\]\.content$/.test(s.path) ? 5 : 0 });
      }
      if (c.name === "cache-threshold") assert.ok(result.cacheSimulation.actual[1].readTokens >= 1024);
    }
    const path = resolve(temporary, c.name + ".jsonl"), json = resolve(temporary, c.name + ".json"), html = resolve(temporary, c.name + ".html");
    writeFileSync(path, c.input);
    const cli = spawnSync(process.execPath, [resolve(root, "dist/cli/index.js"), "analyze", path, "--json", json, "--html", html], { encoding: "utf8", timeout: 30_000 });
    assert.ifError(cli.error);
    assert.equal(cli.status, error ? 1 : 0, c.name);
    assert.equal(existsSync(json), !!result); assert.equal(existsSync(html), !!result);
    if (result) assert.deepEqual(JSON.parse(readFileSync(json)), JSON.parse(toJsonReport(result)), c.name);
    rows.push({ name: c.name, expectedRejection: c.reject, accepted: !!result, error,
      inputSha256: sha(c.input), sourceRecords: result?.parse.sourceRecords,
      ...(result ? { reportSha256: sha(toJsonReport(result)), segmentTextSha256: sha(JSON.stringify(result.parse.requests.map((r) => r.segments.map((s) => s.text)))),
        tokens: result.parse.requests.map((r) => r.segments.map((s) => s.openaiTokens)),
        readTokens: result.cacheSimulation.actual.map((s) => s.readTokens) } : {}), cli: { status: cli.status, json: existsSync(json), html: existsSync(html) } });
  }
  const direct = oracleTexts.map((text, index) => {
    try { return { index, tokens: countOpenaiTokens(text) }; } catch (e) { return { index, error: e.message }; }
  });
  let oracle;
  if (python) {
    const native = spawnSync(python, [fileURLToPath(new URL("./oracle.py", import.meta.url))], { input: JSON.stringify(texts), encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
    assert.ifError(native.error); assert.equal(native.status, 0, native.stderr);
    oracle = JSON.parse(native.stdout);
    for (const row of [...direct, ...counts]) if (row.tokens !== undefined) assert.equal(row.tokens, oracle.rows[row.index].tokens, row.name ?? row.index);
    for (const c of counts) assert.equal(c.segmentTokens, c.tokens + c.framingTokens, c.name);
    if (mode === "verify") assert.ok(direct.every((r) => r.tokens !== undefined));
  }
  writeFileSync(output, JSON.stringify({ node: process.version, mode, cases: rows.length,
    accepted: rows.filter((r) => r.accepted).length, validCases: cases.filter((r) => !r.reject).length,
    expectedOutcomes: rows.filter((r) => r.accepted !== r.expectedRejection).length,
    direct, checkedSegments: counts.length, oracle, rows }, null, 2) + "\n");
  console.log(`${rows.filter((r) => r.accepted).length}/${cases.filter((r) => !r.reject).length} valid workflows accepted; ${counts.length} segments, ${direct.length} direct probes; CLI JSON/HTML verified`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
