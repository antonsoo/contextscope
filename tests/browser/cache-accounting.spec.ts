import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { analyze } from "../../src/core/analyze.js";
import AxeBuilder from "@axe-core/playwright";

test("cache accounting survives worker analysis and offline exports; invalid replacement preserves the result", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:4320/") && !route.request().url().startsWith("file:")) throw new Error("Unexpected external request");
    await route.continue();
  });
  const compressed = await readFile("examples/anthropic-cache-breakpoints.jsonl.gz");
  const text = gunzipSync(compressed).toString();
  const expected = analyze(text).cacheSimulation;
  await page.goto("./");
  await page.locator("#file-input").setInputFiles({ name: "synthetic-cache-breakpoints.jsonl.gz", mimeType: "application/gzip", buffer: compressed });
  const row = page.locator("table.cache tbody tr").nth(1);
  await expect(row).toContainText("5,939");
  await expect(row.locator("td")).toHaveText(["req 2", "5,939", "0", "0", "0", "$0.0018"]);
  await context.setOffline(true);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await jsonDownload).path())!, "utf8"));
  expect(exported.cacheSimulation).toEqual(expected);

  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
  const htmlPath = testInfo.outputPath("cache-accounting.html");
  await (await htmlDownload).saveAs(htmlPath);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(htmlPath).href);
  await expect(offline.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr").nth(1).locator("td"))
    .toHaveText(["req 2", "5,939", "0", "0", "0", "$0.0018"]);
  await offline.close();
  await context.setOffline(false); // Only exports are offline here; routing disables the HTTP cache.

  const raw = JSON.parse(text.trim().split("\n")[1]!);
  raw.cache_control = { type: "ephemeral", ttl: "1h" }; // explicit tail says 5m
  await page.locator("#file-input").setInputFiles({ name: "conflicting-ttls.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(raw)) });
  await expect(page.locator("#intake-error")).toContainText("use different TTLs");
  await expect(row.locator("td")).toHaveText(["req 2", "5,939", "0", "0", "0", "$0.0018"]);
  await page.locator("#file-input").setInputFiles({ name: "corrected.jsonl.gz", mimeType: "application/gzip", buffer: compressed });
  await expect(page.locator("#intake-error")).toBeHidden();
  await expect(row.locator("td")).toHaveText(["req 2", "5,939", "0", "0", "0", "$0.0018"]);
  const panel = page.locator("section.panel").filter({ has: page.locator("table.cache") });
  for (const [width, theme] of [[1440, "dark"], [375, "light"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`cache-accounting-${width}.png`) });
    await page.locator("#report-exports").screenshot({ path: testInfo.outputPath(`report-exports-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
