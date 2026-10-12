/* global window, document, innerWidth */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const [baseURL, buildArg, replayArg, outArg, screenshotsArg, downloadsArg] = process.argv.slice(2);
const study = dirname(fileURLToPath(import.meta.url));
const replay = JSON.parse(await readFile(replayArg));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(screenshotsArg, { recursive: true });
await mkdir(downloadsArg, { recursive: true });
const results = [], assets = new Map();
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) for (const name of ['hidden-warning', 'mixed-speed']) {
      const reference = replay.records.find(row => row.name === name);
      const context = await browser.newContext({ viewport: { width, height: 950 }, colorScheme: width === 375 ? 'light' : 'dark' });
      try {
        const page = await context.newPage();
        const errors = [], external = [], responses = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => {
          if (/^https?:/.test(request.url()) && !request.url().startsWith(baseURL)) external.push(request.url());
        });
        page.on('response', response => {
          if (!response.url().startsWith(baseURL)) return;
          responses.push((async () => {
            const relative = decodeURIComponent(response.url().slice(baseURL.length)) || 'index.html';
            const local = await readFile(resolve(buildArg, relative));
            const served = await response.body();
            assert.equal(sha(served), sha(local), relative);
            assets.set(relative, { path: relative, bytes: local.length, sha256: sha(local) });
          })());
        });
        await page.addInitScript(() => {
          window.policyViolations = [];
          document.addEventListener('securitypolicyviolation', event => window.policyViolations.push(event.violatedDirective));
        });
        await page.goto(baseURL);
        await page.locator('#file-input').setInputFiles(resolve(study, 'fixtures', name + '.jsonl.gz'));
        await page.locator('#dashboard.shown').waitFor();
        await page.waitForLoadState('networkidle');
        await Promise.all(responses);
        await context.setOffline(true);
        for (const group of reference.displayed) {
          const item = page.locator(`.finding.${group.severity}`).filter({ has: page.locator('.fhead', { hasText: group.title }) });
          assert.equal(await item.count(), 1);
          assert.equal(await item.locator('.fhead').getAttribute('data-req'), String(group.requestIndices[0]));
          const indexes = await item.locator('.occ').evaluateAll(nodes => nodes.map(node => Number(node.dataset.req)));
          assert.deepEqual(indexes, group.requestIndices.length > 1 ? group.requestIndices : []);
          if (indexes.length) {
            const last = indexes.at(-1);
            const button = item.locator(`.occ[data-req="${last}"]`);
            await button.focus();
            await page.keyboard.press('Enter');
            assert.equal(await page.getByRole('tab', { selected: true }).getAttribute('data-req'), String(last));
            assert.ok(await button.evaluate(node => document.activeElement === node));
          }
        }
        const issueTile = await page.locator('.stat-tile').filter({ hasText: 'issues' }).locator('.value').innerText();
        if (name === 'hidden-warning') assert.equal(issueTile, replay.expectation === 'after' ? '1 warn' : '2');
        for (const format of ['json', 'html']) {
          const pending = page.waitForEvent('download');
          await page.locator('#report-' + format).click();
          const file = resolve(downloadsArg, `${engine}-${width}-${name}.${format}`);
          await (await pending).saveAs(file);
          const bytes = await readFile(file);
          // The export time changes on each download; preserve and compare all other HTML bytes.
          const compared = format === 'html' ? bytes.toString().replace(/ · generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z(?=<\/p>)/, ' · generated <timestamp>') : bytes;
          assert.equal(sha(compared), reference[format === 'html' ? 'htmlWithoutGeneratedAtSha256' : 'jsonSha256']);
          if (format === 'html') {
            const offline = await context.newPage();
            await offline.goto(pathToFileURL(file).href);
            for (const group of reference.displayed) {
              assert.equal(await offline.locator(`.finding.${group.severity}`).filter({ has: offline.locator('strong', { hasText: group.title }) }).count(), 1);
            }
            assert.equal(await offline.locator('script').count(), 0);
            await offline.close();
          }
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        assert.deepEqual(await page.evaluate(() => window.policyViolations), []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
        let screenshot = null;
        if (name === 'mixed-speed' && (replay.expectation === 'after' || (engine === 'chromium' && width === 1440))) {
          screenshot = `${replay.expectation}-${engine}-${width}.png`;
          await page.locator('section.panel').filter({ has: page.locator('.finding-list') }).screenshot({ path: resolve(screenshotsArg, screenshot) });
        }
        results.push({ engine, version: browser.version(), width, name, issueTile,
          displayed: reference.displayed, offlineJsonMatchesCli: true, offlineHtmlMatchesCliExceptGeneratedAt: true,
          errors, externalRequests: external, axeViolations: 0, screenshot });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(outArg, JSON.stringify({ expectation: replay.expectation, assets: [...assets.values()], results }, null, 2) + '\n');
console.log(JSON.stringify({ expectation: replay.expectation, workflows: results.length, servedAssetsMatch: assets.size }));
