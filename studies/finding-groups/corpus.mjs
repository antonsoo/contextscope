// Compare only the changed grouping operation on freshly analyzed public inputs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
const [before, after, corpus, output] = process.argv.slice(2);
const oldCore = await import(pathToFileURL(resolve(before, 'dist/core/index.js')));
const newCore = await import(pathToFileURL(resolve(after, 'dist/core/index.js')));
const sha = data => createHash('sha256').update(data).digest('hex');
const compare = text => {
  const result = newCore.analyze(text);
  const previous = oldCore.groupFindings(result.findings);
  const current = newCore.groupFindings(result.findings);
  assert.deepEqual(current, previous);
  newCore.clearTokenCache();
  return { requests: result.parse.requests.length, findings: result.findings.length,
    groups: current.length, groupSha256: sha(JSON.stringify(current)), unchanged: true };
};
const examples = readdirSync(resolve(after, 'examples')).sort().map(file => {
  const bytes = readFileSync(resolve(after, 'examples', file));
  const raw = file.endsWith('.gz') ? gunzipSync(bytes) : bytes;
  return { file, inputSha256: sha(bytes), ...compare(raw.toString()) };
});
const reconstruction = JSON.parse(readFileSync(resolve(corpus, 'reconstruction.json')));
assert.equal(sha(readFileSync(resolve(after, 'studies/real-trajectories/manifest.json'))), reconstruction.manifestSha256);
const sources = [];
for (const source of reconstruction.sources) {
  assert.equal(sha(readFileSync(resolve(after, 'studies/real-trajectories/cache', source.entry, source.file))), source.sourceSha256);
  const raw = gunzipSync(readFileSync(resolve(corpus, 'bodies', source.entry, source.file.replace('.traj.json', '.jsonl.gz'))));
  assert.equal(sha(raw), source.requestsSha256);
  const records = raw.toString().trim().split('\n').slice(1).map(line => JSON.parse(line));
  assert.equal(records.length, source.requests);
  const comparison = compare(records.map(record => JSON.stringify(record.body)).join('\n'));
  assert.equal(comparison.requests, source.requests);
  sources.push({ ...source, ...comparison });
  if (sources.length % 20 === 0) console.log(`${sources.length}/${reconstruction.sources.length} grouped reports unchanged`);
}
const result = { node: process.version, manifestSha256: reconstruction.manifestSha256, examples,
  trajectories: sources.length, requests: sources.reduce((sum, source) => sum + source.requests, 0), sources };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ trajectories: result.trajectories, requests: result.requests, examples: examples.length }));
