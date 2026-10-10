// node studies/openai-cache/schema-order.mjs BASELINE_DIST CURRENT_DIST OUTPUT.json
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const [baseline, current, output] = process.argv.slice(2);
const old = await import(pathToFileURL(resolve(baseline, "core/index.js")));
const now = await import(pathToFileURL(resolve(current, "core/index.js")));
const field = { type: "string" };
const body = (properties) => ({ model: "gpt-6-sol", input: "Stable evidence for the decision. ".repeat(400),
  text: { format: { type: "json_schema", name: "result", strict: true,
    schema: { type: "object", properties, required: ["evidence", "decision"], additionalProperties: false } } } });
const input = JSON.stringify([body({ evidence: field, decision: field }), body({ decision: field, evidence: field }), body({ evidence: field, decision: field })]);
const before = old.analyze(input).cacheSimulation.actual;
const after = now.analyze(input).cacheSimulation.actual;
assert.deepEqual(before.map((s) => s.readTokens), [0, 2401, 2401]);
assert.deepEqual(after.map((s) => s.readTokens), [0, 0, 2401]);
const result = { kind: "synthetic structured-output request sequence, A/B/A property order; no provider calls",
  before, after, assumption: "Changed schema order conservatively isolates the whole request; provider framing is unmeasured." };
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
