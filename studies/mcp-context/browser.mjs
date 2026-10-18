// node browser.mjs BASE_URL OUTPUT [before|after] [all|anthropic|openai]
/* global document, innerWidth */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium, firefox } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const [base, output, expectation = "after", group = "all"] = process.argv.slice(2);
assert.ok(base && output && ["before", "after"].includes(expectation));
assert.ok(["all", "anthropic", "openai"].includes(group));
const verify = expectation === "after";
const reference = JSON.parse(await readFile(new URL(`results/${expectation}.json`, import.meta.url)));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fixture = name => fileURLToPath(new URL(`captures/${name}.jsonl.gz`, import.meta.url));
const names = [
  ...(group !== "openai" ? ["connector-server-switch", "pinned-connector", "recorded-tool-listing", "local-tools-control"] : []),
  ...(group !== "anthropic" ? ["openai-connector-same-server", "openai-recorded-tool-listing", "openai-local-tools-control"] : []),
];
await mkdir(output, { recursive: true });
const results = [];
for (const [engine, launcher] of Object.entries({ chromium, firefox })) {
  const browser = await launcher.launch();
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, colorScheme: width === 1440 ? "dark" : "light" });
      try {
        const errors = [], requests = [];
        let offline = false;
        context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
        context.on("request", request => { if (offline && /^https?:/.test(request.url())) requests.push(request.url()); });
        const page = await context.newPage();
        await page.goto(base);
        await page.locator("#pick-file-btn").waitFor({ state: "visible" });
        const load = async name => {
          await page.locator("#file-input").setInputFiles(fixture(name));
          await page.locator("#load-status").waitFor({ state: "hidden", timeout: 60000 });
          await page.locator("table.cache tbody tr").nth(1).waitFor();
          await page.locator("#request-tab-1").click();
        };
        // Warm the actual worker and tokenizer with the captured local control.
        // Processing after this bootstrap runs with all networking disabled.
        await load("local-tools-control");
        await context.setOffline(true); offline = true;
        const flows = [];
        for (const name of names) {
          await load(name);
          const stem = `${engine}-${width}-${name}`;
          const pending = page.waitForEvent("download");
          await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
          const json = await readFile(await (await pending).path());
          const entry = reference.cases.find(item => item.name === name);
          const report = JSON.parse(json), expected = entry.report;
          assert.deepEqual(report, expected, name);
          await writeFile(resolve(output, stem + ".json"), json);
          const htmlPending = page.waitForEvent("download");
          await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
          const htmlPath = resolve(output, stem + ".html");
          await (await htmlPending).saveAs(htmlPath);
          const standalone = await context.newPage();
          try {
            await standalone.goto(pathToFileURL(htmlPath).href);
            const table = standalone.getByRole("group", { name: "Cache simulation", exact: true });
            const cells = await table.locator("tbody tr").nth(1).locator("td").allTextContents();
            const actual = await page.locator("table.cache tbody tr").nth(1).locator("td").allTextContents();
            assert.deepEqual(cells.slice(0, -1), actual.slice(0, -1));
            const cost = report.cacheSimulation.actual[1].costUsd;
            assert.equal(cells.at(-1), cost === undefined ? "n/a" : `$${cost.toFixed(4)}`);
          } finally { await standalone.close(); }
          let rawPreserved = false, calibrationRefused = false;
          if (verify && entry.unknownMcp) {
            const path = entry.provider === "openai" ? "tools[0]" : "mcp_servers[0]";
            const row = page.locator("#segments-tbody tr").filter({ hasText: path });
            await row.getByRole("button").click();
            const rawPending = page.waitForEvent("download");
            await page.getByRole("button", { name: "download original raw JSON", exact: true }).click();
            const original = JSON.parse(await readFile(await (await rawPending).path(), "utf8"));
            const source = JSON.parse(gunzipSync(await readFile(fixture(name))).toString().trim().split("\n")[1]);
            assert.deepEqual(original, entry.provider === "openai" ? source.request.tools[0] : source.request.mcp_servers[0]);
            rawPreserved = true; await page.keyboard.press("Escape");
            if (entry.provider === "anthropic") {
              await page.locator("#calibrate-count").fill("12000");
              await page.locator("#calibrate-btn").click();
              await page.locator("#calibrate-status").filter({ hasText: /unmodeled media or tool context/ }).waitFor();
              calibrationRefused = true;
            }
          }
          if (name === "connector-server-switch" || name === "openai-connector-same-server") {
            const totals = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: /^Request 2 of/ }) });
            const cache = page.locator("section.panel").filter({ has: page.locator("table.cache") });
            await totals.screenshot({ path: resolve(output, `${engine}-${width}-${entry.provider}-totals.png`) });
            await cache.screenshot({ path: resolve(output, `${engine}-${width}-${entry.provider}-cache.png`) });
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const audit = await new AxeBuilder({ page }).analyze();
          assert.deepEqual(audit.violations, []);
          flows.push({ name, provider: entry.provider, jsonSha256: sha(json), htmlSha256: sha(await readFile(htmlPath)),
            exactCliReport: true, rawPreserved, calibrationRefused, noOverflow: true, axeViolations: 0 });
        }
        assert.deepEqual(errors, []); assert.deepEqual(requests, []);
        results.push({ engine, version: browser.version(), width, expectation, base,
          offlineAfterControlBootstrap: true, flows, errors, requests });
        console.log(JSON.stringify({ engine, width, workflows: flows.length, expectation }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(resolve(output, "browser.json"), JSON.stringify({ results }, null, 2) + "\n");
