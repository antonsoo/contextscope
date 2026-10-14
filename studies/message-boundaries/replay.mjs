import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { getEncoding } from "js-tiktoken";

const [distArg, output, mode = "verify"] = process.argv.slice(2);
assert.ok(distArg && output && ["verify", "baseline"].includes(mode), "replay.mjs DIST OUTPUT [baseline|verify]");
const dist = resolve(distArg);
const study = dirname(fileURLToPath(import.meta.url));
const catalogue = JSON.parse(readFileSync(resolve(study, "fixtures/cases.json"), "utf8"));
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(dist, "core/index.js")));
const tokenizer = getEncoding("o200k_base");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const work = mkdtempSync(resolve(tmpdir(), "contextscope-history-"));
const cli = resolve(dist, "cli/index.js");
const records = [];

function execute(id, bytes) {
  const input = resolve(work, id + ".jsonl.gz");
  const report = resolve(work, id + "-report.json");
  writeFileSync(input, bytes);
  const processResult = spawnSync(process.execPath, [cli, "analyze", input, "--json", report], { encoding: "utf8" });
  assert.ifError(processResult.error);
  assert.equal(processResult.status, 0, id + ": CLI should accept the supplied capture");
  const library = analyze(gunzipSync(bytes).toString("utf8"));
  assert.deepEqual(JSON.parse(readFileSync(report, "utf8")), JSON.parse(toJsonReport(library)), id);
  assert.ok(readFileSync(input).equals(bytes), id + ": input bytes changed");
  return { library, cli: { exitCode: processResult.status, stdout: processResult.stdout.replaceAll(work, "<work>"), stderr: processResult.stderr.replaceAll(work, "<work>"), reportSha256: sha(readFileSync(report)), inputUnchanged: true } };
}

try {
  for (const capture of catalogue.cases) {
    const bytes = readFileSync(resolve(study, "fixtures", capture.file));
    assert.equal(sha(bytes), capture.gzipSha256);
    assert.equal(sha(gunzipSync(bytes)), capture.rawSha256);
    const { library, cli } = execute(capture.id, bytes);
    const requests = library.parse.requests;
    const match = library.prefixMatches[0];
    const second = requests[1];
    const required = second.segments.find(s => s.path === capture.requiredSegmentPath);
    const textCounts = requests.flatMap(request => request.segments.filter(s => s.label.includes("refusal")).map(s => {
      const original = typeof s.raw?.refusal === "string" ? s.raw.refusal : s.text;
      return { path: s.path, actual: s.openaiTokens, independentTextCount: tokenizer.encode(original).length, textUnchanged: s.text === original };
    }));
    const agrees = !!required && match.matchedSegments === capture.expectedMatchedSegments
      && textCounts.every(row => row.actual === row.independentTextCount && row.textUnchanged)
      && library.parse.complete && !library.parse.warnings.length
      && (capture.changed ? library.cacheSimulation.actual[1].readTokens === 0 : match.matchedSegments === second.segments.length);
    if (mode === "verify") assert.ok(agrees, capture.id);
    records.push({ id: capture.id, nativeSdkCapture: true, provenance: capture.provenance,
      inputSha256: sha(bytes), rawSha256: capture.rawSha256,
      expected: { requiredSegmentPath: capture.requiredSegmentPath, matchedSegments: capture.expectedMatchedSegments, changed: capture.changed },
      observed: { complete: library.parse.complete, warnings: library.parse.warnings,
        sourcePaths: requests.map(r => r.segments.map(s => s.path)),
        matchedSegments: match.matchedSegments, secondSegments: second.segments.length,
        matchedOpenaiTokens: match.matchedOpenaiTokens, readTokens: library.cacheSimulation.actual.map(s => s.readTokens),
        textCounts, sourceUnit: required ? { path: required.path, textSha256: sha(required.text), textChars: required.text.length, openaiTokens: required.openaiTokens } : null },
      cli, agrees });
  }
  const nativeRoot = resolve(study, "../../tests/fixtures/sdk");
  for (const file of readdirSync(nativeRoot).filter(name => name.endsWith(".jsonl.gz")).sort()) {
    const bytes = readFileSync(resolve(nativeRoot, file));
    const { library, cli } = execute("native-" + file, bytes);
    records.push({ id: "native-" + file, unmodifiedExistingSdkFixture: true, inputSha256: sha(bytes),
      requests: library.parse.requests.length, complete: library.parse.complete, cli, agrees: true });
  }
  const record = { node: process.version, mode, sdk: catalogue.sdk, population: catalogue.population,
    count: records.length, disagreements: records.filter(r => !r.agrees).length, cases: records };
  writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
  console.log(`${record.count} actual CLI/library workflows; ${record.disagreements} disagreements (${mode}).`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
