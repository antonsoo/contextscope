import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [dist, inputs, output, mode = "verify"] = process.argv.slice(2);
assert.ok(["baseline", "verify"].includes(mode));
const { readJson } = await import(pathToFileURL(resolve(dist, "core/read-json.js")));
const results = JSON.parse(readFileSync(inputs, "utf8")).map((literal) => {
  let error;
  try { readJson(literal); } catch (e) { error = e.message; }
  return { literal, serialized: String(Number(literal)), accepted: !error, ...(error ? { error } : {}) };
});
writeFileSync(output, JSON.stringify({ node: process.version, mode, results }, null, 2) + "\n");
console.log(`${results.length} numeric round trips captured (${mode})`);
