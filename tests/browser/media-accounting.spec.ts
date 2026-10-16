import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const width of [1440, 375]) test(`media remains unavailable and captured usage survives offline exports at ${width}px`, async ({ page, context }) => {
  const errors: string[] = [], late: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.goto("./");
  await expect(page.locator("#pick-file-btn")).toBeVisible();
  await context.setOffline(true);
  context.on("request", request => { if (/^https?:/.test(request.url())) late.push(request.url()); });
  for (const name of ["anthropic-image-transports", "responses-reported-usage"]) {
    await page.locator("#file-input").setInputFiles(`studies/media-accounting/captures/${name}.jsonl.gz`);
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.getByRole("button", { name: /Media token counts are unavailable/ }).first()).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
    const report = JSON.parse(await readFile((await (await download).path())!, "utf8")) as {
      reports: { totals: { openaiTokens: number | null; claudeTokensEstimate: number | null } }[];
      cacheSimulation: { actual: { readTokens: number | null; uncachedTokens: number | null }[] };
      usageComparison: { rows: { reportedInputTokens: number; reportedReadTokens: number; readOutcome: string }[] };
    };
    expect(report.reports.every(r => r.totals.openaiTokens === null && r.totals.claudeTokensEstimate === null)).toBe(true);
    expect(report.cacheSimulation.actual.every(s => s.readTokens === null && s.uncachedTokens === null)).toBe(true);
    if (name === "anthropic-image-transports") {
      const prior = await page.locator("table.cache tbody tr").allTextContents();
      await page.locator("#calibrate-count").fill("1200"); await page.locator("#calibrate-btn").click();
      await expect(page.locator("#calibrate-status")).toContainText(/unmodeled media/);
      expect(await page.locator("table.cache tbody tr").allTextContents()).toEqual(prior);
    } else {
      expect(report.usageComparison.rows.every(r => r.reportedInputTokens === 1200 && r.reportedReadTokens === 400 && r.readOutcome === "unavailable")).toBe(true);
      await expect(page.locator("#usage-review")).toContainText("Read comparison unavailable");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator("#file-input").setInputFiles("studies/media-accounting/captures/anthropic-literal-control.jsonl.gz");
  await expect(page.locator("#load-status")).toBeHidden();
  await expect(page.getByRole("button", { name: /Media token counts are unavailable/ })).toHaveCount(0);
  expect(errors).toEqual([]); expect(late).toEqual([]);
});
