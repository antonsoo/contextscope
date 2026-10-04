import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";

const request = (text = "private-request-marker") => ({ model: "claude-sonnet-5", system: "Keep the answer concise.", messages: [{ role: "user", content: text }] });
const sequence = Array.from({ length: 4 }, (_, i) => ({
  ...request(),
  messages: Array.from({ length: i * 2 + 1 }, (_, j) => ({ role: j % 2 ? "assistant" : "user", content: `private-request-marker turn ${j}: ${"some content ".repeat(j + 1)}` })),
}));

async function load(page: Page, body: unknown = sequence) {
  await page.getByRole("button", { name: "paste JSON" }).click();
  await page.getByRole("textbox", { name: "Request JSON or JSONL" }).fill(JSON.stringify(body));
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
    Object.assign(window, { contextscopeAudit: audit });
    addEventListener("error", (event) => audit.errors.push(event.message));
    addEventListener("unhandledrejection", (event) => audit.errors.push(String(event.reason)));
    addEventListener("securitypolicyviolation", (event) => audit.csp.push(event.violatedDirective));
  });
  await context.route("**/*", async (route) => {
    if (!route.request().url().startsWith("http://127.0.0.1:4320/")) throw new Error(`Unexpected external request: ${route.request().url()}`);
    await route.continue();
  });
  await page.goto("./");
});

test.afterEach(async ({ page }) => {
  const audit = await page.evaluate(() => (window as unknown as { contextscopeAudit: { errors: string[]; csp: string[] } }).contextscopeAudit);
  expect(audit).toEqual({ errors: [], csp: [] });
});

test("intake, desktop/mobile workspace and modal have accessible controls in both themes", async ({ page }) => {
  await scan(page);
  await load(page);
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    await scan(page);
    await page.locator(".segment-inspect").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 375, height: 812 });
    await scan(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await page.locator("#model-select").boundingBox())!.width).toBeGreaterThan(120);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

