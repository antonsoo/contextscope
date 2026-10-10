import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

test("OpenAI cache modes, boundary inspection and offline exports agree", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page.getByRole("button", { name: "OpenAI cache modes: disabled, implicit, explicit", exact: false }).click();
  const table = page.locator("table.cache");
  await expect(table.locator("th")).toHaveText(["request", "mode", "read", "write 30m", "uncached", "cost"]);
  await expect(table.locator("tbody tr").nth(1).locator("td")).toHaveText(["req 2", "explicit", "0", "0", "2,404", "$0.0048"]);
  await expect(table.locator("tbody tr").nth(3).locator("td")).toHaveText(["req 4", "implicit", "0", "2,404", "0", "$0.0060"]);
  const marked = ["req 6", "explicit", "2,401", "0", "3", "$0.0005"];
  await expect(table.locator("tbody tr").nth(5).locator("td")).toHaveText(marked);
  await expect(page.locator(".notes-panel")).not.toContainText("automatic prefix caching only");
  await expect(page.getByRole("button", { name: /Shared text has no reusable cache boundary/ })).toBeVisible();
  await page.getByRole("tab", { name: "req 6", exact: false }).click();
  await expect(page.locator(".cache-flag", { hasText: "explicit" })).toBeVisible();
  await page.getByRole("button", { name: "Inspect item 1 (developer) text", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("explicit OpenAI breakpoint, 30m");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const panel = page.locator("section.panel").filter({ has: table });
  for (const [width, theme] of [[1440, "dark"], [375, "light"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`openai-cache-${width}.png`) });
  }
  await context.setOffline(true);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
  const json = JSON.parse(await readFile((await (await jsonDownload).path())!, "utf8"));
  expect(json.cacheSimulation.actual.map((s: { writeTokens30m: number }) => s.writeTokens30m)).toEqual([0, 0, 2404, 2404, 2401, 0]);
  expect(json.findings.some((f: { kind: string; requestIndex: number }) => f.kind === "openai_cache_boundary" && f.requestIndex === 3)).toBe(true);
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
  const file = testInfo.outputPath("openai-cache.html");
  await (await htmlDownload).saveAs(file);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(file).href);
  await expect(offline.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr").nth(5).locator("td")).toHaveText(marked);
  expect(errors).toEqual([]);
});
