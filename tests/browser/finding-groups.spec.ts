import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

test("grouped messages retain their severity, meaning and request navigation offline", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page.locator("#file-input").setInputFiles("studies/finding-groups/fixtures/hidden-warning.jsonl.gz");
  const warning = page.locator(".finding.warning").filter({ hasText: "Speed pricing unavailable" });
  await expect(warning).toBeVisible();
  await expect(warning.locator(".freq")).toHaveText("(request 2)");
  await expect(page.locator(".stat-tile").filter({ hasText: "issues" }).locator(".value")).toHaveText("1 warn");
  await expect(page.locator(".finding.info").filter({ hasText: "Fast input pricing" }).locator(".freq")).toHaveText("(request 1)");

  await context.setOffline(true);
  await page.locator("#file-input").setInputFiles("studies/finding-groups/fixtures/mixed-speed.jsonl.gz");
  const variants = [
    ["Speed pricing unavailable", "warning", [3, 6]],
    ["Fast input pricing", "info", [1, 4]],
    ["Fast request modeled at standard speed", "info", [2, 5]],
  ] as const;
  for (const [title, severity, requests] of variants) {
    const group = page.locator(`.finding.${severity}`).filter({ has: page.locator(".fhead", { hasText: title }) });
    await expect(group).toHaveCount(1);
    await expect(group.locator(".occ")).toHaveText(requests.map((index) => `req ${index}`));
    const occurrence = group.getByRole("button", { name: `req ${requests[1]}`, exact: true });
    await occurrence.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { selected: true })).toContainText(`req ${requests[1]}`);
    await expect(occurrence).toBeFocused();
  }

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
  const raw = JSON.parse(await readFile((await (await jsonDownload).path())!, "utf8"));
  expect(raw.findings.filter((finding: { kind: string }) => finding.kind === "anthropic_speed")).toHaveLength(6);
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
  const htmlPath = testInfo.outputPath("finding-groups.html");
  await (await htmlDownload).saveAs(htmlPath);
  const offline = await context.newPage();
  await offline.goto(pathToFileURL(htmlPath).href);
  for (const [title, severity, requests] of variants) {
    const group = offline.locator(`.finding.${severity}`).filter({ has: offline.locator("strong", { hasText: title }) });
    await expect(group).toHaveCount(1);
    await expect(group.locator(".muted")).toHaveText(`(requests ${requests.join(", ")}, 2×)`);
  }
  await expect(offline.locator("script")).toHaveCount(0);
  await offline.close();
  expect(errors).toEqual([]);
});