test("request tabs keep focus and show their own comparison; pair buttons navigate back", async ({ page }) => {
  await load(page);
  const tabs = page.getByRole("tab");
  await expect(tabs.nth(3)).toBeFocused();
  await expect(page.locator('[data-pair="2"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(2)).toBeFocused();
  await expect(page.locator('[data-pair="1"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#diff-view")).toContainText("no earlier request");
  await expect(page.locator('.request-tab[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("End");
  await expect(tabs.nth(3)).toBeFocused();
  const pair = page.locator('[data-pair="0"]');
  await pair.focus();
  await page.keyboard.press("Enter");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(pair).toBeFocused();
  await expect(page.getByRole("heading", { name: "Request 2 of 4", exact: true })).toBeVisible();
});

test("segment inspection contains keyboard focus and clears raw data when closed", async ({ page }) => {
  await load(page);
  const opener = page.locator(".segment-inspect").last();
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("private-request-marker");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.querySelector("dialog")!.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(page.locator("#drawer-body")).toBeEmpty();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("treemap stays inside its container after viewport changes and retains focused blocks", async ({ page }) => {
  await load(page);
  const block = page.locator(".tm-block").first();
  await block.focus();
  for (const width of [375, 960, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => page.locator("#treemap").evaluate((container) => {
      const bounds = container.getBoundingClientRect();
      return [...container.children].every((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1;
      });
    })).toBe(true);
    await expect(block).toBeFocused();
  }
});

test("calibration validates counts, applies a local scale, does not compound, and undoes", async ({ page }) => {
  await load(page);
  const original = await page.locator(".stat-tile .value").first().textContent();
  const input = page.getByRole("spinbutton", { name: "Measured input tokens" });
  const apply = page.getByRole("button", { name: "apply to request 4" });
  for (const invalid of ["", "0", "-4", "1.5", "9007199254740992"]) {
    await input.fill(invalid);
    await apply.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#calibrate-status")).toContainText("positive whole-number");
  }
  await input.fill("1000");
  await apply.click();
  await expect(page.locator(".calibrate-result")).toContainText("1,000");
  const scaled = await page.locator(".stat-tile .value").first().textContent();
  expect(scaled).not.toBe(original);
  await input.fill("1000");
  await apply.click();
  await expect(page.locator("#load-status")).toBeHidden();
  await expect(page.locator(".stat-tile .value").first()).toHaveText(scaled!);
  await page.getByRole("button", { name: "undo calibration" }).click();
  await expect(page.locator(".calibrate-result")).toHaveCount(0);
  await expect(page.locator(".stat-tile .value").first()).toHaveText(original!);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("new input clears model overrides and calibration, failed imports preserve the current analysis", async ({ page }) => {
  await load(page);
  await page.locator("#model-select").focus();
  await page.locator("#model-select").selectOption({ index: 1 });
  await expect(page.locator("#load-status")).toBeHidden();
  await expect(page.locator("#model-select")).toBeFocused();
  await page.getByRole("spinbutton", { name: "Measured input tokens" }).fill("1000");
  await page.getByRole("button", { name: "apply to request 4" }).click();
  await expect(page.locator(".calibrate-result")).toBeVisible();
  const model = await page.locator("#model-select").inputValue();
  await page.locator("#file-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.locator("#intake-error")).toContainText("Could not analyze");
  await expect(page.locator("#model-select")).toHaveValue(model);
  await expect(page.locator(".calibrate-result")).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toContainText("req 4");
  const next = { model: "gpt-6-sol", messages: [{ role: "user", content: "fresh OpenAI request" }] };
  await page.locator("#file-input").setInputFiles({ name: "next.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(next)) });
  await expect(page.getByRole("heading", { name: "Request 1 of 1", exact: true })).toBeVisible();
  await expect(page.locator(".calibrate-result")).toHaveCount(0);
  await expect(page.locator("#format-select")).toHaveValue("auto");
  await expect(page.locator("#model-select")).toHaveValue("gpt-6-sol");
  await expect(page.locator("#intake-error")).toBeHidden();
});

test("the latest chosen example wins even when an older response arrives last", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/examples/anthropic-agent-cache-bust.jsonl.gz", async (route) => {
    await gate;
    await route.fulfill({ body: JSON.stringify(sequence) }).catch(() => {});
  });
  await page.route("**/examples/openai-agent-tools-reordered.jsonl", (route) => route.fulfill({ body: JSON.stringify(request("newest-marker")) }));
  try {
    await page.getByRole("button", { name: /Cache bust:/ }).click();
    await expect(page.locator("#load-status")).toBeVisible();
    await page.getByRole("button", { name: /OpenAI: tools reordered/ }).click();
    await expect(page.getByRole("heading", { name: "Request 1 of 1", exact: true })).toBeVisible();
    release();
    await page.locator(".segment-inspect").last().click();
    await expect(page.getByRole("dialog")).toContainText("newest-marker");
    await expect(page.getByRole("tab")).toHaveCount(1);
  } finally { release(); }
});

test("cancelled example imports stay cancelled and a subsequent import recovers", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/examples/anthropic-agent-cache-bust.jsonl.gz", async (route) => {
    await gate;
    await route.fulfill({ body: JSON.stringify(sequence) }).catch(() => {});
  });
  try {
    await page.getByRole("button", { name: /Cache bust:/ }).click();
    await page.getByRole("button", { name: "cancel import" }).click();
    await expect(page.locator("#intake-error")).toHaveText("Import cancelled.");
    release();
    await load(page, request("recovered"));
    await expect(page.getByRole("tab")).toHaveCount(1);
  } finally { release(); }
});

test("reset invalidates a pending file read and clears prior request-bearing DOM", async ({ page }) => {
  await load(page);
  await page.locator(".segment-inspect").last().click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const original = File.prototype.stream;
    Object.assign(window, { restoreFileStream: () => { File.prototype.stream = original; } });
    File.prototype.stream = () => new ReadableStream<Uint8Array>();
  });
  await page.locator("#file-input").setInputFiles({ name: "stalled.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sequence)) });
  await expect(page.locator("#load-status")).toBeVisible();
  await page.getByRole("button", { name: "new analysis" }).click();
  await expect(page.locator("#content")).toBeEmpty();
  await expect(page.locator("#request-tabs")).toBeEmpty();
  await expect(page.locator("#drawer-body")).toBeEmpty();
  await expect(page.locator("#paste-area")).toHaveValue("");
  expect(await page.locator("body").textContent()).not.toContain("private-request-marker");
  await expect(page.locator("#load-status")).toBeHidden();
  await page.evaluate(() => (window as unknown as { restoreFileStream: () => void }).restoreFileStream());
  await load(page, request("after-reset"));
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("gzip files decode by bytes, oversized expansion fails cleanly, and next file works", async ({ page }) => {
  await page.locator("#file-input").setInputFiles({ name: "request", mimeType: "application/octet-stream", buffer: gzipSync(JSON.stringify(sequence)) });
  await expect(page.getByRole("tab")).toHaveCount(4);
  const bomb = gzipSync(Buffer.alloc(51 * 2 ** 20, 120));
  await page.locator("#file-input").setInputFiles({ name: "oversized.gz", mimeType: "application/gzip", buffer: bomb });
  await expect(page.locator("#intake-error")).toContainText("exceeds 50 MB");
  await expect(page.getByRole("tab")).toHaveCount(4);
  await page.locator("#file-input").setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(request())) });
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#intake-error")).toBeHidden();
});

for (const name of [/Cache bust:/, /Cache fixed:/, /Duplicate content:/, /OpenAI: tools reordered/]) {
  test(`built-in example ${name.source} loads from production assets`, async ({ page }) => {
    // Four full-rule axe scans of large examples, including both phone layouts.
    test.setTimeout(120_000);
    await page.getByRole("button", { name }).click();
    await expect(page.locator("#dashboard")).toHaveClass(/shown/);
    await expect(page.locator("#intake-error")).toBeHidden();
    await expect(page.locator(".tm-block").first()).toBeVisible();
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await scan(page);
      }
    }
  });
}

test("OpenAI logs open on the largest request by OpenAI tokens", async ({ page }) => {
  await load(page, [
    { model: "gpt-6-sol", messages: [{ role: "user", content: "x".repeat(1000) }] },
    { model: "gpt-6-sol", messages: [{ role: "user", content: "漢".repeat(400) }] },
  ]);
  await expect(page.getByRole("tab", { selected: true })).toContainText("req 2");
});

test("findings remain separate and occurrence navigation returns focus after inspection", async ({ page }) => {
  await page.getByRole("button", { name: /Duplicate content:/ }).click();
  await expect(page.locator(".finding-list > .finding")).toHaveCount(2);
  await expect(page.locator(".finding .finding")).toHaveCount(0);
  const occurrence = page.locator('.occ[data-req="2"]').first();
  await occurrence.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("req 3");
  await expect(page.locator('[data-pair="1"]')).toHaveAttribute("aria-pressed", "true");
  await expect(occurrence).toBeFocused();
  const duplicate = page.locator(".fhead").filter({ hasText: "same ~0.7k-token" });
  await duplicate.click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("req 4");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(duplicate).toBeFocused();
  await scan(page);
});

test("prefix bars render the shared fraction and use the selected provider's tokens", async ({ page }) => {
  await page.getByRole("button", { name: /OpenAI: tools reordered/ }).click();
  await expect(page.locator("#dashboard")).toHaveClass(/shown/);
  const rows = page.locator(".prefix-row");
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.first()).not.toContainText("≈");
  const bars = await rows.evaluateAll((elements) => elements.map((row) => {
    const track = row.querySelector<HTMLElement>(".prefix-bar-track")!;
    const fill = row.querySelector<HTMLElement>(".prefix-bar-fill")!;
    return { ratio: fill.getBoundingClientRect().width / track.getBoundingClientRect().width, expected: parseFloat(fill.style.width) / 100 };
  }));
  expect(bars.some((bar) => bar.expected > 0)).toBe(true);
  for (const bar of bars) expect(bar.ratio).toBeCloseTo(bar.expected, 2);
});

test("a newer paste supersedes input waiting for the analysis worker", async ({ page, context }) => {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { requested = resolve; });
  await context.route("**/assets/analysis-worker-*.js", async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "paste JSON" }).click();
    await page.locator("#paste-area").fill(JSON.stringify(sequence));
    await page.getByRole("button", { name: "analyze", exact: true }).click();
    await seen;
    await page.locator("#paste-area").fill(JSON.stringify(request("newest-paste")));
    await page.getByRole("button", { name: "analyze", exact: true }).click();
    release();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await page.locator(".segment-inspect").last().click();
    await expect(page.getByRole("dialog")).toContainText("newest-paste");
  } finally { release(); }
});

