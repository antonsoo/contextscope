// Actual CLI reports must remain unchanged by browser-only review controls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cases } from './cases.mjs';
import { withoutGenerationTime } from '../duplicate-evidence/html-content.mjs';

const [dist, output, receipt] = process.argv.slice(2);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
await mkdir(output, { recursive: true });
for (const [name, value] of Object.entries(cases)) {
  const input = JSON.stringify(value), file = resolve(output, name + '.input.json');
  const json = resolve(output, name + '.json'), html = resolve(output, name + '.html');
  await writeFile(file, input);
  const child = spawnSync(process.execPath, [resolve(dist, 'cli/index.js'), 'analyze', file, '--json', json, '--html', html],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  const jsonBytes = await readFile(json), htmlBytes = await readFile(html);
  assert.equal(JSON.parse(jsonBytes).duplicates.length, 1);
  results.push({ name, inputBytes: Buffer.byteLength(input), inputSha256: sha(input), exitCode: child.status,
    jsonSha256: sha(jsonBytes), htmlWithoutGeneratedAtSha256: sha(withoutGenerationTime(htmlBytes.toString())), stderr: child.stderr });
}
await writeFile(receipt, JSON.stringify({ node: process.version, results }, null, 2) + '\n');
console.log(`Verified ${results.length} complete CLI JSON/HTML exports.`);
