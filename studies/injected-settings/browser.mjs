// node studies/injected-settings/browser.mjs BASE_URL OUT_DIR [--verify]
/* global document, innerWidth */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const [base, output, flag] = process.argv.slice(2);
const verify = flag === "--verify";
const evidence = JSON.parse(await readFile(new URL(verify ? "./results/after.json" : "./results/before.json", import.meta.url), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(output, { recursive: true });
const receipt = [];
for (const [engine, type] of [["chromium", chromium], ["firefox", firefox]]) {
  const browser = await type.launch();
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: width === 1440 ? "dark" : "light" });
    const errors = [], late = [];
    let disconnected = false;
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    context.on("request", request => { if (disconnected && /^https?:/.test(request.url())) late.push(request.url()); });
    await context.route("**/*", async route => {
      assert(route.request().url().startsWith(base) || route.request().url().startsWith("file:"));
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.locator("#pick-file-btn").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    await context.setOffline(true); disconnected = true;
    const flows = [];
    for (const name of ["format-type", "citations-tool-result"]) {
      await page.locator("#file-input").setInputFiles(resolve(`studies/injected-settings/captures/${name}.jsonl.gz`));
      await page.locator("#load-status").waitFor({ state: "hidden" });
      await page.locator("table.cache tbody tr").nth(2).waitFor();
      const jsonDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
      const json = await readFile(await (await jsonDownload).path());
      const report = JSON.parse(json);
      const expected = evidence.cases.find(c => c.name === name);
      assert.deepEqual(report, expected.report);
      const stem = `${engine}-${width}-${name}`;
      await writeFile(resolve(output, stem + ".json"), json);
      const htmlDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
      const htmlPath = resolve(output, stem + ".html");
      await (await htmlDownload).saveAs(htmlPath);
      const file = await context.newPage();
      await file.goto(pathToFileURL(htmlPath).href);
      const table = file.getByRole("group", { name: "Cache simulation", exact: true });
      assert.deepEqual(await table.locator("tbody tr").nth(1).locator("td").allTextContents(),
        await page.locator("table.cache tbody tr").nth(1).locator("td").allTextContents());
      await file.close();
      if (verify) {
        const title = name === "format-type" ? /Output format changed the prompt cache/ : /Citation setting changed the system cache/;
        const finding = page.getByRole("button", { name: title }).first();
        await finding.focus(); await page.keyboard.press("Enter");
        await page.getByRole("dialog").waitFor(); await page.keyboard.press("Escape");
        await finding.locator("xpath=ancestor::section[1]").screenshot({ path: resolve(output, stem + "-finding.png") });
      }
      await page.locator("section.panel").filter({ has: page.locator("table.cache") }).screenshot({ path: resolve(output, stem + "-cache.png") });
      const violations = (await new AxeBuilder({ page }).analyze()).violations.map(v => v.id);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert.deepEqual(violations, []); assert(fits);
      flows.push({ name, json: hash(json), html: hash(await readFile(htmlPath)), reportMatchesCli: true,
        reads: report.cacheSimulation.actual.map(s => s.readTokens), axeViolations: violations, noPageOverflow: fits });
    }
    const prior = await page.locator("table.cache tbody tr").allTextContents();
    const refusals = [];
    for (const name of ["mixed-document-citations", "format-with-citations"]) {
      await page.locator("#file-input").setInputFiles(resolve(`studies/injected-settings/captures/${name}.jsonl.gz`));
      await page.locator("#load-status").waitFor({ state: "hidden" });
      const message = await page.locator("#intake-error").textContent();
      const preservesReport = JSON.stringify(await page.locator("table.cache tbody tr").allTextContents()) === JSON.stringify(prior);
      if (verify) { assert(message.toLowerCase().includes("citation")); assert(preservesReport); }
      refusals.push({ name, message, preservesReport });
    }
    await page.locator("#file-input").setInputFiles(resolve("studies/injected-settings/captures/format-null-default.jsonl.gz"));
    await page.locator("#load-status").waitFor({ state: "hidden" });
    assert.equal(await page.locator("table.cache tbody tr").count(), 2);
    assert.equal(await page.locator("#intake-error").textContent(), "");
    assert.deepEqual(errors, []); assert.deepEqual(late, []);
    receipt.push({ engine, width, flows, refusals, recovered: true, pageErrors: errors, httpRequestsAfterDisconnect: late });
    await context.close();
  }
  await browser.close();
}
await writeFile(resolve(output, "browser.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt.map(r => ({ engine: r.engine, width: r.width, validFlows: r.flows.length,
  refused: r.refusals.filter(f => f.message).length, recovered: r.recovered }))));