test("partial JSONL shows original lines and incomplete coverage in the workspace", async ({ page }) => {
  await page.getByRole("button", { name: "paste JSON" }).click();
  await page.locator("#paste-area").fill(`\n${JSON.stringify(request())}\n\n{broken\n${JSON.stringify(request("last valid request"))}`);
  await page.getByRole("button", { name: "analyze", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".notes-panel")).toContainText("Incomplete input");
  await expect(page.locator(".notes-panel")).toContainText("1 of 3 source records");
  await expect(page.locator(".notes-panel")).toContainText("Line 4");
  await expect(page.locator(".notes-panel")).toContainText("source record 1, line 2");
  await page.getByRole("tab").nth(1).click();
  await expect(page.locator(".notes-panel")).toContainText("source record 3, line 5");
  await page.setViewportSize({ width: 375, height: 812 });
  await scan(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("analysis workers inherit the page's off-origin network restriction", async ({ page, context }) => {
  await page.evaluate(() => {
    const original = Worker;
    Object.assign(window, { privacyProbe: undefined });
    window.Worker = class extends original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data?.privacyProbe) Object.assign(window, { privacyProbe: event.data.privacyProbe });
        });
      }
    };
  });
  await context.route("**/assets/analysis-worker-*.js", async (route) => {
    const response = await route.fetch();
    const probe = `const pendingProbeMessages = [];
      const holdProbeMessage = event => { pendingProbeMessages.push(event.data); event.stopImmediatePropagation(); };
      self.addEventListener("message", holdProbeMessage);
      await (async () => {
      let directive = "";
      self.addEventListener("securitypolicyviolation", (event) => { directive = event.effectiveDirective; });
      let blocked = false;
      try { await fetch("https://contextscope.invalid/privacy-probe"); } catch { blocked = true; }
      await new Promise(resolve => setTimeout(resolve, 0));
      self.postMessage({ type: "started", privacyProbe: { blocked, directive } });
    })();\n`;
    // Firefox delivers incoming jobs while the diagnostic's top-level await is suspended.
    // Preserve those jobs and replay them once the real handler has been installed.
    const replay = `\nself.removeEventListener("message", holdProbeMessage);
      for (const data of pendingProbeMessages) self.dispatchEvent(new MessageEvent("message", { data }));`;
    await route.fulfill({ response, body: probe + await response.text() + replay });
  });
  await load(page, request());
  await expect.poll(() => page.evaluate(() => (window as unknown as { privacyProbe: unknown }).privacyProbe)).toEqual({ blocked: true, directive: "connect-src" });
});

