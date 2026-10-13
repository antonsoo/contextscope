// Usage: node benchmark.mjs DIST CASE OUTPUT [REPEATS=3]
// Times duplicate review only, including shingling/indexing, not parsing/tokenization.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases, request } from './cases.mjs';

const [dist, name, out, repetitions = '3'] = process.argv.slice(2);
assert.ok(Object.hasOwn(cases, name));
const repeats = Number(repetitions);
assert.ok(Number.isInteger(repeats) && repeats > 0);
const { parseAnthropicRequest } = await import(pathToFileURL(resolve(dist, 'core/parse-anthropic.js')));
const { findDuplicates } = await import(pathToFileURL(resolve(dist, 'core/duplicates.js')));
const { estimateClaudeTokens } = await import(pathToFileURL(resolve(dist, 'core/tokenize-claude.js')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const raw = request(cases[name]()), input = JSON.stringify(raw);
const parsed = parseAnthropicRequest(raw, 0, text => ({ openai: 0, claude: estimateClaudeTokens(text) }));
const samples = [];
let groups, hash;
for (let i = 0; i < repeats; i++) {
  const start = performance.now();
  groups = findDuplicates([parsed]);
  const milliseconds = performance.now() - start;
  const current = sha(JSON.stringify(groups));
  if (i) assert.equal(current, hash);
  hash = current;
  samples.push(milliseconds);
}
const receipt = { name, constructed: true, node: process.version, inputBytes: Buffer.byteLength(input),
  inputSha256: sha(input), blocks: parsed.segments.length, samplesMs: samples,
  medianMs: [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)],
  processPeakRssKiB: process.resourceUsage().maxRSS, groups: groups.length,
  groupMembers: groups.map(g => g.members.length), outputSha256: hash };
await writeFile(out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
