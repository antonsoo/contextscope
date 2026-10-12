import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium, firefox } from "@playwright/test";
import { cases } from "./cases.mjs";
const [root, output, mode = "verify", screenshots] = process.argv.slice(2);
assert.ok(["baseline", "verify"].includes(mode));
const dist = resolve(root, "web/dist");
const { analyze, toJsonReport } = await import(pathToFileURL(resolve(root, "dist/core/index.js")));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const served = new Map(), results = [];
if (screenshots) await mkdir(screenshots, { recursive: true });
async function serve() {
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let closed = false;
  return {
    url: `http://127.0.0.1:${server.address().port}/contextscope/`,
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}
for (const [engine, type] of Object.entries({ chromium, firefox })) {
  const browser = await type.launch();
  try {
    for (const width of [1440, 375]) {
      const server = await serve();
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      const page = await context.newPage(), errors = [], requestsAfterLoad = [], checks = [];
      let offline = false;
      try {
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => { if (offline && /^https?:/.test(r.url())) requestsAfterLoad.push(r.url()); });
        await page.goto(server.url);
        await page.evaluate(() => {
          globalThis.numericCompletions = 0;
          new globalThis.MutationObserver((records) => {
            if (records.some((r) => r.attributeName === "hidden") && globalThis.document.querySelector("#load-status").hidden) globalThis.numericCompletions++;
          }).observe(globalThis.document.querySelector("#load-status"), { attributes: true });
        });
        async function upload(input, name, compressed = false) {
          const previous = await page.evaluate(() => globalThis.numericCompletions);
          await page.locator("#file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: compressed ? gzipSync(input) : Buffer.from(input) });
          await page.waitForFunction((n) => globalThis.numericCompletions > n, previous);
        }
        async function report() {
          const pending = page.waitForEvent("download");
          await page.getByRole("button", { name: "Download full JSON report" }).click();
          return JSON.parse(await readFile(await (await pending).path(), "utf8"));
        }
        let expected = JSON.parse(toJsonReport(analyze(cases[9].input)));
        await upload(cases[9].input, "supported.jsonl");
        await page.locator("#dashboard.shown").waitFor();
        await page.evaluate(() => globalThis.document.fonts.ready);
        assert.deepEqual(await report(), expected);
        await server.close();
        await context.setOffline(true);
        offline = true;
        const inputs = [...cases, { ...cases[0], name: "sdk-gzip", gzip: true }];
        for (const entry of inputs) {
          await upload(entry.input, entry.name + (entry.gzip ? ".gz" : ".jsonl"), entry.gzip);
          const error = await page.locator("#intake-error").isVisible() ? await page.locator("#intake-error").innerText() : null;
          const rejected = mode === "verify" && entry.rejected;
          assert.equal(!!error, rejected, entry.name);
          if (rejected) assert.match(error, /would be rounded/);
          else expected = JSON.parse(toJsonReport(analyze(entry.input)));
          const downloaded = await report();
          assert.deepEqual(downloaded, expected, entry.name);
          checks.push({ name: entry.name, rejected: !!error, error, previousReportPreserved: rejected ? true : undefined, reportSha256: sha(JSON.stringify(downloaded)) });
          if (entry.name === "sdk-jsonl" && screenshots) {
            await page.evaluate(() => globalThis.scrollTo(0, 0));
            await page.screenshot({ path: resolve(screenshots, `${mode}-${engine}-${width}.png`), fullPage: true });
          }
        }
        await page.getByRole("button", { name: "new analysis", exact: true }).click();
        await page.getByRole("button", { name: "paste JSON" }).click();
        await page.getByRole("textbox", { name: "Request JSON or JSONL" }).fill(cases[3].input);
        const previous = await page.evaluate(() => globalThis.numericCompletions);
        await page.getByRole("button", { name: "analyze", exact: true }).click();
        await page.waitForFunction((n) => globalThis.numericCompletions > n, previous);
        assert.equal(await page.locator("#intake-error").isVisible(), mode === "verify");
        assert.equal(await page.locator("#dashboard.shown").count(), mode === "verify" ? 0 : 1);
        assert.deepEqual(errors, []);
        assert.deepEqual(requestsAfterLoad, []);
        results.push({ engine, version: browser.version(), width, checks, pastedStringEnvelopeRejected: mode === "verify", errors, requestsAfterLoad });
      } finally { await server.close(); await context.close(); }
    }
  } finally { await browser.close(); }
}
await writeFile(output, JSON.stringify({ node: process.version, mode, servedAssets: [...served.values()].sort((a, b) => a.path.localeCompare(b.path)), results }, null, 2) + "\n");
console.log(`${results.length} offline browser/viewports; 13 uploads, 14 report downloads and one fresh paste per viewport (${mode})`);
