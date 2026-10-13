// Every destructive comparison uses disposable copies of the existing SDK fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [directory, executable, mode = 'after'] = process.argv.slice(2);
assert(directory && executable && ['before', 'after'].includes(mode), 'Usage: node replay.mjs NEW_DIRECTORY CLI_JS [before|after]');
const root = resolve(directory), cli = resolve(executable);
mkdirSync(root); // Refuse to reuse an existing directory.
const fixture = readFileSync(new URL('../../tests/fixtures/sdk/openai-cache-tool-output.jsonl.gz', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const fixtureHash = hash(fixture);
const cases = [];
const terminal = [];
function invoke(dir, args) {
  const result = spawnSync(process.execPath, [cli, 'analyze', 'requests.gz', ...args], { cwd: dir, encoding: 'utf8' });
  assert.ifError(result.error);
  return result;
}
function folder(name) {
  const dir = join(root, name); mkdirSync(dir);
  writeFileSync(join(dir, 'requests.gz'), fixture);
  return dir;
}
for (const format of ['json', 'html']) {
  for (const alias of ['direct', 'symlink', 'hardlink', 'parent-symlink']) {
    const dir = folder(`${format}-${alias}`);
    let output = 'requests.gz';
    if (alias === 'symlink') { output = 'alias'; symlinkSync('requests.gz', join(dir, output)); }
    if (alias === 'hardlink') { output = 'alias'; linkSync(join(dir, 'requests.gz'), join(dir, output)); }
    if (alias === 'parent-symlink') { symlinkSync('.', join(dir, 'parent')); output = 'parent/requests.gz'; }
    const args = [`--${format}`, output];
    const result = invoke(dir, args);
    const after = readFileSync(join(dir, 'requests.gz'));
    const preserved = fixture.equals(after);
    assert.equal(result.status, mode === 'before' ? 0 : 1);
    assert.equal(preserved, mode === 'after');
    assert(!readdirSync(dir).some(name => name.endsWith('.tmp')));
    if (mode === 'after') assert.equal(result.stdout, '');
    cases.push({ format, alias, exit: result.status, inputBytes: fixture.length, afterBytes: after.length,
      inputSha256: fixtureHash, afterSha256: hash(after), inputPreserved: preserved, stderr: result.stderr });
    if (alias === 'direct' && mode === 'after') terminal.push(`$ contextscope analyze requests.gz ${args.join(' ')}\n${result.stderr}exit: ${result.status}; original ${fixture.length} bytes unchanged\n`);
  }
}
for (const alias of ['new', 'existing', 'hardlink', 'parent-symlink']) {
  const dir = folder(`collision-${alias}`);
  let json = 'report';
  if (alias !== 'new') writeFileSync(join(dir, 'report'), 'previous report');
  if (alias === 'hardlink') { json = 'other'; linkSync(join(dir, 'report'), join(dir, json)); }
  if (alias === 'parent-symlink') { symlinkSync('.', join(dir, 'parent')); json = 'parent/report'; }
  const result = invoke(dir, ['--html', 'report', '--json', json]);
  assert.equal(result.status, mode === 'before' ? 0 : 1);
  assert.equal(hash(readFileSync(join(dir, 'requests.gz'))), fixtureHash);
  const outputExists = readdirSync(dir).includes('report');
  if (mode === 'after') {
    assert.equal(result.stdout, '');
    if (alias === 'new') assert.equal(outputExists, false);
    else assert.equal(readFileSync(join(dir, 'report'), 'utf8'), 'previous report');
  } else assert.equal(JSON.parse(readFileSync(join(dir, 'report'), 'utf8')).parse.requests.length, 3);
  cases.push({ collision: alias, exit: result.status, outputExists, stderr: result.stderr });
}
const dir = folder('safe');
writeFileSync(join(dir, 'report.html'), 'previous HTML'); writeFileSync(join(dir, 'report.json'), 'previous JSON');
const safe = invoke(dir, ['--html', 'report.html', '--json', 'report.json']);
assert.equal(safe.status, 0);
const json = readFileSync(join(dir, 'report.json'));
const html = readFileSync(join(dir, 'report.html'), 'utf8');
const parsed = JSON.parse(json);
assert.equal(parsed.parse.requests.length, 3);
assert.equal(hash(readFileSync(join(dir, 'requests.gz'))), fixtureHash);
assert.deepEqual(readdirSync(dir).sort(), ['report.html', 'report.json', 'requests.gz']);
const matches = html.match(/generated \d{4}-\d{2}-\d{2}T[\d:.]+Z/g);
assert.equal(matches?.length, 1);
const receipt = { node: process.version, mode, fixture: 'tests/fixtures/sdk/openai-cache-tool-output.jsonl.gz',
  fixtureSha256: fixtureHash, cases, safe: { exit: safe.status, requests: 3,
    jsonSha256: hash(json), htmlSha256: hash(html), htmlWithoutGenerationTimeSha256: hash(html.replace(matches[0], 'generated <timestamp>')),
    inputPreserved: true, temporaryFiles: 0 } };
writeFileSync(join(root, 'replay.json'), JSON.stringify(receipt, null, 2) + '\n');
if (mode === 'after') {
  terminal.push('$ contextscope analyze requests.gz --html report.html --json report.json\n' +
    `exit: ${safe.status}; both reports replaced; ${parsed.parse.requests.length} requests retained\n` +
    `original capture SHA-256: ${fixtureHash}\n`);
  writeFileSync(join(root, 'terminal.txt'), terminal.join('\n'));
}
console.log(JSON.stringify({ mode, cases: cases.length, safe: receipt.safe, script: fileURLToPath(import.meta.url) }));
