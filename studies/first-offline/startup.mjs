// Real HTTP cache headers and native workers, not routed/mocked fetch implementations.
/* global window, document, Worker */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const dist = resolve(process.argv[2] ?? resolve(repo, 'web/dist'));
const out = resolve(process.argv[3] ?? resolve(here, 'results/startup'));
await mkdir(out, { recursive: true });
const images = resolve(repo, 'docs/assets/first-offline'); await mkdir(images, { recursive: true });
const fixture = await readFile(resolve(here, '../message-boundaries/fixtures/chat-refusal-changed.jsonl.gz'));
const expected = JSON.parse(await readFile(resolve(here, 'results/receipt.json'), 'utf8')).controls['chat-refusal-changed'].expected;
const rows = [], hash = raw => createHash('sha256').update(raw).digest('hex');
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) {
      for (const fault of ['http-503', 'html', 'truncated', 'invalid-utf8', 'held-download', 'silent-worker']) {
        const requests = [], errors = [], external = [], failures = [];
        let workerRequests = 0, held, closed = false;
        const server = createServer((request, response) => void (async () => {
          const name = new URL(request.url, 'http://localhost').pathname.replace(/^\/contextscope\//, '') || 'index.html';
          const path = resolve(dist, name); if (!path.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
          const worker = /^assets\/analysis-worker-.*\.js$/.test(name);
          if (worker) {
            workerRequests++;
            const record = { request: workerRequests, cacheControl: request.headers['cache-control'] ?? null,
              pragma: request.headers.pragma ?? null, ifNoneMatch: request.headers['if-none-match'] ?? null };
            requests.push(record);
            if (workerRequests === 1) {
              if (fault === 'held-download') {
                held = response; response.on('close', () => { record.clientClosed = true; }); return;
              }
              const text = fault === 'invalid-utf8' ? Buffer.concat([Buffer.from('const marker="'), Buffer.from([255]), Buffer.from('";self.postMessage({type:"ready"});')])
                : fault === 'http-503' ? 'Temporarily unavailable.' : fault === 'html' ? '<html>missing application code</html>'
                : fault === 'truncated' ? 'function incomplete(' : 'self.postMessage({type:"probe-running"});';
              record.controlledBody = Buffer.isBuffer(text) ? { base64: text.toString('base64'), sha256: hash(text) } : text;
              record.status = fault === 'http-503' ? 503 : 200;
              response.writeHead(record.status, { 'Content-Type': fault === 'html' ? 'text/html' : 'text/javascript',
                'Cache-Control': 'public, max-age=31536000, immutable' }).end(text); return;
            }
          }
          try {
            const raw = await readFile(path);
            if (worker) requests.at(-1).sourceSha256 = hash(raw);
            response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream',
              'Cache-Control': 'public, max-age=31536000, immutable' }).end(raw);
          } catch { response.writeHead(404).end(); }
        })());
        await new Promise(done => server.listen(0, '127.0.0.1', done));
        const origin = `http://127.0.0.1:${server.address().port}`;
        const stop = async () => { if (!closed) { closed = true; held?.destroy(); server.closeAllConnections(); await new Promise(done => server.close(done)); } };
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: width === 1440 ? 'dark' : 'light' });
        try {
          const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
          context.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) external.push(request.url()); });
          page.on('requestfailed', request => failures.push(request.url().replace(origin, 'loopback')));
          await page.addInitScript(() => {
            const Original = Worker, audit = { created: 0, active: 0, terminated: 0, posts: 0, probe: 0 };
            window.startupAudit = audit;
            window.Worker = class extends Original {
              constructor(url, options) { super(url, options); audit.created++; audit.active++; this.done = false;
                this.addEventListener('message', event => { if (event.data?.type === 'probe-running') audit.probe++; }); }
              postMessage(message) { audit.posts++; super.postMessage(message); }
              terminate() { if (!this.done) { this.done = true; audit.active--; audit.terminated++; } super.terminate(); }
            };
          });
          await page.goto(origin + '/contextscope/');
          if (fault === 'held-download' || fault === 'silent-worker') {
            await expect.poll(() => workerRequests).toBe(1);
            if (fault === 'silent-worker') await page.waitForFunction(() => window.startupAudit.probe === 1);
            await expect(page.locator('#file-input')).toHaveCount(0);
            await page.getByRole('button', { name: 'Cancel loading', exact: true }).click();
            await expect(page.getByRole('alert')).toHaveText('Loading cancelled.');
          } else await expect(page.getByRole('alert')).toContainText('Local analysis could not start');
          const beforeRetry = await page.evaluate(() => ({ ...window.startupAudit }));
          assert.equal(beforeRetry.posts, 0); assert.equal(beforeRetry.active, 0);
          assert.equal(beforeRetry.created, beforeRetry.terminated);
          if (fault === 'truncated') {
            const violations = (await new AxeBuilder({ page }).analyze()).violations.map(item => item.id); assert.deepEqual(violations, []);
            await page.screenshot({ path: resolve(images, `startup-${engine}-${width}.png`), fullPage: true });
          }
          await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
          await page.locator('#pick-file-btn').waitFor(); await page.evaluate(() => document.fonts.ready);
          assert.equal(workerRequests, 2, 'Retry must obtain corrected bytes, including after a cacheable 200 fault.');
          const prepared = await page.evaluate(() => ({ ...window.startupAudit }));
          assert.equal(prepared.posts, 0); assert.equal(prepared.active, 0); assert.equal(prepared.created, prepared.terminated);
          await context.setOffline(true); await stop();
          await page.locator('#file-input').setInputFiles({ name: 'native-after-retry.jsonl.gz', mimeType: 'application/gzip', buffer: fixture });
          await expect(page.getByRole('heading', { name: 'Request 2 of 2', exact: true })).toBeVisible();
          await expect(page.locator('#intake-error')).toBeHidden();
          const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download full JSON report', exact: true }).click();
          const raw = await readFile(await (await pending).path(), 'utf8'); assert.deepEqual(JSON.parse(raw), expected);
          const finished = await page.evaluate(() => ({ ...window.startupAudit }));
          assert.equal(finished.posts, 1); assert.equal(finished.active, 0); assert.equal(finished.created, finished.terminated);
          assert.deepEqual(errors, []); assert.deepEqual(external, []);
          rows.push({ engine, width, fault, browser: browser.version(), requests, beforeRetry, prepared, finished,
            firstAnalysisOffline: true, reportMatchesBaselineCli: true, reportSha256: hash(raw), pageErrors: errors,
            externalRequests: external, failedRequests: failures });
          console.log(`PASS ${engine} ${width}px ${fault}: retry, no preparation jobs, first analysis offline`);
        } finally { await stop(); await context.close(); }
      }
    }
  } finally { await browser.close(); }
}
await writeFile(resolve(out, 'receipt.json'), JSON.stringify({ cases: rows.length, rows }, null, 2) + '\n');
