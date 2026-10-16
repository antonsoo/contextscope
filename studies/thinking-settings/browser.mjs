// node studies/thinking-settings/browser.mjs BASE_URL OUT_DIR [--verify]
/* global document, innerWidth */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";

const [base, output, verify] = process.argv.slice(2);
const evidence = JSON.parse(await readFile(new URL(verify === "--verify" ? "./results/after.json" : "./results/before.json", import.meta.url), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(output, { recursive: true });
const results = [];
for (const [engine, browserType] of [["chromium", chromium], ["firefox", firefox]]) {
  const browser = await browserType.launch();
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: width === 1440 ? "dark" : "light", acceptDownloads: true });
    const errors = [], requestsAfterOffline = [];
    let offline = false;
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    context.on("request", (req) => { if (offline && /^https?:/.test(req.url())) requestsAfterOffline.push(req.url()); });
    await context.route("**/*", async (route) => {
      assert(route.request().url().startsWith(base) || route.request().url().startsWith("file:"));
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.locator("#pick-file-btn").waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    await context.setOffline(true);
    offline = true;
    const workflows = [];
    for (const name of ["budget-change", "effort-change", "message-effort-change", "adaptive-default"]) {
      await page.locator("#file-input").setInputFiles(resolve(`studies/thinking-settings/captures/${name}.jsonl.gz`));
      await page.locator("#load-status").waitFor({ state: "hidden" });
      await page.getByRole("heading", { name: /Request \d+ of \d+/, exact: true }).waitFor();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
      const report = JSON.parse(await readFile(await (await download).path(), "utf8"));
      assert.deepEqual(report, evidence.cases.find((c) => c.name === name).report);
      const stem = `${engine}-${width}-${name}`;
      await writeFile(resolve(output, stem + ".json"), JSON.stringify(report, null, 2) + "\n");
      const reads = report.cacheSimulation.actual.map((s) => s.readTokens);
      if (verify === "--verify") {
        if (name === "budget-change" || name === "effort-change") {
          assert.deepEqual(reads, [0, 0, 10151]);
          assert(report.findings.some((f) => f.kind === "anthropic_reasoning_cache_scope"));
        } else if (name === "message-effort-change") {
          assert.deepEqual(reads, [0, 10151, 10166]);
          assert(report.parse.requests[1].segments.some((s) => s.path === "messages[2].content"));
        } else assert.deepEqual(reads, [0, 10151]);
      }
      const htmlDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
      const htmlPath = resolve(output, stem + ".html");
      await (await htmlDownload).saveAs(htmlPath);
      const file = await context.newPage();
      await file.goto(pathToFileURL(htmlPath).href);
      assert.deepEqual(await file.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr").nth(1).locator("td").allTextContents(),
        await page.locator("table.cache tbody tr").nth(1).locator("td").allTextContents());
      await file.close();
      let rawPreserved;
      if (name === "message-effort-change" && verify === "--verify") {
        const row = page.locator("#segments-tbody tr").filter({ hasText: "messages[2].content" });
        await row.getByRole("button").click();
        const rawDownload = page.waitForEvent("download");
        await page.getByRole("button", { name: "download original raw JSON", exact: true }).click();
        const raw = JSON.parse(await readFile(await (await rawDownload).path(), "utf8"));
        assert.deepEqual(raw, { role: "system", content: [], output_config: { effort: "high" } });
        rawPreserved = true;
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
      if (name === "budget-change") {
        await page.locator("section.panel").filter({ has: page.locator("table.cache") }).screenshot({ path: resolve(output, `${engine}-${width}-cache.png`) });
        if (verify === "--verify") {
          const finding = page.getByRole("button", { name: /Thinking or effort cache settings changed/ }).first();
          await finding.focus();
          await page.keyboard.press("Enter");
          await page.getByRole("dialog").waitFor();
          await page.keyboard.press("Escape");
          await finding.locator("xpath=ancestor::section[1]").screenshot({ path: resolve(output, `${engine}-${width}-finding.png`) });
        }
      }
      const violations = (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id);
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert.deepEqual(violations, []);
      assert(fits);
      workflows.push({ name, reads, rawPreserved, reportMatchesCli: true,
        jsonSha256: hash(await readFile(resolve(output, stem + ".json"))),
        htmlSha256: hash(await readFile(htmlPath)), noPageOverflow: fits, axeViolations: violations });
    }
    assert.deepEqual(errors, []);
    results.push({ engine, width, workflows, pageErrors: errors, httpRequestsAfterDisconnect: requestsAfterOffline });
    await context.close();
  }
  await browser.close();
}
await writeFile(resolve(output, "browser.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results.map((r) => ({ engine: r.engine, width: r.width, workflows: r.workflows.length, pageErrors: r.pageErrors, httpRequestsAfterDisconnect: r.httpRequestsAfterDisconnect.length }))));