test("ambiguous, mixed-provider and deep imports preserve a valid report and recover", async ({ page }) => {
  await load(page);
  const invalid = [
    '{"messages":[],"messages":[]}',
    JSON.stringify([request(), { model: "gpt-6-sol", input: "different provider" }]),
    '{"model":"claude-sonnet-5","messages":[{"role":"user","content":1e-400}]}',
    `{"system":${"[".repeat(200)}0${"]".repeat(200)}}`,
  ];
  for (const text of invalid) {
    await page.locator("#file-input").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await expect(page.locator("#intake-error")).toContainText("Could not analyze");
    await expect(page.getByRole("tab")).toHaveCount(4);
    await expect(page.locator("#load-status")).toBeHidden();
  }
  await page.locator("#file-input").setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ request_body: request("recovered wrapper") })) });
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#intake-error")).toBeHidden();
});

for (const action of ["cancel", "reset"] as const) test(`${action} terminates an active computing worker and the next import recovers`, async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const OriginalWorker = Worker;
    const audit = { active: 0, terminated: 0, posts: 0, started: 0, urls: 0, revoked: 0 };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { audit.urls++; return create(blob); };
    URL.revokeObjectURL = (url) => { audit.revoked++; revoke(url); };
    Object.assign(window, { workerAudit: audit, restoreWorker: () => { window.Worker = OriginalWorker; } });
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        audit.active++;
        this.addEventListener("message", (event) => { if (event.data?.type === "started") audit.started++; });
      }
      override postMessage(message: unknown): void {
        audit.posts++;
        // Run real CPU work in the same-origin module worker, independent of main-thread timers.
        super.postMessage({ ...message as object, input: JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content: "expensive-tokenization-".repeat(700_000) }] }) });
      }
      override terminate(): void { audit.terminated++; audit.active--; super.terminate(); }
    };
  });
  await page.locator("#file-input").setInputFiles({ name: "slow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(request())) });
  await expect.poll(() => page.evaluate(() => (window as unknown as { workerAudit: { started: number } }).workerAudit.started)).toBe(1);
  await page.getByRole("button", { name: action === "cancel" ? "cancel import" : "new analysis" }).click();
  if (action === "cancel") await expect(page.locator("#intake-error")).toHaveText("Import cancelled.");
  expect(await page.evaluate(() => (window as unknown as { workerAudit: { active: number; terminated: number; urls: number; revoked: number } }).workerAudit)).toMatchObject({ active: 0, terminated: 1, urls: 1, revoked: 1 });
  await expect(page.getByRole("tab")).toHaveCount(action === "cancel" ? 4 : 0);
  await page.evaluate(() => (window as unknown as { restoreWorker: () => void }).restoreWorker());
  await page.locator("#file-input").setInputFiles({ name: "after-cancel.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(request("after computation cancellation"))) });
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator("#intake-error")).toBeHidden();
});

test("a worker script load failure reports recovery without a page exception", async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const original = Worker;
    Object.assign(window, { restoreWorker: () => { window.Worker = original; } });
    window.Worker = class extends original { constructor() { super("/contextscope/missing-worker.js", { type: "module" }); } };
  });
  await page.locator("#file-input").setInputFiles({ name: "failed-worker.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(request())) });
  await expect(page.locator("#intake-error")).toContainText("Analysis worker failed");
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.locator("#load-status")).toBeHidden();
  await page.evaluate(() => (window as unknown as { restoreWorker: () => void }).restoreWorker());
  await page.locator("#file-input").setInputFiles({ name: "after-worker-failure.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(request())) });
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("large requests keep complete totals and every segment reachable through bounded views", async ({ page }) => {
  const messages = Array.from({ length: 1205 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `segment marker ${i}` }));
  await load(page, { model: "claude-sonnet-5", messages });
  await expect(page.locator("#segments-tbody tr")).toHaveCount(100);
  expect(await page.locator(".tm-block").count()).toBeLessThanOrEqual(136);
  const blocksTotal = await page.locator(".tm-block").evaluateAll((blocks) => blocks.reduce((sum, block) => sum + Number((block as HTMLElement).dataset["tokens"]), 0));
  const displayedTotal = Number((await page.locator(".stat-tile .value").first().textContent())!.replaceAll(",", ""));
  expect(blocksTotal).toBe(displayedTotal);
  const last = page.getByRole("button", { name: "Last segment page" });
  await last.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#segments-tbody tr")).toHaveCount(5);
  await expect(page.locator("#segment-range")).toContainText("1201–1205 of 1205");
  await page.locator(".segment-inspect").last().click();
  await expect(page.getByRole("dialog")).toContainText("segment marker 1204");
  await page.keyboard.press("Escape");
  await page.locator('[data-block="other:assistant"]').click();
  await expect(page.locator("#segment-category")).toHaveValue("assistant");
  await expect(page.locator("#segment-category")).toBeFocused();
  await page.getByRole("searchbox", { name: "find label or path" }).fill("messages[1203]");
  await expect(page.locator("#segments-tbody tr")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "find label or path" }).fill("no such segment");
  await expect(page.locator("#segment-range")).toContainText("No matching segments");
  await page.getByRole("searchbox", { name: "find label or path" }).fill("");
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await scan(page);
});

test("large inspector preview is bounded and its download retains the original raw JSON", async ({ page }) => {
  const content = "raw-evidence-marker ".repeat(2500) + "complete-evidence-ending";
  const message = { role: "user", content };
  await load(page, { model: "claude-sonnet-5", messages: [message] });
  await page.locator(".segment-inspect").first().click();
  await expect(page.getByRole("dialog")).toContainText("Showing the first 20,000 characters");
  expect((await page.locator("#drawer-body pre").textContent())!.length).toBe(20_000);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "download original raw JSON" }).click();
  const download = await downloadEvent;
  const raw: unknown = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(raw).toBe(content);
  await page.keyboard.press("Escape");
  await expect(page.locator(".segment-inspect").first()).toBeFocused();
});

