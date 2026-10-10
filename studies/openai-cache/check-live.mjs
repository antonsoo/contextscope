// node studies/openai-cache/check-live.mjs URL OUTPUT.json
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const [url, output] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByRole("button", { name: "OpenAI cache modes: disabled, implicit, explicit", exact: false }).click();
  await page.locator("table.cache").waitFor();
  const rows = await page.locator("table.cache tbody tr").allTextContents();
  const sixth = await page.locator("table.cache tbody tr").nth(5).locator("td").allTextContents();
  assert.deepEqual(sixth, ["req 6", "explicit", "2,401", "0", "3", "$0.0005"]);
  const scripts = await page.locator("script[src]").evaluateAll((nodes) => nodes.map((node) => node.src));
  await context.setOffline(true);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
  const report = JSON.parse(await readFile(await (await downloaded).path(), "utf8"));
  const partitions = report.cacheSimulation.actual.map((s) => [s.readTokens, s.writeTokens30m, s.uncachedTokens]);
  assert.deepEqual(partitions, [[0, 0, 2404], [0, 0, 2404], [0, 2404, 0], [0, 2404, 0], [0, 2401, 3], [2401, 0, 3]]);
  assert.deepEqual(errors, []);
  const result = { url, checkedAt: new Date().toISOString(), browser: browser.version(), scripts,
    rows, partitions, totalSimulatedUsd: report.cacheSimulation.totalActualCostUsd, offlineJsonDownload: true, pageErrors: errors };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
