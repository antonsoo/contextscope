// node studies/stored-context/browser.mjs BASE_URL OUT_DIR [--verify]
/* global document, innerWidth */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
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
    for (const name of ["previous-response-change", "reported-usage", "item-reference-only"]) {
      const capture = resolve(`studies/stored-context/captures/${name}.jsonl.gz`);
      await page.locator("#file-input").setInputFiles(capture);
      await page.locator("#load-status").waitFor({ state: "hidden", timeout: 60000 });
      await page.locator("table.cache tbody tr").nth(1).waitFor();
      await page.locator("#request-tab-1").click();
      const stem = `${engine}-${width}-${name}`;
      const jsonDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
      const json = await readFile(await (await jsonDownload).path());
      const report = JSON.parse(json);
      assert.deepEqual(report, evidence.cases.find(c => c.name === name).report);
      await writeFile(resolve(output, stem + ".json"), json);
      const htmlDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
      const htmlPath = resolve(output, stem + ".html");
      await (await htmlDownload).saveAs(htmlPath);
      const file = await context.newPage();
      await file.goto(pathToFileURL(htmlPath).href);
      const table = file.getByRole("group", { name: "Cache simulation", exact: true });
      const htmlRow = await table.locator("tbody tr").nth(1).locator("td").allTextContents();
      const webRow = await page.locator("table.cache tbody tr").nth(1).locator("td").allTextContents();
      assert.deepEqual(htmlRow.slice(0, -1), webRow.slice(0, -1));
      const cost = report.cacheSimulation.actual[1].costUsd;
      assert.equal(htmlRow.at(-1), cost === undefined ? "n/a" : `$${cost.toFixed(4)}`);
      assert.equal(webRow.at(-1), cost === undefined ? "n/a" : `$${cost.toFixed(cost < 1 ? 4 : 2)}`);
      if (verify) assert((await file.locator("body").textContent()).includes("unavailable"));
      await file.close();
      let originalPreserved = false;
      if (verify) {
        const rawPath = name === "item-reference-only" ? "input[0]" : "previous_response_id";
        const row = page.locator("#segments-tbody tr").filter({ hasText: rawPath });
        await row.getByRole("button").click();
        const rawDownload = page.waitForEvent("download");
        await page.getByRole("button", { name: "download original raw JSON", exact: true }).click();
        const raw = JSON.parse(await readFile(await (await rawDownload).path(), "utf8"));
        const source = JSON.parse(gunzipSync(await readFile(capture)).toString().trim().split("\n")[1]);
        const request = source.request ?? source;
        assert.deepEqual(raw, name === "item-reference-only" ? request.input[0] : request.previous_response_id);
        originalPreserved = true;
        await page.keyboard.press("Escape");
        assert(report.cacheSimulation.actual.every(s => s.readTokens === null));
        assert(report.reports.every(r => r.totals.openaiTokens === null && r.totals.claudeTokensEstimate === null));
        const finding = page.getByRole("button", { name: /Stored or opaque context is unresolved/ }).first();
        await finding.focus(); await page.keyboard.press("Enter"); await page.getByRole("dialog").waitFor(); await page.keyboard.press("Escape");
        await finding.locator("xpath=ancestor::section[1]").screenshot({ path: resolve(output, stem + "-finding.png") });
      }
      // Inspecting a grouped finding navigates to its first occurrence.
      // Return to the second request's row for comparable headline captures.
      await page.locator("#request-tab-1").click();
      await page.locator("section.panel").filter({ has: page.getByRole("heading", { name: /^Request 2 of/ }) }).screenshot({ path: resolve(output, stem + "-totals.png") });
      await page.locator("section.panel").filter({ has: page.locator("table.cache") }).screenshot({ path: resolve(output, stem + "-cache.png") });
      if (verify && name === "reported-usage") {
        await page.locator(".stat-tile").filter({ hasText: "Reported input tokens" }).filter({ hasText: "12,000" }).waitFor();
      }
      if (name === "reported-usage") await page.locator("#usage-review").screenshot({ path: resolve(output, stem + "-usage.png") });
      const violations = (await new AxeBuilder({ page }).analyze()).violations.map(v => v.id);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert.deepEqual(violations, []); assert(fits);
      flows.push({ name, json: hash(json), html: hash(await readFile(htmlPath)), reportMatchesCli: true,
        originalPreserved, totals: report.reports.map(r => r.totals),
        axeViolations: violations, noPageOverflow: fits });
    }
    await page.locator("#file-input").setInputFiles(resolve("studies/stored-context/captures/literal-control.jsonl.gz"));
    await page.locator("#load-status").waitFor({ state: "hidden" });
    const recovery = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
    const recovered = JSON.parse(await readFile(await (await recovery).path(), "utf8"));
    assert.deepEqual(recovered, evidence.cases.find(c => c.name === "literal-control").report);
    assert(Number.isSafeInteger(recovered.reports[0].totals.openaiTokens));
    let refusalPreservesWorkspace;
    if (verify) {
      const prior = await page.locator("table.cache tbody tr").allTextContents();
      await page.locator("#file-input").setInputFiles(resolve("studies/stored-context/captures/invalid-mutual-state.jsonl.gz"));
      await page.locator("#intake-error").filter({ hasText: /cannot combine/ }).waitFor();
      assert.deepEqual(await page.locator("table.cache tbody tr").allTextContents(), prior);
      refusalPreservesWorkspace = true;
    }
    assert.deepEqual(errors, []); assert.deepEqual(late, []);
    receipt.push({ engine, width, flows, textRecovery: true, refusalPreservesWorkspace, pageErrors: errors, httpRequestsAfterDisconnect: late });
    await context.close();
  }
  await browser.close();
}
await writeFile(resolve(output, "browser.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt.map(r => ({ engine: r.engine, width: r.width, exportFlows: r.flows.length, textRecovery: r.textRecovery }))));
