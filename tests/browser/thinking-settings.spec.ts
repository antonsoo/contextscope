import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

for (const width of [1440, 375]) test(`thinking settings and empty effort messages survive offline analysis at ${width}px`, async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.goto("./");
  await expect(page.locator("#pick-file-btn")).toBeVisible();
  await context.setOffline(true);
  for (const [name, reads] of [
    ["budget-change", [0, 0, 10151]],
    ["adaptive-default", [0, 10151]],
    ["message-effort-change", [0, 10151, 10166]],
  ] as const) {
    await page.locator("#file-input").setInputFiles(`studies/thinking-settings/captures/${name}.jsonl.gz`);
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.locator("table.cache tbody tr")).toHaveCount(reads.length);
    for (let i = 0; i < reads.length; i++) await expect(page.locator("table.cache tbody tr").nth(i).locator("td").nth(1)).toHaveText(reads[i]!.toLocaleString("en-US"));
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
    const report = JSON.parse(await readFile((await (await download).path())!, "utf8")) as {
      cacheSimulation: { actual: { readTokens: number }[]; optimized: { readTokens: number }[] };
      findings: { kind: string; detail: string }[];
      parse: { requests: { segments: { path: string }[] }[] };
    };
    for (const scenario of ["actual", "optimized"] as const) expect(report.cacheSimulation[scenario].map((s) => s.readTokens)).toEqual(reads);
    if (name === "budget-change") expect(report.findings.find((f) => f.kind === "anthropic_reasoning_cache_scope")?.detail).toContain("conservatively isolates all three");
    if (name === "message-effort-change") expect(report.parse.requests[1]!.segments.some((s) => s.path === "messages[2].content")).toBe(true);
    const htmlDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
    const file = testInfo.outputPath(name + ".html");
    await (await htmlDownload).saveAs(file);
    const offline = await context.newPage();
    await offline.goto(pathToFileURL(file).href);
    await expect(offline.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr").nth(1).locator("td").nth(1)).toHaveText(reads[1]!.toLocaleString("en-US"));
    await offline.close();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
