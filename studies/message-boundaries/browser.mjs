import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { chromium, firefox } from "@playwright/test";

const [rootArg, outputArg, mode = "verify"] = process.argv.slice(2);
assert.ok(rootArg && outputArg && ["baseline", "verify"].includes(mode), "browser.mjs CHECKOUT OUTPUT_DIR [baseline|verify]");
const root = resolve(rootArg), output = resolve(outputArg), dist = resolve(root, "web/dist");
const study = dirname(fileURLToPath(import.meta.url));
const catalogue = JSON.parse(await readFile(resolve(study, "fixtures/cases.json"), "utf8"));
const ids = ["chat-refusal-changed", "chat-refusal-identical", "chat-empty-role", "responses-empty-role", "responses-empty-identical", "responses-empty-output-phase"];
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(root, "dist/core/index.js")));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const served = new Map(), captures = [];
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const name = new URL(request.url, "http://localhost").pathname.replace(/^\/contextscope\//, "") || "index.html";
  const path = resolve(dist, name);
  if (!path.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    served.set(name, { path: name, bytes: bytes.length, sha256: sha(bytes) });
    response.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" })[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/contextscope/`;
try {
  for (const [engine, type] of Object.entries({ chromium, firefox })) {
    const browser = await type.launch();
    try {
      for (const width of [1440, 375]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage(), errors = [], requestsAfterOffline = [], rows = [];
        let offline = false;
        try {
          page.on("pageerror", error => errors.push(error.message));
          page.on("request", request => { if (offline && /^https?:/.test(request.url())) requestsAfterOffline.push(request.url()); });
          await page.addInitScript(() => {
            globalThis.historyViolations = [];
            globalThis.addEventListener("securitypolicyviolation", event => globalThis.historyViolations.push(event.violatedDirective));
          });
          await page.goto(url);
          await page.evaluate(() => {
            globalThis.historyCompletions = 0;
            new globalThis.MutationObserver(records => {
              if (records.some(r => r.attributeName === "hidden") && globalThis.document.querySelector("#load-status").hidden) globalThis.historyCompletions++;
            }).observe(globalThis.document.querySelector("#load-status"), { attributes: true });
          });
          async function upload(bytes, name) {
            const previous = await page.evaluate(() => globalThis.historyCompletions);
            await page.locator("#file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: bytes });
            await page.waitForFunction(n => globalThis.historyCompletions > n, previous);
            await page.locator("#dashboard.shown").waitFor();
          }
          await upload(Buffer.from(JSON.stringify({ model: "gpt-6-sol", input: "Public record." })), "ordinary.json");
          // Font faces used only by later inspection may still be lazy after
          // the ordinary analysis. Warm them explicitly for visual comparison;
          // this does not claim a first offline inspection has every font.
          await page.evaluate(async () => {
            await Promise.all([400, 500, 600, 700].flatMap(weight => ["IBM Plex Sans", "IBM Plex Mono"].map(family => globalThis.document.fonts.load(`${weight} 16px "${family}"`, "Public record."))));
            await globalThis.document.fonts.ready;
          });
          await context.setOffline(true);
          offline = true;
          for (const id of ids) {
            const capture = catalogue.cases.find(c => c.id === id);
            const bytes = await readFile(resolve(study, "fixtures", capture.file));
            const bodies = gunzipSync(bytes).toString("utf8").trim().split("\n").map(line => JSON.parse(line));
            const expected = JSON.parse(toJsonReport(analyze(gunzipSync(bytes).toString("utf8"))));
            await upload(bytes, capture.file);
            const jsonDownload = page.waitForEvent("download");
            await page.getByRole("button", { name: "Download full JSON report", exact: true }).click();
            const actual = JSON.parse(await readFile(await (await jsonDownload).path(), "utf8"));
            assert.deepEqual(actual, expected, id + ": browser differs from same-build CLI/library");
            const sourceRow = page.locator("#segments-tbody tr").filter({ hasText: capture.requiredSegmentPath });
            const present = (await sourceRow.count()) === 1;
            let rawMatches = null;
            if (present) {
              await sourceRow.getByRole("button").click();
              const rawDownload = page.waitForEvent("download");
              await page.getByRole("button", { name: "download original raw JSON", exact: true }).click();
              const raw = JSON.parse(await readFile(await (await rawDownload).path(), "utf8"));
              const original = capture.api === "chat" ? bodies[1].messages[2] : bodies[1].input[1];
              assert.deepEqual(raw, original, id + ": original message download changed");
              rawMatches = true;
              await page.getByRole("button", { name: "Close", exact: true }).click();
            }
            const htmlDownload = page.waitForEvent("download");
            await page.getByRole("button", { name: "Download offline HTML report", exact: true }).click();
            const html = await readFile(await (await htmlDownload).path());
            const file = resolve(output, `${engine}-${width}-${id}.html`);
            await writeFile(file, html);
            const local = await context.newPage();
            local.on("pageerror", error => errors.push(error.message));
            await local.goto(pathToFileURL(file).href);
            const read = await local.getByRole("group", { name: "Cache simulation", exact: true }).locator("tbody tr").nth(1).locator("td").nth(2).innerText();
            assert.equal(read, actual.cacheSimulation.actual[1].readTokens.toLocaleString("en-US"));
            await local.close();
            const matched = actual.prefixMatches[0].matchedSegments;
            const agrees = present && matched === capture.expectedMatchedSegments && (!capture.changed || actual.cacheSimulation.actual[1].readTokens === 0);
            if (mode === "verify") assert.ok(agrees, id);
            rows.push({ id, inputSha256: sha(bytes), matchedSegments: matched, sourceUnitPresent: present, originalRawDownloadMatches: rawMatches,
              readTokens: actual.cacheSimulation.actual[1].readTokens, reportSha256: sha(JSON.stringify(actual)), offlineHtmlSha256: sha(html), offlineHtmlReadMatches: true, agrees });
            if (id === "chat-refusal-changed") {
              const panel = page.locator("section.panel").filter({ has: page.locator("#prefix-list") });
              await panel.screenshot({ path: resolve(output, `${engine}-${width}.png`) });
            }
          }
          const violations = await page.evaluate(() => globalThis.historyViolations);
          const overflow = await page.evaluate(() => Math.max(0, globalThis.document.documentElement.scrollWidth - globalThis.innerWidth));
          assert.deepEqual(errors, []); assert.deepEqual(violations, []); assert.deepEqual(requestsAfterOffline, []); assert.equal(overflow, 0);
          captures.push({ engine, browser: browser.version(), width, rows, screenshot: `${engine}-${width}.png`, errors, violations, requestsAfterOffline, overflow });
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
for (const asset of served.values()) {
  const bytes = await readFile(resolve(dist, asset.path));
  assert.equal(sha(bytes), asset.sha256); assert.equal(bytes.length, asset.bytes);
}
await writeFile(resolve(output, "browser.json"), JSON.stringify({ node: process.version, mode, servedAssets: [...served.values()].sort((a, b) => a.path.localeCompare(b.path)), captures }, null, 2) + "\n");
console.log(`Six captured SDK workflows in ${captures.length} offline engine/viewports (${mode}).`);
