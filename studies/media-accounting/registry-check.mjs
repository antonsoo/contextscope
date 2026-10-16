// node studies/media-accounting/registry-check.mjs CONSUMER_DIR OUTPUT
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const [consumer, output] = process.argv.slice(2);
const pkg = resolve(consumer, "node_modules/@antonsoloviev/contextscope");
const metadata = JSON.parse(readFileSync(resolve(pkg, "package.json")));
assert.equal(metadata.version, "0.3.3");
const { analyze } = await import(pathToFileURL(resolve(pkg, "dist/core/index.js")).href);
const cases = ["anthropic-image-transports", "chat-image-transports"].map(name => {
  const packed = readFileSync(new URL(`./captures/${name}.jsonl.gz`, import.meta.url));
  const input = gunzipSync(packed).toString();
  const result = analyze(input);
  const totals = result.reports.map(r => r.totals);
  assert.notEqual(totals[0].claudeTokensEstimate, totals[1].claudeTokensEstimate);
  assert.notEqual(totals[0].openaiTokens, totals[1].openaiTokens);
  return { name, inputSha256: createHash("sha256").update(input).digest("hex"), totals,
    sameDecodedImageGetsDifferentCounts: true };
});
const lock = JSON.parse(readFileSync(resolve(consumer, "package-lock.json")));
const result = { scope: "Separately installed public registry 0.3.3 tarball, not the locally packed source artifact. Controlled SDK request captures; no provider token or cache measurement.",
  package: metadata.name, version: metadata.version, runtime: process.version,
  runtimeDependency: { "gpt-tokenizer": lock.packages["node_modules/gpt-tokenizer"].version }, cases };
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ version: result.version, reproduced: cases.map(c => c.name), totals: cases[0].totals }));
