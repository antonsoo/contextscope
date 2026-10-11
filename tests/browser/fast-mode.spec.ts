import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

test("processing speed preserves tool entries, prices fast input, and survives offline exports", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:4320/") && !route.request().url().startsWith("file:")) throw new Error("Unexpected external request");
    await route.continue();
  });
  await page.goto("./");
  await page.locator("#file-input").setInputFiles("examples/anthropic-fast-mode.jsonl.gz");
  const rows = page.locator("table.cache tbody tr");
  await expect(rows.nth(1).locator("td")).toHaveText(["req 2", "fast", "3,414", "5,151", "0", "0", "$0.0529"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["req 3", "standard", "8,565", "0", "0", "0", "$0.0017"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["req 4", "fast", "8,565", "0", "0", "0", "$0.0034"]);
  const finding = page.getByRole("button", { name: /Processing speed changed/ });
  await expect(finding).toBeVisible();
  await finding.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await context.setOffline(true);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await jsonDownload).path())!, "utf8"));
  for (const scenario of ["actual", "optimized"]) expect(exported.cacheSimulation[scenario].map((s: { readTokens: number }) => s.readTokens)).toEqual([0, 3414, 8565, 8565]);
  expect(exported.cacheSimulation.actual.map((s: { inputPriceMultiplier: number }) => s.inputPriceMultiplier)).toEqual([1, 2, 1, 2]);
  expect(exported.findings.some((f: { kind: string }) => f.kind === "anthropic_speed_cache_scope")).toBe(true);

  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
  const htmlPath = testInfo.outputPath("fast-mode.html");
  await (await htmlDownload).saveAs(htmlPath);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(htmlPath).href);
  await expect(offline.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr").nth(1).locator("td"))
    .toHaveText(["req 2", "fast", "3,414", "5,151", "0", "0", "$0.0529"]);
  await expect(offline.getByText(/Processing speed changed/).first()).toBeVisible();
  await offline.close();

  for (const [width, theme] of [[1440, "dark"], [375, "light"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("section.panel").filter({ has: page.locator("table.cache") }).screenshot({ path: testInfo.outputPath(`fast-mode-${width}.png`) });
    await finding.locator("xpath=ancestor::section[1]").screenshot({ path: testInfo.outputPath(`fast-mode-finding-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
