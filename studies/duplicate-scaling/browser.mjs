// Actual production build, offline input replacement and exports, both engines
// and desktop/phone widths. Usage: node browser.mjs ROOT CLI_DIRECTORY OUTPUT SCREENSHOTS
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { request } from './cases.mjs';
import { withoutGenerationTime } from '../duplicate-evidence/html-content.mjs';

const [root, cliDirectory, output, screenshots] = process.argv.slice(2);
const build = resolve(root, 'web/dist'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const name = 'mixed-2000', input = await readFile(resolve(cliDirectory, name + '.input.json'));
const referenceJson = await readFile(resolve(cliDirectory, name + '.json'));
const referenceHtml = await readFile(resolve(cliDirectory, name + '.html'), 'utf8');
await mkdir(screenshots, { recursive: true });
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.replace(/^\/contextscope\//, '') || 'index.html';
  const path = resolve(build, name);
  if (!path.startsWith(build + sep)) { res.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, assets = new Map(), results = [];
const save = () => writeFile(output, JSON.stringify({ complete: results.length === 4,
  note: 'One observed import per engine/width, including file load, worker analysis and dashboard rendering. Local build with warmed code and bundled fonts; offline before measured import. Not a multi-sample browser benchmark.',
  results, servedAssets: [...assets.values()] }, null, 2) + '\n');
try {
  for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
    const browser = await launcher.launch();
    try {
      for (const width of [1440, 375]) {
        const context = await browser.newContext({ viewport: { width, height: 950 } });
        const errors = [], external = [], pending = [];
        let offline = false;
        context.on('request', req => { if (/^https?:/.test(req.url()) && (!req.url().startsWith(origin + '/') || offline)) external.push(req.url()); });
        context.on('response', response => {
          if (!response.url().startsWith(origin + '/') || response.status() !== 200) return;
          pending.push((async () => {
            const file = new URL(response.url()).pathname.replace(/^\/contextscope\//, '') || 'index.html';
            const body = await response.body(), disk = await readFile(resolve(build, file));
            assert.equal(sha(body), sha(disk));
            assets.set(file, { path: file, bytes: body.length, sha256: sha(body) });
          })());
        });
        const page = await context.newPage();
        page.setDefaultTimeout(300_000);
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(origin + '/contextscope/');
          // Load the analysis/export code before disconnecting. The measured
          // import below is a new, large input analyzed while offline.
          await page.locator('#file-input').setInputFiles({ name: 'warm.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(request(['warm-up']))) });
          await page.locator('#dashboard.shown').waitFor();
          await page.locator('#load-status').waitFor({ state: 'hidden' });
          await page.evaluate(async () => {
            await Promise.all([...globalThis.document.fonts].map(face => face.load()));
            await globalThis.document.fonts.ready;
          });
          await page.waitForLoadState('networkidle');
          await Promise.all(pending);
          await context.setOffline(true); offline = true;
          const start = performance.now();
          await page.locator('#file-input').setInputFiles({ name: name + '.json', mimeType: 'application/json', buffer: input });
          await page.locator('#load-status').waitFor({ state: 'visible' });
          await page.locator('#load-status').waitFor({ state: 'hidden' });
          const importMilliseconds = performance.now() - start;
          const panel = page.locator('.dup-list').locator('..');
          for (const summary of await panel.locator('summary').all()) await summary.click();
          assert.equal(await panel.locator('[data-member]').count(), 4);
          const first = panel.locator('[data-member]').first();
          await first.focus(); await page.keyboard.press('Enter');
          await page.getByRole('dialog').waitFor();
          const rawDownload = page.waitForEvent('download');
          await page.getByRole('button', { name: 'download original raw JSON' }).click();
          const raw = JSON.parse(await readFile(await (await rawDownload).path()));
          const report = JSON.parse(referenceJson), member = report.duplicates[0].members[0];
          const ordinal = Number(member.segmentId.match(/content\[(\d+)\]/)[1]);
          assert.deepEqual(raw, JSON.parse(input).messages[0].content[ordinal]);
          await page.keyboard.press('Escape');
          assert.equal(await first.evaluate(node => node === globalThis.document.activeElement), true);
          for (const format of ['json', 'html']) {
            const pendingDownload = page.waitForEvent('download');
            await page.locator('#report-' + format).click();
            const file = resolve(screenshots, `${engine}-${width}.${format}`);
            await (await pendingDownload).saveAs(file);
            const bytes = await readFile(file);
            assert.equal(sha(format === 'html' ? withoutGenerationTime(bytes.toString()) : bytes),
              sha(format === 'html' ? withoutGenerationTime(referenceHtml) : referenceJson));
            if (format === 'html') {
              const exported = await context.newPage();
              await exported.goto(pathToFileURL(file).href);
              assert.equal(await exported.locator('script').count(), 0);
              assert.ok((await exported.locator('body').innerText()).includes('Similar text'));
              await exported.close();
            }
          }
          const screenshot = `${engine}-${width}.png`;
          await panel.screenshot({ path: resolve(screenshots, screenshot) });
          assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
          const violations = (await new AxeBuilder({ page }).analyze()).violations;
          assert.deepEqual(violations, []);
          assert.deepEqual(errors, []); assert.deepEqual(external, []);
          results.push({ engine, version: browser.version(), width, inputBytes: input.length, inputSha256: sha(input), importMilliseconds,
            offlineImportAndExports: true, jsonSha256: sha(referenceJson), htmlWithoutGeneratedAtSha256: sha(withoutGenerationTime(referenceHtml)),
            rawMemberDownloadMatchesInput: true, screenshot, errors, unexpectedRequests: external, axeViolations: 0 });
          await save();
          console.log(JSON.stringify({ engine, width, importMilliseconds }));
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
await save();
