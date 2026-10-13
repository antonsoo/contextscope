import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("near-duplicate review exposes literal edits and preserves both originals offline", async ({ page, context }) => {
  const first = Array.from({ length: 200 }, (_, i) => `setting_${i} = original`).join("\n");
  const second = first.replace("setting_50 = original", "setting_50 = changed").replace("setting_150 = original", "setting_150 = changed");
  const content = [first, second].map(text => ({ type: "text", text }));
  await page.goto("./");
  await page.locator("#file-input").setInputFiles({ name: "edits.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content }] })) });
  const panel = page.locator(".dup-list");
  await expect(panel.locator("details")).toHaveCount(1);
  await page.evaluate(async () => { await Promise.all([...document.fonts].map(face => face.load())); });
  await context.setOffline(true);
  await panel.locator("summary").click();
  await expect(panel.locator("[data-member]").nth(0)).toHaveAccessibleName(/messages\[0\]\.content\[0\]/);
  await expect(panel.locator("[data-member]").nth(1)).toHaveAccessibleName(/messages\[0\]\.content\[1\]/);
  const opener = panel.getByRole("button", { name: /^Compare / });
  await opener.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Text comparison");
  await expect(dialog.locator(".removed code")).toHaveText(["setting_50 = original [LF]", "setting_150 = original [LF]"]);
  await expect(dialog.locator(".added code")).toHaveText(["setting_50 = changed [LF]", "setting_150 = changed [LF]"]);
  for (const [i, side] of ["first", "second"].entries()) {
    const waiting = page.waitForEvent("download");
    await dialog.getByRole("button", { name: `Download ${side} original JSON`, exact: true }).click();
    expect(JSON.parse(await readFile((await (await waiting).path())!, "utf8"))).toEqual(content[i]);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
