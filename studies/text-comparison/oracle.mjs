// Node 24+: imports the browser's TypeScript helper using native type stripping.
// Reconstructs both complete inputs from displayed rows plus omitted source
// intervals. It does not use jsdiff to decide whether a preview is faithful.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, corpus, out] = process.argv.slice(2);
const { compareText, textDownload } = await import(pathToFileURL(resolve(root, 'web/src/lib/text-comparison.ts')));
const { parseAnthropicRequest } = await import(pathToFileURL(resolve(root, 'dist/core/parse-anthropic.js')));
const { findDuplicates } = await import(pathToFileURL(resolve(root, 'dist/core/duplicates.js')));
const { estimateClaudeTokens } = await import(pathToFileURL(resolve(root, 'dist/core/tokenize-claude.js')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function verify(first, second, result) {
  if (result.kind === 'identical') { assert.equal(first, second); return; }
  assert.notEqual(first, second);
  if (result.kind === 'limited') return;
  const a = first.split(/(?<=\n)/).filter(s => s.length), b = second.split(/(?<=\n)/).filter(s => s.length);
  let oldLine = 0, newLine = 0, oldText = '', newText = '', removed = 0, added = 0;
  for (const row of result.rows) {
    if (row.kind === 'omitted') {
      assert.ok(row.count > 0);
      const left = a.slice(oldLine, oldLine + row.count).join(''), right = b.slice(newLine, newLine + row.count).join('');
      assert.equal(left, right); oldText += left; newText += right; oldLine += row.count; newLine += row.count;
    } else {
      const raw = row.text + ({ LF: '\n', CRLF: '\r\n', none: '' })[row.ending];
      if (row.kind !== 'added') { assert.equal(row.firstLine, ++oldLine); oldText += raw; }
      else { assert.equal(row.firstLine, null); added++; }
      if (row.kind !== 'removed') { assert.equal(row.secondLine, ++newLine); newText += raw; }
      else { assert.equal(row.secondLine, null); removed++; }
    }
  }
  assert.equal(oldText, first); assert.equal(newText, second);
  assert.equal(removed, result.removedLines); assert.equal(added, result.addedLines);
}
let seed = 20261013;
const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
const generated = [];
for (let i = 0; i < 400; i++) {
  const a = Array.from({ length: 20 + random(100) }, (_, j) => `record ${j}: value ${random(15)}${j % 17 === 0 ? '\t😀' : ''}`);
  const b = [...a];
  for (let j = random(12); j > 0; j--) {
    const at = random(b.length + 1);
    if (j % 3 === 0) b.splice(at, 1);
    else if (j % 3 === 1) b.splice(at, 0, `inserted ${j} <&> \u0000`);
    else if (at < b.length) b[at] += ' changed';
  }
  const first = a.join(i % 4 ? '\n' : '\r\n'), second = b.join(i % 5 ? '\n' : '\r\n') + (i % 7 ? '' : '\n');
  const result = compareText(first, second); verify(first, second, result);
  for (const text of [first, second, first + '\ud800']) {
    const exported = textDownload(text);
    assert.equal(exported.extension === 'txt' ? Buffer.from(exported.content).toString() : JSON.parse(exported.content), text);
  }
  generated.push({ case: i, kind: result.kind, ...(result.kind === 'limited' ? { reason: result.reason } : {}), previewSha256: sha(JSON.stringify(result)), firstSha256: sha(JSON.stringify(first)), secondSha256: sha(JSON.stringify(second)) });
}
const reconstruction = JSON.parse(await readFile(resolve(corpus, 'reconstruction.json')));
assert.equal(sha(await readFile(resolve(root, 'studies/real-trajectories/manifest.json'))), reconstruction.manifestSha256);
const totals = { snapshots: 0, groups: 0, pairs: 0, identical: 0, diff: 0, limited: 0 }, sources = [], limited = [];
for (const entry of reconstruction.sources) {
  assert.equal(sha(await readFile(resolve(root, 'studies/real-trajectories/cache', entry.entry, entry.file))), entry.sourceSha256);
  const bytes = gunzipSync(await readFile(resolve(corpus, 'bodies', entry.entry, entry.file.replace('.traj.json', '.jsonl.gz'))));
  assert.equal(sha(bytes), entry.requestsSha256);
  const record = JSON.parse(bytes.toString().trim().split('\n').at(-1));
  const parsed = parseAnthropicRequest(record.body, 0, text => ({ openai: 0, claude: estimateClaudeTokens(text) }));
  const groups = findDuplicates([parsed]), byId = new Map(parsed.segments.map(s => [s.id, s]));
  const checks = [];
  for (const group of groups) for (const member of group.members.slice(1)) {
    const first = byId.get(group.members[0].segmentId), second = byId.get(member.segmentId);
    const result = compareText(first.text, second.text); verify(first.text, second.text, result);
    totals.pairs++; totals[result.kind]++;
    if (result.kind === 'limited') limited.push({ entry: entry.entry, file: entry.file, first: first.id, second: second.id, reason: result.reason, characters: first.text.length + second.text.length });
    checks.push({ first: first.id, second: second.id, kind: result.kind, previewSha256: sha(JSON.stringify(result)) });
  }
  totals.snapshots++; totals.groups += groups.length;
  sources.push({ entry: entry.entry, file: entry.file, sourceSha256: entry.sourceSha256, requestsSha256: entry.requestsSha256, pairs: checks.length, checksSha256: sha(JSON.stringify(checks)) });
}
await writeFile(out, JSON.stringify({ node: process.version, seed: 20261013, generated, totals, limited, sources,
  note: 'Every completed preview reconstructs both literal source strings; omitted intervals are independently checked equal. No optimal edit-script or semantic-removability claim. All first-to-other pairs are checked, including members beyond the browser first-20 controls.' }, null, 2) + '\n');
console.log(JSON.stringify({ generated: generated.length, generatedLimited: generated.filter(r => r.kind === 'limited').length, totals, limited }));