test("worker startup failure retains the prior report and permits retry", async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    const original = Worker;
    Object.assign(window, { restoreWorker: () => { window.Worker = original; } });
    window.Worker = function () { throw new Error("worker unavailable"); } as unknown as typeof Worker;
  });
  await page.locator("#file-input").setInputFiles({ name: "failed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(request())) });
  await expect(page.locator("#intake-error")).toContainText("Could not start local analysis");
  await expect(page.getByRole("tab")).toHaveCount(4);
  await page.evaluate(() => (window as unknown as { restoreWorker: () => void }).restoreWorker());
  await page.locator("#file-input").setInputFiles({ name: "retry.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(request())) });
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("calibration is scoped to the chosen model and provider", async ({ page }) => {
  await load(page);
  await page.getByRole("spinbutton", { name: "Measured input tokens" }).fill("1000");
  await page.getByRole("button", { name: "apply to request 4" }).click();
  await expect(page.locator(".calibrate-result")).toBeVisible();
  await page.locator("#model-select").selectOption({ index: 1 });
  await expect(page.locator(".calibrate-result")).toHaveCount(0);
  await page.getByRole("spinbutton", { name: "Measured input tokens" }).fill("2000");
  await page.getByRole("button", { name: "apply to request 4" }).click();
  await expect(page.locator(".calibrate-result")).toBeVisible();
  await page.locator("#format-select").selectOption("openai");
  await expect(page.locator("#calibrate-form")).toHaveCount(0);
  await page.locator("#format-select").selectOption("auto");
  await expect(page.locator("#calibrate-form")).toBeVisible();
  await expect(page.locator(".calibrate-result")).toHaveCount(0);
});
