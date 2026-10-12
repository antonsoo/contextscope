import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cases } from "./cases.mjs";
const [dist = "dist", output = "/tmp/duplicates.json", mode = "verify"] =
  process.argv.slice(2);
assert.ok(["verify", "baseline"].includes(mode));
const { analyze, toJsonReport, clearTokenCache } = await import(
  pathToFileURL(resolve(dist, "core/index.js")).href
);
const { groupFindings } = await import(
  pathToFileURL(resolve(dist, "core/group-findings.js")).href
);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const results = [];
for (const entry of cases) {
  const input = entry.bodies.map((body) => JSON.stringify(body)).join("\n");
  const result = analyze(input);
  const json = JSON.parse(toJsonReport(result));
  const findings = json.findings.filter((f) => f.kind === "duplicate_content");
  const displayed = groupFindings(result.findings).filter(
    (f) => f.kind === "duplicate_content",
  );
  const unchanged = {
    ...json,
    findings: json.findings.filter((f) => f.kind !== "duplicate_content"),
  };
  delete unchanged.duplicates;
  if (mode === "verify") {
    assert.equal(result.duplicates.length, entry.expected.length, entry.name);
    entry.expected.forEach((expected, i) => {
      const actual = result.duplicates[i];
      assert.equal(actual.matchKind, expected.kind, entry.name);
      assert.equal(actual.members.length, expected.members, entry.name);
      assert.ok(
        Math.abs(actual.similarity - expected.minimum) < 1e-12,
        entry.name,
      );
      assert.equal(
        actual.estimatedReviewTokens,
        actual.members.slice(1).reduce((n, m) => n + m.tokens, 0),
      );
      assert.equal("estimatedWastedTokens" in actual, false);
    });
    assert.equal(displayed.length, entry.expected.length, entry.name);
    assert.ok(findings.every((f) => f.detail.includes("not proven savings")));
  }
  results.push({
    name: entry.name,
    inputSha256: sha(input),
    expected: entry.expected,
    duplicates: json.duplicates,
    findings,
    displayedFindings: displayed,
    unchangedReportSha256: sha(JSON.stringify(unchanged)),
    fullReportSha256: sha(JSON.stringify(json)),
  });
  clearTokenCache();
}
const files = ["duplicates.js", "findings.js", "group-findings.js"];
writeFileSync(
  output,
  JSON.stringify(
    {
      node: process.version,
      mode,
      compiled: files.map((path) => ({
        path: `core/${path}`,
        sha256: sha(readFileSync(resolve(dist, "core", path))),
      })),
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(`${results.length} complete analyses captured (${mode})`);
