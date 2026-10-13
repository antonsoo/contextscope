import assert from 'node:assert/strict';
import { chromium, firefox } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { cases } from './cases.mjs';
const [root, out, screenshots] = process.argv.slice(2);
const build = resolve(root, 'web/dist');
await mkdir(screenshots, { recursive: true });
const server = createServer(async (req, res) => {
  const file = resolve(build, new URL(req.url, 'http://localhost').pathname.replace(/^\/contextscope\//, '') || 'index.html');
  if (!file.startsWith(build + sep)) { res.writeHead(403).end(); return; }
  try { const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' })[extname(file)] ?? 'application/octet-stream' }); res.end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const results = [];
try {
  for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
    const browser = await launcher.launch();
    try {
      for (const width of [1440, 375]) {
        const page = await browser.newPage({ viewport: { width, height: 950 } });
        await page.goto(`http://127.0.0.1:${server.address().port}/contextscope/`);
        await page.locator('#file-input').setInputFiles({ name: 'edits.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(cases.edits)) });
        await page.locator('#dashboard.shown').waitFor();
        const panel = page.locator('.dup-list').locator('..');
        await panel.locator('summary').click();
        const names = await panel.locator('[data-member]').allTextContents();
        assert.equal(names.length, 2); assert.equal(new Set(names).size, 1);
        const comparisons = await panel.getByRole('button', { name: /compare/i }).count();
        assert.equal(comparisons, 0);
        await page.evaluate(() => globalThis.document.fonts.ready);
        await panel.screenshot({ path: resolve(screenshots, `${engine}-${width}.png`) });
        results.push({ engine, version: browser.version(), width, names, comparisonActions: comparisons });
        await page.close();
      }
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
await writeFile(out, JSON.stringify({ constructed: true, results }, null, 2) + '\n');
console.log('Four baseline workflows reproduce indistinguishable controls and no comparison action.');
