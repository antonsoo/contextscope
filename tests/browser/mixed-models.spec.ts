import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

test("mixed-model import, override, reset, calibration and offline exports agree", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page.getByRole("button", { name: "Model routing: same prompt, different cache minimums", exact: false }).click();
  const row = page.locator("table.cache tbody tr").nth(3);
  const expected = ["req 4", "Claude Opus 4.5", "0", "0", "0", "3,696", "$0.0185"];
  await expect(row.locator("td")).toHaveText(expected);
  await expect(page.locator("#model-select")).toHaveValue("");
  await page.locator("#model-select").selectOption("claude-sonnet-4-5");
  await expect(row.locator("td")).toHaveText(["req 4", "3,694", "0", "0", "2", "$0.0011"]);
  await expect(page.locator(".notes-panel")).toContainText("Model override applies");
  await page.locator("#model-select").selectOption("");
  await expect(row.locator("td")).toHaveText(expected);

  await page.getByRole("tab", { name: "req 4", exact: false }).click();
  await expect(page.locator("#calibrate-help")).toContainText("request 4 on Claude Opus 4.5");
  await page.getByRole("spinbutton", { name: "Measured input tokens" }).fill("3696");
  await page.getByRole("button", { name: "apply to request 4", exact: true }).click();
  await expect(page.locator(".calibrate-result")).toContainText("claude-opus-4-5");
  await expect(row.locator("td")).toHaveText(expected);
  await page.getByRole("button", { name: "undo calibration", exact: true }).click();
  await expect(page.locator(".calibrate-result")).toHaveCount(0);

  const panel = page.locator("section.panel").filter({ has: page.locator("table.cache") });
  for (const [width, theme] of [[1440, "dark"], [375, "light"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`mixed-models-${width}.png`) });
  }

  await context.setOffline(true);
  const downloadedJson = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
  const json = JSON.parse(await readFile((await (await downloadedJson).path())!, "utf8"));
  expect(json.reports.map((r: { model: { id: string } }) => r.model.id)).toEqual(["claude-sonnet-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "claude-opus-4-5", "claude-sonnet-4-5"]);
  expect(json.cacheSimulation.actual[3]).toMatchObject({ readTokens: 0, uncachedTokens: 3696, costUsd: 0.01848 });
  const downloadedHtml = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
  const htmlPath = testInfo.outputPath("mixed-models.html");
  await (await downloadedHtml).saveAs(htmlPath);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(htmlPath).href);
  await expect(offline.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr").nth(3).locator("td")).toHaveText(expected);
  expect(errors).toEqual([]);
});
