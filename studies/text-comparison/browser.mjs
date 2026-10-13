import assert from 'node:assert/strict';
import { chromium, firefox } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases } from './cases.mjs';
import { withoutGenerationTime } from '../duplicate-evidence/html-content.mjs';

const [root, out, screenshots, selectedEngine, selectedWidth] = process.argv.slice(2);
const engines = Object.entries({ chromium, firefox }).filter(([name]) => !selectedEngine || name === selectedEngine);
const widths = [1440, 375].filter(width => !selectedWidth || width === Number(selectedWidth));
assert.ok(engines.length && widths.length, 'Unknown engine or viewport');
const build = resolve(root, 'web/dist'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(root, 'dist/core/index.js')));
const { renderHtmlReport } = await import(pathToFileURL(resolve(root, 'dist/cli/html-report.js')));
const references = new Map(Object.entries(cases).map(([name, input]) => {
  const analysis = analyze(JSON.stringify(input));
  assert.equal(analysis.duplicates.length, 1, name);
  return [name, { json: toJsonReport(analysis), html: withoutGenerationTime(renderHtmlReport(analysis)) }];
}));
await mkdir(screenshots, { recursive: true });
const assets = new Map(), results = [];
const save = () => writeFile(out, JSON.stringify({ complete: results.length === Object.keys(cases).length * engines.length * widths.length, constructed: true, results, assets: [...assets.values()] }, null, 2) + '\n');
const server = createServer(async (req, res) => {
  const file = resolve(build, new URL(req.url, 'http://localhost').pathname.replace(/^\/contextscope\//, '') || 'index.html');
  if (!file.startsWith(build + sep)) { res.writeHead(403).end(); return; }
  try { const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' })[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' }); res.end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  for (const [engine, launcher] of engines) {
    const browser = await launcher.launch();
    try {
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: 950 } });
        const page = await context.newPage(), errors = [], unexpected = [], pendingAssets = [];
        let offline = false;
        page.setDefaultTimeout(30_000);
        page.on('pageerror', error => errors.push(error.message));
        context.on('request', req => { if (/^https?:/.test(req.url()) && (offline || !req.url().startsWith(origin + '/'))) unexpected.push(req.url()); });
        context.on('response', response => {
          if (!response.url().startsWith(origin + '/') || response.status() !== 200) return;
          pendingAssets.push((async () => {
            const name = new URL(response.url()).pathname.replace(/^\/contextscope\//, '') || 'index.html';
            const body = await response.body(); assert.equal(sha(body), sha(await readFile(resolve(build, name))));
            assets.set(name, { path: name, bytes: body.length, sha256: sha(body) });
          })());
        });
        try {
          await page.goto(origin + '/contextscope/');
          await page.locator('[data-example="edited-repeats"]').click();
          await page.locator('#dashboard.shown').waitFor();
          assert.equal(await page.locator('[data-compare-member]').count(), 1);
          const licenseUrl = await page.locator('a[href$="jsdiff-LICENSE.txt"]').getAttribute('href');
          assert.equal(licenseUrl, '/contextscope/jsdiff-LICENSE.txt');
          const license = await page.evaluate(async url => (await globalThis.fetch(url)).text(), licenseUrl);
          assert.equal(license, await readFile(resolve(root, 'node_modules/diff/LICENSE'), 'utf8'));
          await page.evaluate(async () => { await Promise.all([...globalThis.document.fonts].map(face => face.load())); });
          await page.waitForLoadState('networkidle'); await Promise.all(pendingAssets);
          await context.setOffline(true); offline = true;
          for (const [name, input] of Object.entries(cases)) {
            await page.locator('#file-input').setInputFiles({ name: name + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
            await page.locator('#load-status').waitFor({ state: 'visible' });
            await page.locator('#load-status').waitFor({ state: 'hidden' });
            if (name === 'crossRequest') await page.getByRole('tab').nth(1).click();
            const panel = page.locator('.dup-list').locator('..');
            await panel.locator('summary').click();
            const names = await panel.locator('[data-member]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
            assert.equal(names.length, 2); assert.equal(new Set(names).size, 2);
            assert.ok(names[0].includes('messages[0].content[0]')); assert.ok(names[1].includes('messages[0].content[1]'));
            await page.evaluate(theme => globalThis.document.documentElement.setAttribute('data-theme', theme), width === 1440 ? 'dark' : 'light');
            if (name === 'edits') await panel.screenshot({ path: resolve(screenshots, `${engine}-${width}-sources.png`) });
            const opener = panel.locator('[data-compare-member]');
            await opener.focus(); const start = performance.now(); await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog'); await dialog.waitFor();
            const comparisonOpenMs = performance.now() - start;
            const summary = await dialog.locator('.comparison-summary').innerText();
            const original = (Array.isArray(input) ? input[0] : input).messages[0].content;
            if (name === 'exact') { assert.ok(summary.includes('text is identical')); assert.equal(await dialog.locator('.comparison-diff').count(), 0); }
            else if (name === 'large') { assert.ok(summary.includes('text differs')); assert.ok(summary.includes('size limit')); assert.equal(await dialog.locator('.comparison-diff').count(), 0); }
            else {
              assert.ok(summary.includes('removed'), `${engine} ${name}: ${summary}`);
              if (name === 'edits' || name === 'crossRequest') {
                assert.deepEqual(await dialog.locator('.removed code').allTextContents(), ['allow_delete = false [LF]', 'retry_budget = 3 [LF]']);
                assert.deepEqual(await dialog.locator('.added code').allTextContents(), ['allow_delete = true [LF]', 'retry_budget = 8 [LF]']);
                assert.deepEqual(await dialog.locator('.added .comparison-line-number').allTextContents(), ['', '51', '', '151']);
              }
              if (name === 'whitespace') {
                await dialog.locator('#comparison-escapes').check();
                assert.ok((await dialog.locator('.added code').allTextContents()).some(value => value.includes('\\t')));
                assert.ok((await dialog.locator('.added code').allTextContents()).some(value => value.includes('[CRLF]')));
                assert.ok((await dialog.locator('.removed code').allTextContents()).some(value => value.includes('[no final newline]')));
              }
              assert.equal(await dialog.locator('img, script').count(), 0);
            }
            for (const theme of ['dark', 'light']) {
              await page.evaluate(value => globalThis.document.documentElement.setAttribute('data-theme', value), theme);
              assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
            }
            await page.evaluate(theme => globalThis.document.documentElement.setAttribute('data-theme', theme), width === 1440 ? 'dark' : 'light');
            const downloads = [];
            for (const [index, side] of ['first', 'second'].entries()) for (const format of ['text', 'raw']) {
              const waiting = page.waitForEvent('download'); await dialog.locator(`[data-download="${side}-${format}"]`).click();
              const download = await waiting, bytes = await readFile(await download.path());
              if (format === 'raw') assert.deepEqual(JSON.parse(bytes), original[index]);
              else if (name === 'surrogate') { assert.ok(download.suggestedFilename().endsWith('.text.json')); assert.equal(JSON.parse(bytes), original[index].text); }
              else assert.equal(bytes.toString(), original[index].text);
              downloads.push({ side, format, filename: download.suggestedFilename(), bytes: bytes.length, sha256: sha(bytes) });
            }
            if (name === 'edits') {
              await dialog.locator('.drawer-body').evaluate(node => { node.scrollTop = 0; });
              await dialog.screenshot({ path: resolve(screenshots, `${engine}-${width}-comparison.png`) });
            }
            await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
            await page.keyboard.press('Shift+Tab');
            assert.equal(await dialog.locator('[data-download="second-raw"]').evaluate(node => node === globalThis.document.activeElement), true);
            await page.keyboard.press('Tab');
            assert.equal(await dialog.getByRole('button', { name: 'Close', exact: true }).evaluate(node => node === globalThis.document.activeElement), true);
            assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
            await page.keyboard.press('Escape');
            assert.equal(await opener.evaluate(node => node === globalThis.document.activeElement), true);
            // Opening the original inspector after a comparison restores its own view.
            await panel.locator('[data-member]').first().click();
            assert.equal(await dialog.locator('.comparison-summary').count(), 0);
            await page.keyboard.press('Escape');
            const reference = references.get(name);
            for (const format of ['json', 'html']) {
              const waiting = page.waitForEvent('download'); await page.locator('#report-' + format).click();
              const download = await waiting, bytes = await readFile(await download.path());
              assert.equal(sha(format === 'html' ? withoutGenerationTime(bytes.toString()) : bytes), sha(reference[format]));
              if (format === 'html') {
                const exported = await context.newPage(); await exported.goto(pathToFileURL(await download.path()).href);
                assert.equal(await exported.locator('script').count(), 0); await exported.close();
              }
            }
            assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
            results.push({ engine, version: browser.version(), width, name, comparisonOpenMs, names, summary, downloads,
              offline: true, builtInExampleLoaded: true, bundledLicenseMatchesDependency: true, bothThemesAxeViolations: 0, focusRestored: true, keyboardWraps: true,
              jsonReportSha256: sha(reference.json), htmlWithoutGeneratedAtSha256: sha(reference.html), errors: [...errors], unexpectedRequests: [...unexpected] });
            await save(); console.log(JSON.stringify({ engine, width, name, comparisonOpenMs }));
          }
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
await save();
