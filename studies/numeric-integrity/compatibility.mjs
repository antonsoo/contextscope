import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
const [before, after, corpus, output] = process.argv.slice(2);
const oldRead = (await import(pathToFileURL(resolve(before, "dist/core/read-json.js")))).readJson;
const newRead = (await import(pathToFileURL(resolve(after, "dist/core/read-json.js")))).readJson;
const oldCore = await import(pathToFileURL(resolve(before, "dist/core/index.js")));
const newCore = await import(pathToFileURL(resolve(after, "dist/core/index.js")));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const examples = [], sources = [];
for (const file of readdirSync(resolve(after, "examples")).sort()) {
  const bytes = readFileSync(resolve(after, "examples", file));
  const text = (file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString();
  const previous = oldCore.toJsonReport(oldCore.analyze(text));
  const current = newCore.toJsonReport(newCore.analyze(text));
  assert.equal(current, previous, file);
  examples.push({ file, inputSha256: sha(bytes), reportSha256: sha(current) });
  oldCore.clearTokenCache(); newCore.clearTokenCache();
}
const rec = JSON.parse(readFileSync(resolve(corpus, "reconstruction.json")));
assert.equal(sha(readFileSync(resolve(after, "studies/real-trajectories/manifest.json"))), rec.manifestSha256);
let requests = 0, unchanged = 0;
for (const source of rec.sources) {
  const original = readFileSync(resolve(after, "studies/real-trajectories/cache", source.entry, source.file));
  assert.equal(sha(original), source.sourceSha256);
  const raw = gunzipSync(readFileSync(resolve(corpus, "bodies", source.entry, source.file.replace(".traj.json", ".jsonl.gz"))));
  assert.equal(sha(raw), source.requestsSha256);
  const lines = raw.toString().trim().split("\n").slice(1);
  assert.equal(lines.length, source.requests);
  const failures = [];
  for (const [i, line] of lines.entries()) {
    requests++;
    const previous = JSON.stringify(oldRead(line));
    try {
      assert.equal(JSON.stringify(newRead(line)), previous);
      unchanged++;
    } catch (e) { failures.push({ request: i, error: e.message.slice(0, 300) }); }
  }
  sources.push({ ...source, unchanged: lines.length - failures.length, failures });
  if (sources.length % 40 === 0) console.log(`${sources.length} verified trajectories, ${requests} request records`);
}
writeFileSync(output, JSON.stringify({ node: process.version, manifestSha256: rec.manifestSha256, examples, requests, unchanged, sources }, null, 2) + "\n");
console.log(`${examples.length} complete example reports unchanged; ${unchanged}/${requests} reconstructed request records unchanged`);
assert.equal(requests, unchanged);
