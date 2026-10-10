import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";

test("tool choice scope survives worker analysis, offline downloads, and return to an earlier scope", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:4320/") && !route.request().url().startsWith("file:")) throw new Error("Unexpected external request");
    await route.continue();
  });
  await page.goto("./");
  await page.locator("#file-input").setInputFiles("examples/anthropic-cache-settings.jsonl.gz");
  const rows = page.locator("table.cache tbody tr");
  await expect(rows.nth(1).locator("td")).toHaveText(["req 2", "2,778", "2,424", "0", "0", "$0.0099"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["req 3", "5,202", "0", "0", "0", "$0.0016"]);
  const finding = page.getByRole("button", { name: /Message cache settings changed/ });
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
  for (const scenario of ["actual", "optimized"]) expect(exported.cacheSimulation[scenario].map((s: { readTokens: number }) => s.readTokens)).toEqual([0, 2778, 5202]);
  expect(exported.findings.some((f: { kind: string }) => f.kind === "anthropic_message_cache_scope")).toBe(true);

  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
  const htmlPath = testInfo.outputPath("cache-settings.html");
  await (await htmlDownload).saveAs(htmlPath);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(htmlPath).href);
  await expect(offline.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr").nth(1).locator("td"))
    .toHaveText(["req 2", "2,778", "2,424", "0", "0", "$0.0099"]);
  await expect(offline.getByText(/Message cache settings changed/).first()).toBeVisible();
  await offline.close();

  for (const [width, theme] of [[1440, "dark"], [375, "light"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("section.panel").filter({ has: page.locator("table.cache") }).screenshot({ path: testInfo.outputPath(`cache-settings-${width}.png`) });
    await finding.locator("xpath=ancestor::section[1]").screenshot({ path: testInfo.outputPath(`cache-settings-finding-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
