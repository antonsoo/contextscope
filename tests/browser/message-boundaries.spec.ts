import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const root = new URL("../../studies/message-boundaries/fixtures/", import.meta.url);
const catalogue = JSON.parse(await readFile(new URL("cases.json", root), "utf8")) as { cases: { id: string; file: string; api: string; changed: boolean; requiredSegmentPath: string; expectedMatchedSegments: number }[] };
const ids = ["chat-refusal-changed", "chat-refusal-identical", "chat-empty-role", "responses-empty-role", "responses-empty-identical", "responses-empty-output-phase"];

for (const width of [375, 1440]) test(`SDK refusal and empty turns survive offline inspection and report exports at ${width}px`, async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.goto("./");
  // The existing offline workflow retains worker code after the first analysis.
  // Warm it with an ordinary request, then perform the actual imports offline.
  await page.locator("#file-input").setInputFiles({ name: "ordinary.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ model: "gpt-6-sol", input: "Public record." })) });
  await expect(page.locator("#dashboard")).toHaveClass(/shown/);
  await expect(page.locator("#load-status")).toBeHidden();
  await context.setOffline(true);
  for (const id of ids) {
    const capture = catalogue.cases.find(c => c.id === id)!;
    const bytes = await readFile(new URL(capture.file, root));
    const bodies = gunzipSync(bytes).toString("utf8").trim().split("\n").map(line => JSON.parse(line) as { messages?: unknown[]; input?: unknown[] });
    await page.locator("#file-input").setInputFiles({ name: capture.file, mimeType: "application/gzip", buffer: bytes });
    await expect(page.locator("#load-status")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Request 2 of 2", exact: true })).toBeVisible();
    await expect(page.locator(".prefix-meta")).toContainText(`${capture.expectedMatchedSegments}/4 segs`);
    const row = page.locator("#segments-tbody tr").filter({ hasText: capture.requiredSegmentPath });
    await expect(row).toHaveCount(1);
    await row.getByRole("button").click();
    const rawDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "download original raw JSON", exact: true }).click();
    const raw = JSON.parse(await readFile((await (await rawDownload).path())!, "utf8")) as unknown;
    expect(raw).toEqual(capture.api === "chat" ? bodies[1]!.messages![2] : bodies[1]!.input![1]);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const jsonDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
    const report = JSON.parse(await readFile((await (await jsonDownload).path())!, "utf8")) as { prefixMatches: { matchedSegments: number }[]; parse: { requests: { segments: { path: string }[] }[] }; cacheSimulation: { actual: { readTokens: number }[] } };
    expect(report.prefixMatches[0]!.matchedSegments).toBe(capture.expectedMatchedSegments);
    expect(report.parse.requests[1]!.segments.some(s => s.path === capture.requiredSegmentPath)).toBe(true);
    if (capture.changed) expect(report.cacheSimulation.actual[1]!.readTokens).toBe(0);
    const htmlDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
    const file = testInfo.outputPath(id + ".html");
    await (await htmlDownload).saveAs(file);
    const offline = await context.newPage();
    await offline.goto(pathToFileURL(file).href);
    const cache = offline.getByRole("group", { name: "Cache simulation", exact: true });
    await expect(cache.locator("tbody tr").nth(1).locator("td").nth(2)).toHaveText(report.cacheSimulation.actual[1]!.readTokens.toLocaleString("en-US"));
    await offline.close();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
