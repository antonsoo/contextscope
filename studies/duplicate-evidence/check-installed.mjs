// Inspect outputs already produced by the independently installed CLI on both runtimes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox } from "@playwright/test";
import { withoutGenerationTime } from "./html-content.mjs";
const [root, tarball, output] = process.argv.slice(2);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (name) => readFileSync(resolve(root, name));
const replays = [20, 24].map((major) => JSON.parse(read(`replay-node${major}.json`)));
assert.equal(replays[0].node, "v20.0.0");
assert.equal(replays[1].node, "v24.21.0");
const { node: node20, ...r20 } = replays[0], { node: node24, ...r24 } = replays[1];
assert.deepEqual(r20, r24);
const browser = JSON.parse(readFileSync(new URL("./browser-after.json", import.meta.url)));
const runtimeChecks = [20, 24].map((major, i) => {
  const json = read(`report-node${major}.json`), html = read(`report-node${major}.html`);
  const parsed = JSON.parse(json);
  assert.equal(sha(JSON.stringify(parsed)), replays[i].results[0].fullReportSha256);
  assert.deepEqual(parsed.duplicates, browser.results[0].duplicates);
  const comparableHtml = sha(withoutGenerationTime(html.toString()));
  assert.ok(browser.results.every((r) => r.htmlWithoutGenerationTimeSha256 === comparableHtml));
  const terminal = read(`terminal-node${major}.txt`).toString();
  assert.ok(terminal.includes("Similar text appears in 2 segments"));
  assert.ok(terminal.includes("to review"));
  assert.ok(!terminal.includes("wasted"));
  assert.ok(!html.toString().includes("record_050"));
  return { node: replays[i].node, fullReplayEqual: true, fullCliJsonMatchesCore: true, cliHtmlMatchesBrowserExportExceptGenerationTime: true, terminalUsesReviewBudget: true, cliJsonSha256: sha(json), cliHtmlSha256: sha(html), htmlWithoutGenerationTimeSha256: comparableHtml };
});
const browsers = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, offline: true });
      try {
        const page = await context.newPage(), requests = [], errors = [];
        page.on("request", (r) => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(pathToFileURL(resolve(root, "report-node20.html")).href);
        assert.equal(await page.title(), "contextscope report — anthropic");
        assert.equal(await page.getByText("Similar text appears in 2 segments", { exact: true }).count(), 1);
        assert.ok((await page.locator("body").innerText()).includes("not proven savings"));
        assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
        assert.equal(await page.locator("script").count(), 0);
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        browsers.push({ engine, version: browser.version(), width, actualHtmlRendered: true, requests, errors, scripts: 0, horizontalOverflow: false });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(output, JSON.stringify({ packageSha256: sha(readFileSync(tarball)), runtimes: [node20, node24], runtimeChecks, browsers }, null, 2) + "\n");
console.log("Installed Node 20/24 replays and CLI reports agree; four offline CLI-HTML workflows passed.");
