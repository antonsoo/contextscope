import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { AnalysisResult, RequestTokenReport } from "../../src/core/types.js";

for (const width of [1440, 375]) test(`stored context stays unknown and captured counters stay separate at ${width}px`, async ({ page, context }) => {
  const errors: string[] = [], late: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.goto("./");
  await expect(page.locator("#pick-file-btn")).toBeVisible();
  await context.setOffline(true);
  context.on("request", request => { if (/^https?:/.test(request.url())) late.push(request.url()); });
  await page.locator("#file-input").setInputFiles("studies/stored-context/captures/reported-usage.jsonl.gz");
  await expect(page.locator("#load-status")).toBeHidden();
  await expect(page.getByRole("button", { name: /Stored or opaque context is unresolved/ }).first()).toBeVisible();
  await expect(page.locator(".stat-tile").filter({ hasText: "Reported input tokens" })).toContainText("12,000");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
  const report = JSON.parse(await readFile((await (await download).path())!, "utf8")) as
    Pick<AnalysisResult, "cacheSimulation" | "usageComparison"> & { reports: Pick<RequestTokenReport, "totals">[] };
  expect(report.reports.every(r => r.totals.openaiTokens === null)).toBe(true);
  expect(report.cacheSimulation.actual.every(s => s.readTokens === null && s.costUsd === undefined)).toBe(true);
  expect(report.usageComparison.rows.map(r => r.reportedReadTokens)).toEqual([0, 400]);
  expect(report.usageComparison.rows.every(r => r.reportedInputTokens === 12000 && r.readOutcome === "unavailable")).toBe(true);
  const prior = await page.locator("table.cache tbody tr").allTextContents();
  await page.locator("#file-input").setInputFiles("studies/stored-context/captures/invalid-mutual-state.jsonl.gz");
  await expect(page.locator("#intake-error")).toContainText("cannot combine");
  expect(await page.locator("table.cache tbody tr").allTextContents()).toEqual(prior);
  await page.locator("#file-input").setInputFiles("studies/stored-context/captures/item-reference-only.jsonl.gz");
  await expect(page.locator("#load-status")).toBeHidden();
  await expect(page.locator("#segments-tbody tr")).toHaveCount(1);
  await expect(page.locator("#segments-tbody")).toContainText("input[0]");
  await expect(page.locator(".notes-panel")).not.toContainText("Incomplete input");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); expect(late).toEqual([]);
});
