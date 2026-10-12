// Full reports, including token counts and cache simulation; no counter bypass.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
const [before, after, corpus, output] = process.argv.slice(2);
const oldCore = await import(pathToFileURL(resolve(before, "dist/core/index.js")));
const newCore = await import(pathToFileURL(resolve(after, "dist/core/index.js")));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const examples = [], sources = [];
function compare(text) {
  let previous, current, beforeError, afterError;
  try { previous = oldCore.toJsonReport(oldCore.analyze(text)); } catch (e) { beforeError = e.message; }
  try { current = newCore.toJsonReport(newCore.analyze(text)); } catch (e) { afterError = e.message; }
  assert.equal(afterError, undefined, afterError);
  if (!beforeError) assert.equal(current, previous);
  oldCore.clearTokenCache(); newCore.clearTokenCache();
  return { beforeError, beforeSha256: previous ? sha(previous) : undefined, afterSha256: sha(current), unchanged: previous === current };
}
for (const file of readdirSync(resolve(after, "examples")).sort()) {
  const bytes = readFileSync(resolve(after, "examples", file));
  examples.push({ file, inputSha256: sha(bytes), ...compare((file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString()) });
}
console.log(`${examples.length} complete example reports compared`);
const rec = JSON.parse(readFileSync(resolve(corpus, "reconstruction.json")));
assert.equal(sha(readFileSync(resolve(after, "studies/real-trajectories/manifest.json"))), rec.manifestSha256);
for (const source of rec.sources) {
  assert.equal(sha(readFileSync(resolve(after, "studies/real-trajectories/cache", source.entry, source.file))), source.sourceSha256);
  const raw = gunzipSync(readFileSync(resolve(corpus, "bodies", source.entry, source.file.replace(".traj.json", ".jsonl.gz"))));
  assert.equal(sha(raw), source.requestsSha256);
  const records = raw.toString().trim().split("\n").slice(1).map((line) => JSON.parse(line));
  assert.equal(records.length, source.requests);
  // Reconstructed harness envelopes include usage bookkeeping; body is the
  // actual serialized request. Compare complete analyses of each trajectory.
  sources.push({ ...source, ...compare(records.map((r) => JSON.stringify(r.body)).join("\n")) });
  if (sources.length % 10 === 0) console.log(`${sources.length}/${rec.sources.length} complete trajectories compared`);
}
const result = { node: process.version, manifestSha256: rec.manifestSha256, examples,
  trajectories: sources.length, requests: sources.reduce((n, s) => n + s.requests, 0),
  unchanged: sources.filter((s) => s.unchanged).length, sources };
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(`${result.unchanged}/${result.trajectories} trajectory reports unchanged (${result.requests} requests)`);
