// Native SDK inputs, production assets and actual offline downloads in both builds.
/* global window, document, Worker, innerWidth, structuredClone */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { chromium, firefox, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const [beforeArg, afterArg, outArg] = process.argv.slice(2);
assert(beforeArg && afterArg && outArg, 'Expected BEFORE_DIST AFTER_DIST OUTPUT');
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..'), out = resolve(outArg);
const fixtureRoot = resolve(here, '../message-boundaries/fixtures');
const catalogue = JSON.parse(await readFile(resolve(fixtureRoot, 'cases.json'), 'utf8'));
const cases = ['chat-refusal-changed', 'responses-empty-role', 'chat-empty-role', 'responses-empty-output-phase'].map(id => catalogue.cases.find(item => item.id === id));
const images = resolve(repo, 'docs/assets/first-offline');
await mkdir(out, { recursive: true }); await mkdir(resolve(out, 'artifacts'), { recursive: true }); await mkdir(images, { recursive: true });
const sha = raw => createHash('sha256').update(raw).digest('hex');
async function retain(raw, extension) {
  const ref = `artifacts/${sha(raw)}.${extension}`;
  await writeFile(resolve(out, ref), raw);
  return { file: ref, bytes: Buffer.byteLength(raw), sha256: sha(raw) };
}
const control = {};
const work = await mkdtemp(resolve('/tmp', 'contextscope-offline-oracle-'));
for (const item of cases) {
  const path = resolve(fixtureRoot, item.file), raw = await readFile(path);
  assert.equal(sha(raw), item.gzipSha256); assert.equal(sha(gunzipSync(raw)), item.rawSha256);
  const report = resolve(work, item.id + '.json');
  const process = spawnSync(globalThis.process.execPath, [resolve(beforeArg, '../../dist/cli/index.js'), 'analyze', path, '--json', report], { cwd: repo, encoding: 'utf8', timeout: 30000 });
  assert.equal(process.status, 0, process.stderr);
  control[item.id] = { expected: JSON.parse(await readFile(report, 'utf8')), console: { exit: process.status, stdout: process.stdout, stderr: process.stderr }, input: { gzipSha256: item.gzipSha256, rawSha256: item.rawSha256 } };
}
const views = [], records = [];
async function downloaded(page, name) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFile(await (await pending).path(), 'utf8');
}
async function input(page, item, name = item.file) {
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/gzip', buffer: await readFile(resolve(fixtureRoot, item.file)) });
  await page.waitForFunction(() => !document.querySelector('#load-status') || document.querySelector('#load-status').hidden);
  await page.waitForFunction(() => !!document.querySelector('#intake-error')?.textContent || document.querySelector('#dashboard.shown'));
  return { error: await page.locator('#intake-error').textContent(), shown: await page.locator('#dashboard').evaluate(node => node.classList.contains('shown')) };
}
for (const [phase, arg] of [['before', beforeArg], ['after', afterArg]]) {
  const dist = resolve(arg);
  for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
    const browser = await launcher.launch();
    try {
      for (const width of [1440, 375]) {
        const served = {}, received = {}, pending = [], failed = [], late = [], external = [], errors = [];
        let disconnected = false, closed = false;
        const server = createServer((request, response) => void (async () => {
          const name = new URL(request.url, 'http://localhost').pathname.replace(/^\/contextscope\//, '') || 'index.html';
          const path = resolve(dist, name);
          if (!path.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
          try {
            const raw = await readFile(path); served[name] = { bytes: raw.length, sha256: sha(raw) };
            response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream' }).end(raw);
          } catch { response.writeHead(404).end(); }
        })());
        await new Promise(done => server.listen(0, '127.0.0.1', done));
        const origin = `http://127.0.0.1:${server.address().port}`;
        const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: width === 1440 ? 'dark' : 'light', reducedMotion: 'reduce' });
        const stop = async () => { if (!closed) { closed = true; server.closeAllConnections(); await new Promise(done => server.close(done)); } };
        try {
          const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
          page.on('requestfailed', request => failed.push(request.url().replace(origin, 'loopback')));
          context.on('request', request => {
            if (!/^https?:/.test(request.url())) return;
            if (!request.url().startsWith(origin)) external.push(request.url());
            if (disconnected) late.push(request.url().replace(origin, 'loopback'));
          });
          context.on('response', response => {
            if (!response.url().startsWith(origin)) return;
            pending.push((async () => {
              const name = new URL(response.url()).pathname.replace(/^\/contextscope\//, '') || 'index.html';
              const bytes = await response.body(); assert.equal(sha(bytes), sha(await readFile(resolve(dist, name))));
              received[name] = { bytes: bytes.length, sha256: sha(bytes) };
            })());
          });
          await page.addInitScript(() => {
            window.workerAudit = { created: 0, terminated: 0, active: 0, posts: 0, ready: 0, started: 0, urls: 0, revoked: 0 };
            window.policyViolations = [];
            document.addEventListener('securitypolicyviolation', event => window.policyViolations.push(event.violatedDirective));
            const audit = window.workerAudit, Original = Worker, urls = new Set();
            const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
            URL.createObjectURL = blob => { const url = create(blob); if (blob.type === 'text/javascript') { audit.urls++; urls.add(url); } return url; };
            URL.revokeObjectURL = url => { if (urls.delete(url)) audit.revoked++; revoke(url); };
            window.Worker = class extends Original {
              constructor(url, options) { super(url, options); audit.created++; audit.active++; this.done = false;
                this.addEventListener('message', event => { if (event.data?.type === 'ready') audit.ready++; if (event.data?.type === 'started') audit.started++; }); }
              postMessage(message) { audit.posts++; super.postMessage(message); }
              terminate() { if (!this.done) { this.done = true; audit.terminated++; audit.active--; } super.terminate(); }
            };
          });
          const started = Date.now();
          await page.goto(origin + '/contextscope/'); await page.locator('#pick-file-btn').waitFor(); await page.evaluate(() => document.fonts.ready);
          const readyMs = Date.now() - started;
          const startup = await page.evaluate(() => ({ ...window.workerAudit }));
          if (phase === 'after') assert.deepEqual(startup, { created: 1, terminated: 1, active: 0, posts: 0, ready: 1, started: 0, urls: 1, revoked: 1 });
          await Promise.all(pending);
          const initialAssets = structuredClone(received);
          await context.setOffline(true); disconnected = true;
          if (phase === 'after') await stop();
          const cold = await input(page, cases[0]);
          const coldScreenshot = `${phase}-${engine}-${width}.png`;
          if (phase === 'after') { assert(cold.shown && !cold.error); await page.getByRole('heading', { name: 'Request 2 of 2', exact: true }).waitFor(); }
          else assert(!cold.shown && /import|fetch/i.test(cold.error));
          await page.screenshot({ path: resolve(images, coldScreenshot), fullPage: true });
          let retry = null;
          if (phase === 'before') {
            disconnected = false; await context.setOffline(false);
            retry = await input(page, cases[0], 'online-retry.jsonl.gz');
            if (!retry.shown) { await page.reload(); await page.locator('#pick-file-btn').waitFor(); const recovered = await input(page, cases[0], 'after-reload.jsonl.gz'); assert(recovered.shown && !recovered.error); }
            await page.evaluate(() => document.fonts.ready);
            await context.setOffline(true); disconnected = true; await stop();
          }
          for (const item of cases) {
            const result = await input(page, item, 'offline-' + item.file); assert(result.shown && !result.error, item.id);
            const json = await downloaded(page, 'Download full JSON report');
            assert.deepEqual(JSON.parse(json), control[item.id].expected);
            const html = await downloaded(page, 'Download offline HTML report');
            const saved = await retain(html, 'html'); const offline = await context.newPage();
            await offline.goto(new URL('file://' + resolve(out, saved.file)).href);
            await expect(offline.getByRole('heading', { name: /contextscope/i }).first()).toBeVisible(); await offline.close();
            let original;
            if (item.id === cases[0].id) {
              const row = page.locator('#segments-tbody tr').filter({ hasText: item.requiredSegmentPath });
              await row.getByRole('button').click();
              const raw = await downloaded(page, 'download original raw JSON');
              const bodies = gunzipSync(await readFile(resolve(fixtureRoot, item.file))).toString().trim().split('\n').map(line => JSON.parse(line));
              assert.deepEqual(JSON.parse(raw), bodies[1].messages[2]);
              original = await retain(raw, 'json'); await page.getByRole('button', { name: 'Close', exact: true }).click();
            }
            records.push({ phase, engine, width, id: item.id, json: await retain(json, 'json'), html: saved, original, matchesBaselineCli: true });
          }
          const audit = await page.evaluate(() => ({ ...window.workerAudit }));
          assert.equal(audit.active, 0); assert.equal(audit.created, audit.terminated); assert.equal(audit.urls, audit.revoked);
          const violations = (await new AxeBuilder({ page }).analyze()).violations.map(item => item.id);
          const policy = await page.evaluate(() => window.policyViolations);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          assert.deepEqual(violations, []); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(policy, []); assert(!overflow);
          if (phase === 'after') { assert.deepEqual(late, []); assert.deepEqual(failed, []); }
          await Promise.all(pending);
          assert.deepEqual(received, served);
          views.push({ phase, engine, width, browser: browser.version(), readyMs, startup, initialAssets, cold, onlineRetry: retry,
            audit, served, received, failedRequests: failed, lateRequests: late, externalRequests: external,
            pageErrors: errors, policyViolations: policy, axeViolations: violations, overflow });
          console.log(`PASS ${phase} ${engine} ${width}px; first offline import ${cold.shown ? 'works' : 'fails'}; actual reports match baseline CLI`);
        } finally { await stop(); await context.close(); }
      }
    } finally { await browser.close(); }
  }
}
await writeFile(resolve(out, 'receipt.json'), JSON.stringify({ baselineSource: '7782eb5951d10f502fbf63f0daeee8186fc54d90', sdk: catalogue.sdk,
  fixtures: Object.fromEntries(cases.map(item => [item.id, { file: '../message-boundaries/fixtures/' + item.file, ...control[item.id].input }])),
  sourcePopulation: catalogue.population, controls: control, records, views,
  beforeFirstOfflineFailures: views.filter(item => item.phase === 'before' && !item.cold.shown).length,
  afterFirstOfflineFailures: views.filter(item => item.phase === 'after' && !item.cold.shown).length,
  retention: 'Actual JSON/HTML/raw downloads are stored once by SHA-256. Each observation references its original bytes.' }, null, 2) + '\n');
