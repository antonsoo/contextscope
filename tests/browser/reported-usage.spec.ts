import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const request = { model: "gpt-5.2", messages: [{ role: "user", content: "private-request-marker" }] };
const captured = (input = 42, read = 0) => ({ request, response: { usage: { prompt_tokens: input, prompt_tokens_details: { cached_tokens: read } }, content: "private-response-marker" } });

async function load(page: Page, text: string) {
  await page.getByRole("button", { name: "paste JSON" }).click();
  await page.getByRole("textbox", { name: "Request JSON or JSONL" }).fill(text);
  await page.getByRole("button", { name: "analyze", exact: true }).click();
  await expect(page.locator("#dashboard")).toHaveClass(/shown/);
  await expect(page.locator("#load-status")).toBeHidden();
}

async function scan(page: Page) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(report.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
}

test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(() => {
    const audit = { errors: [] as string[], csp: [] as string[] };
    Object.assign(window, { usageAudit: audit });
    addEventListener("error", (e) => audit.errors.push(e.message));
    addEventListener("unhandledrejection", (e) => audit.errors.push(String(e.reason)));
    addEventListener("securitypolicyviolation", (e) => audit.csp.push(e.violatedDirective));
  });
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:4320/")) throw new Error(`Unexpected external request: ${route.request().url()}`);
    await route.continue();
  });
  await page.goto("./");
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as unknown as { usageAudit: unknown }).usageAudit)).toEqual({ errors: [], csp: [] });
});

test("built-in paired capture distinguishes reported zero, missing and invalid counts; filters keep keyboard focus", async ({ page, context }) => {
  await page.getByRole("button", { name: "Reported usage: predicted hits, recorded zeroes" }).click();
  await expect(page.locator("#usage-review")).toBeVisible();
  await expect(page.locator(".usage-totals")).toContainText("4/6");
  await expect(page.locator(".usage-totals")).toContainText("3/6");
  await context.setOffline(true);
  const filter = page.locator('[data-usage-filter="simulated_hit_reported_zero"]');
  await filter.focus();
  await page.keyboard.press("Enter");
  await expect(filter).toBeFocused();
  await expect(page.locator(".usage-rows tbody tr")).toHaveCount(1);
  const row = page.getByRole("button", { name: "Inspect usage for request 2", exact: true });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(row).toBeFocused();
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".usage-evidence")).toContainText("Request 2");
  await expect(page.locator(".usage-counters")).toContainText("response.usage.prompt_tokens_details.cached_tokens");
  await expect(page.locator(".usage-counters tr").filter({ hasText: "cached_tokens" })).toContainText("0");
  await page.locator('[data-usage-filter="unavailable"]').click();
  await expect(page.locator(".usage-rows tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "Inspect usage for request 5", exact: true }).click();
  await expect(page.locator(".usage-evidence")).toContainText("cache reads or writes exceed total input tokens");
  await expect(page.locator(".usage-summary")).toContainText("Input n/a");
  await expect(page.locator(".usage-counters")).toContainText("6,001");
});

test("pagination bounds rendering while JSON and offline HTML preserve every counter and source line", async ({ page, context }, testInfo) => {
  const records = Array.from({ length: 54 }, (_, index) => captured(100 + index, index));
  const text = [JSON.stringify(records[0]), "", "{truncated", ...records.slice(1).map((r) => JSON.stringify(r))].join("\n");
  await load(page, text);
  await expect(page.locator(".usage-rows tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Next requests", exact: true }).click();
  await expect(page.locator("#usage-range")).toContainText("26-50 of 54");
  await page.getByRole("button", { name: "Next requests", exact: true }).click();
  await expect(page.locator(".usage-rows tbody tr")).toHaveCount(4);
  await page.getByRole("button", { name: "Inspect usage for request 54", exact: true }).click();
  await expect(page.locator(".usage-evidence")).toContainText("line 56");
  await context.setOffline(true);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
  const jsonText = await readFile((await (await jsonDownload).path())!, "utf8");
  expect(jsonText).not.toContain("private-request-marker");
  expect(jsonText).not.toContain("private-response-marker");
  const report = JSON.parse(jsonText);
  expect(report.usageComparison.rows).toHaveLength(54);
  expect(report.usageComparison.input.reportedTokens).toBe(6831);
  expect(report.parse.requests[53].source.line).toBe(56);
  expect(report.parse.requests[53].reportedUsage.cacheReadTokens).toBe(53);
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
  const file = testInfo.outputPath("reported-usage.html");
  await (await htmlDownload).saveAs(file);
  const html = await readFile(file, "utf8");
  expect(html).not.toMatch(/<script|private-request-marker|private-response-marker/);
  const offline = await context.newPage();
  await context.route(pathToFileURL(file).href, (route) => route.continue());
  await offline.goto(pathToFileURL(file).href);
  await offline.locator("#usage-53 summary").click();
  await expect(offline.locator("#usage-53")).toContainText("Reported input: 153");
  await expect(offline.locator("#usage-53")).toContainText("response.usage.prompt_tokens_details.cached_tokens");
  await scan(offline);
  await offline.close();
});

test("reported-usage review and counter inspector remain accessible at desktop/mobile sizes in both themes", async ({ page }) => {
  await page.getByRole("button", { name: "Reported usage: predicted hits, recorded zeroes" }).click();
  await expect(page.locator("#usage-review")).toBeVisible();
  await page.getByRole("button", { name: "Inspect usage for request 2", exact: true }).click();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      await scan(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 375) {
        expect(await page.locator(".usage-totals, .usage-rows").evaluateAll((tables) => tables.every((table) => table.scrollWidth <= table.clientWidth))).toBe(true);
        await expect(page.locator(".usage-rows th").filter({ hasText: "Reported read" })).toBeVisible();
        await expect(page.locator(".usage-rows th").filter({ hasText: "Simulated read" })).toBeVisible();
      }
      await expect(page.locator(".usage-evidence")).toContainText("Request 2");
    }
  }
});

test("a paired response survives an unanalyzable request without a fabricated zero estimate", async ({ page }) => {
  await load(page, JSON.stringify({ ...captured(), request: { model: "gpt-6-sol", messages: [] } }));
  await expect(page.locator("#usage-review")).toContainText("1 request(s) have paired usage but no analyzable prompt");
  await expect(page.locator(".usage-rows tbody tr")).toHaveCount(0);
  await expect(page.locator(".usage-summary")).toContainText("Input 42 reported / n/a estimated");
  await expect(page.locator(".usage-counters")).toContainText("response.usage.prompt_tokens_details.cached_tokens");
  await scan(page);
});
