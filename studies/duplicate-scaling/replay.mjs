// Actual CLI input -> report workflow; includes parsing, exact OpenAI tokenization,
// estimated Claude tokenization, all analyses and report generation.
// Usage: node replay.mjs DIST OUTPUT_DIRECTORY RECEIPT [CASE ...]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cases, request } from './cases.mjs';
import { withoutGenerationTime } from '../duplicate-evidence/html-content.mjs';

const [dist, output, receipt, ...selected] = process.argv.slice(2);
const names = selected.length ? selected : Object.keys(cases);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [];
await mkdir(output, { recursive: true });
for (const name of names) {
  const input = JSON.stringify(request(cases[name]()));
  const file = resolve(output, name + '.input.json'), json = resolve(output, name + '.json'), html = resolve(output, name + '.html');
  await writeFile(file, input);
  const start = performance.now();
  const child = spawnSync(process.execPath, [resolve(dist, 'cli/index.js'), 'analyze', file, '--json', json, '--html', html],
    { encoding: 'utf8', timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
  const milliseconds = performance.now() - start;
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  const jsonBytes = await readFile(json), htmlBytes = await readFile(html), report = JSON.parse(jsonBytes);
  const members = report.duplicates.map(g => g.members.length).sort((a, b) => a - b);
  const expected = name.startsWith('sparse') ? [] : name.startsWith('mixed') ? [2, 2] : name.startsWith('exact') ? [2000] : [250];
  assert.deepEqual(members, expected);
  rows.push({ name, inputBytes: Buffer.byteLength(input), inputSha256: sha(input), milliseconds, exitCode: child.status,
    jsonSha256: sha(jsonBytes), htmlSha256: sha(htmlBytes), htmlWithoutGeneratedAtSha256: sha(withoutGenerationTime(htmlBytes.toString())),
    groups: report.duplicates.map(({ members, ...group }) => ({ ...group, memberCount: members.length, membersSha256: sha(JSON.stringify(members)) })), stderr: child.stderr });
  console.log(JSON.stringify({ name, milliseconds, members }));
}
await writeFile(receipt, JSON.stringify({ node: process.version, timing: 'One end-to-end CLI run per constructed case, including process startup and both reports; not a statistical timing estimate.', results: rows }, null, 2) + '\n');
