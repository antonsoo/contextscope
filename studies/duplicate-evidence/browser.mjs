import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox } from "@playwright/test";
import { cases } from "./cases.mjs";
const [
  root = ".",
  output = "/tmp/duplicate-browser.json",
  mode = "verify",
  screenshots,
] = process.argv.slice(2);
const dist = resolve(root, "web/dist");
const core = await import(pathToFileURL(resolve(root, "dist/core/index.js")));
const input = JSON.stringify(cases[0].bodies[0]);
const expected = JSON.parse(core.toJsonReport(core.analyze(input)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (screenshots) await mkdir(screenshots, { recursive: true });
async function serve() {
  const server = createServer(async (request, response) => {
    const name =
      new URL(request.url, "http://localhost").pathname.replace(
        /^\/contextscope\//,
        "",
      ) || "index.html";
    const path = resolve(dist, name);
    if (!path.startsWith(dist + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const bytes = await readFile(path);
      response.writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
          }[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let stopped = false;
  return {
    url: `http://127.0.0.1:${server.address().port}/contextscope/`,
    async close() {
      if (stopped) return;
      stopped = true;
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}
const results = [];
for (const [engine, type] of Object.entries({ chromium, firefox })) {
  const browser = await type.launch();
  try {
    for (const width of [1440, 375]) {
      const artifacts = await mkdtemp(resolve(dirname(output), ".offline-"));
      const server = await serve(),
        context = await browser.newContext({
          viewport: { width, height: 950 },
        });
      try {
        const page = await context.newPage(),
          errors = [],
          lateRequests = [];
        let stopped = false;
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => {
          if (stopped && /^https?:/.test(r.url()))
            lateRequests.push(new URL(r.url()).pathname);
        });
        await page.addInitScript(() => {
          globalThis.policyViolations = [];
          globalThis.document.addEventListener("securitypolicyviolation", (e) =>
            globalThis.policyViolations.push(e.violatedDirective),
          );
        });
        await page.goto(server.url);
        await page.getByRole("button", { name: "paste JSON" }).click();
        await page
          .getByRole("textbox", { name: "Request JSON or JSONL" })
          .fill(input);
        await page
          .getByRole("button", { name: "analyze", exact: true })
          .click();
        await page.locator("#dashboard.shown").waitFor();
        await page.locator("#load-status").waitFor({ state: "hidden" });
        await page.evaluate(() => globalThis.document.fonts.ready);
        await server.close();
        stopped = true;
        const finding = page.locator(".finding").filter({
          hasText:
            mode === "baseline"
              ? /The same ~.*content appears 3 times/
              : "Similar text appears in 2 segments",
        });
        assert.equal(await finding.count(), 1);
        const findingsText = await finding.innerText();
        const panel = page.locator(".dup-list").locator("..");
        const originalHashes = [];
        if (mode !== "baseline") {
          await panel.locator("summary").focus();
          await page.keyboard.press("Enter");
          for (let i = 0; i < 2; i++) {
            const opener = panel.locator("[data-member]").nth(i);
            await opener.focus();
            await page.keyboard.press("Enter");
            await page.getByRole("dialog").waitFor();
            const pending = page.waitForEvent("download");
            await page
              .getByRole("button", { name: "download original raw JSON" })
              .click();
            const bytes = await readFile(await (await pending).path());
            assert.deepEqual(
              JSON.parse(bytes),
              cases[0].bodies[0].messages[i * 2 + 1].content[0],
            );
            originalHashes.push(sha(bytes));
            if (screenshots && i === 1)
              await page.getByRole("dialog").screenshot({
                path: resolve(screenshots, `${engine}-${width}-original.png`),
              });
            await page.keyboard.press("Escape");
            assert.equal(
              await opener.evaluate(
                (e) => e === globalThis.document.activeElement,
              ),
              true,
            );
          }
        }
        if (screenshots)
          await panel.screenshot({
            path: resolve(screenshots, `${engine}-${width}-group.png`),
          });
        const pendingJson = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Download full JSON report" })
          .click();
        const jsonBytes = await readFile(await (await pendingJson).path()),
          actual = JSON.parse(jsonBytes);
        assert.deepEqual(actual, expected);
        const pendingHtml = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Download offline HTML report" })
          .click();
        const htmlPath = await (await pendingHtml).path(),
          html = await readFile(htmlPath, "utf8");
        assert.ok(!html.includes("record_050"));
        const htmlPage = await context.newPage(),
          htmlRequests = [];
        htmlPage.on("request", (r) => {
          if (/^https?:/.test(r.url())) htmlRequests.push(r.url());
        });
        htmlPage.on("pageerror", (e) => errors.push(e.message));
        // Playwright's internal download filename has no .html suffix. Preserve
        // the user's actual report extension when reopening it as a local file.
        const offlinePath = resolve(artifacts, "report.html");
        await writeFile(offlinePath, html);
        await htmlPage.goto(pathToFileURL(offlinePath).href);
        assert.equal(await htmlPage.title(), "contextscope report — anthropic");
        const heading =
          mode === "baseline"
            ? /The same ~.*content appears 3 times/
            : "Similar text appears in 2 segments";
        assert.equal(
          await htmlPage
            .getByText(heading, { exact: mode !== "baseline" })
            .count(),
          1,
        );
        assert.equal(await htmlPage.locator("script").count(), 0);
        assert.deepEqual(htmlRequests, []);
        const overflow = await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth -
            globalThis.innerWidth,
        );
        const htmlOverflow = await htmlPage.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth -
            globalThis.innerWidth,
        );
        assert.ok(overflow <= 0 && htmlOverflow <= 0);
        const csp = await page.evaluate(() => globalThis.policyViolations);
        assert.deepEqual(errors, []);
        assert.deepEqual(lateRequests, []);
        assert.deepEqual(csp, []);
        results.push({
          engine,
          version: browser.version(),
          width,
          serverStoppedAfterAnalysis: true,
          findingsText,
          duplicates: actual.duplicates,
          matchesFullCoreReport: true,
          jsonSha256: sha(jsonBytes),
          htmlSha256: sha(html),
          originalHashes,
          overflow,
          htmlOverflow,
          pageErrors: errors,
          policyViolations: csp,
          lateRequests,
          offlineHtmlRequests: htmlRequests,
        });
      } finally {
        await context.close();
        await server.close();
        await rm(artifacts, { recursive: true });
      }
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  output,
  JSON.stringify({ mode, inputSha256: sha(input), results }, null, 2) + "\n",
);
console.log(
  `${results.length} browser/width workflows and complete core-report comparisons passed (${mode})`,
);
