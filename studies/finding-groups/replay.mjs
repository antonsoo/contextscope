// Real CLI replay. Inputs are synthetic request bodies; no provider calls are made.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const [distArg, directoryArg, receiptArg, expectation] = process.argv.slice(2);
assert.ok(['before', 'after'].includes(expectation));
const dist = resolve(distArg), directory = resolve(directoryArg);
const study = dirname(fileURLToPath(import.meta.url));
const { analyze, groupFindings } = await import(pathToFileURL(resolve(dist, 'core/index.js')));
await mkdir(directory, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const base = (await readFile(resolve(study, 'fixtures/mixed-speed.jsonl.gz')));
const variants = gunzipSync(base).toString().trim().split('\n').slice(0, 3).map(line => JSON.parse(line));
const titles = ['Fast input pricing', 'Fast request modeled at standard speed', 'Speed pricing unavailable'];
const severities = ['info', 'info', 'warning'];
const cases = { 'hidden-warning': [0, 2], 'mixed-speed': [0, 1, 2, 0, 1, 2] };
for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
  cases['order-' + order.join('')] = [...order, ...order];
}
const records = [];
for (const [name, indexes] of Object.entries(cases)) {
  const input = indexes.map(index => JSON.stringify(variants[index])).join('\n') + '\n';
  await writeFile(resolve(directory, name + '.jsonl'), input);
  const analyzed = analyze(input);
  const groups = groupFindings(analyzed.findings).filter(group => group.kind === 'anthropic_speed');
  const expected = [...new Set(indexes)].map(index => ({ title: titles[index], severity: severities[index],
    requestIndices: indexes.flatMap((value, position) => value === index ? [position] : []) }));
  const found = groups.map(({ title, severity, requestIndices }) => ({ title, severity, requestIndices }));
  if (expectation === 'after') {
    assert.deepEqual([...found].sort((a, b) => a.title.localeCompare(b.title)),
      [...expected].sort((a, b) => a.title.localeCompare(b.title)));
  } else {
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, titles[indexes[0]]);
    assert.equal(groups[0].severity, severities[indexes[0]]);
    assert.deepEqual(groups[0].requestIndices, indexes.map((_, i) => i));
  }
  const command = [resolve(dist, 'cli/index.js'), 'analyze', name + '.jsonl',
    '--json', name + '.json', '--html', name + '.html', '--fail-on', 'warning'];
  const cli = spawnSync(process.execPath, command, { cwd: directory, encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }, timeout: 30000 });
  assert.equal(cli.status, 2, cli.stderr);
  assert.equal(cli.stderr, '');
  const json = await readFile(resolve(directory, name + '.json'));
  const html = await readFile(resolve(directory, name + '.html'));
  const raw = JSON.parse(json);
  assert.deepEqual(raw.findings, analyzed.findings);
  for (const group of found) {
    assert.ok(cli.stdout.includes(`[${group.severity}] ${group.title}`));
    assert.ok(html.toString().includes(`<strong>${group.title}</strong>`));
  }
  await writeFile(resolve(directory, name + '.txt'), cli.stdout);
  records.push({ name, indexes, inputSha256: sha(input), jsonSha256: sha(json), htmlSha256: sha(html),
    htmlWithoutGeneratedAtSha256: sha(html.toString().replace(/ · generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?=<\/p>)/, ' · generated <timestamp>')),
    terminalSha256: sha(cli.stdout), exitCode: cli.status, expected, displayed: found,
    rawSpeedFindings: raw.findings.filter(finding => finding.kind === 'anthropic_speed') });
}
await writeFile(receiptArg, JSON.stringify({ expectation, provenance: 'synthetic; no provider calls',
  node: process.version, records }, null, 2) + '\n');
console.log(JSON.stringify({ expectation, sequences: records.length,
  correctlyScopedMessages: records.reduce((sum, row) => sum + row.displayed.filter(group =>
    row.expected.some(expected => JSON.stringify(expected) === JSON.stringify(group))).length, 0),
  expectedMessages: records.reduce((sum, row) => sum + row.expected.length, 0) }));
