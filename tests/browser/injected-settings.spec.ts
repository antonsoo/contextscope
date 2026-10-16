import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const width of [1440, 375]) test(`injected prompt settings preserve cache boundaries and offline recovery at ${width}px`, async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.goto("./");
  await expect(page.locator("#pick-file-btn")).toBeVisible();
  await context.setOffline(true);
  for (const [name, reads, kind] of [
    ["format-type", [0, 0, 14130], "anthropic_output_cache_scope"],
    ["citations-tool-result", [0, 3039, 14130], "anthropic_citation_cache_scope"],
  ] as const) {
    await page.locator("#file-input").setInputFiles(`studies/injected-settings/captures/${name}.jsonl.gz`);
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.locator("table.cache tbody tr")).toHaveCount(3);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
    const report = JSON.parse(await readFile((await (await download).path())!, "utf8")) as {
      cacheSimulation: { actual: { readTokens: number }[] };
      findings: { kind: string; detail: string }[];
    };
    expect(report.cacheSimulation.actual.map(s => s.readTokens)).toEqual(reads);
    expect(report.findings.some(f => f.kind === kind)).toBe(true);
    expect(report.findings.find(f => f.kind === "anthropic_injected_prompt")?.detail).toContain("omit their overhead");
  }
  const prior = await page.locator("table.cache tbody tr").allTextContents();
  for (const name of ["mixed-document-citations", "format-with-citations"]) {
    await page.locator("#file-input").setInputFiles(`studies/injected-settings/captures/${name}.jsonl.gz`);
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.locator("#intake-error")).toContainText(/citation/i);
    expect(await page.locator("table.cache tbody tr").allTextContents()).toEqual(prior);
  }
  await page.locator("#file-input").setInputFiles("studies/injected-settings/captures/citations-empty-config.jsonl.gz");
  await expect(page.locator("#load-status")).toBeHidden();
  await expect(page.locator("table.cache tbody tr")).toHaveCount(2);
  await expect(page.locator("#intake-error")).toBeEmpty();
  expect(errors).toEqual([]);
});
