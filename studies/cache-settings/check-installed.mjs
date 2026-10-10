// node studies/cache-settings/check-installed.mjs REPLAY_JSON CLI_JSON CLI_HTML PACKAGE_TGZ OUTPUT
// Run replay.mjs and the installed CLI first, outside the source checkout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox } from "@playwright/test";

const [replayPath, cliPath, htmlPath, packagePath, output] = process.argv.slice(2);
const replay = JSON.parse(readFileSync(replayPath, "utf8"));
const source = JSON.parse(readFileSync(new URL("./after.json", import.meta.url), "utf8"));
assert.deepEqual(replay, source);
const cli = JSON.parse(readFileSync(cliPath, "utf8"));
assert.deepEqual(cli.cacheSimulation, replay.cases[0].cacheSimulation);
assert.deepEqual(cli.findings, replay.cases[0].findings);
const browsers = [];
for (const [engine, launcher] of [["chromium", chromium], ["firefox", firefox]]) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, offline: true });
      const page = await context.newPage();
      const requests = [], errors = [];
      page.on("request", (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(resolve(htmlPath)).href);
      const rows = page.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr");
      assert.deepEqual(await rows.nth(1).locator("td").allTextContents(), ["req 2", "2,778", "2,424", "0", "0", "$0.0099"]);
      assert.deepEqual(await rows.nth(2).locator("td").allTextContents(), ["req 3", "5,202", "0", "0", "0", "$0.0016"]);
      assert(await page.getByText(/Message cache settings changed/).first().isVisible());
      assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
      assert.equal(await page.locator("script").count(), 0);
      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
      browsers.push({ engine, width, networkRequests: requests.length, pageErrors: errors.length, correctRows: true, findingVisible: true, horizontalOverflow: false, scripts: 0 });
      await context.close();
    }
  } finally { await browser.close(); }
}
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
writeFileSync(output, JSON.stringify({
  synthetic: true, packageSha256: hash(packagePath), installedReplaySha256: hash(replayPath),
  cliJsonSha256: hash(cliPath), cliHtmlSha256: hash(htmlPath),
  sourceReplayEqual: true, cliSimulationAndFindingsEqual: true, browsers,
}, null, 2) + "\n");
console.log("Installed replay, CLI output, and four offline HTML browser workflows passed.");
