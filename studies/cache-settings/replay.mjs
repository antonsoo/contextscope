// node studies/cache-settings/replay.mjs OUTPUT [DIST] [--expect-repaired]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cases } from "./cases.mjs";

const [output, dist = "dist", check] = process.argv.slice(2);
const { analyze } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const results = cases.map(({ name, requests }) => {
  const text = requests.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const result = analyze(text);
  const first = result.reports[0].segments;
  const setup = first.filter((s) => !s.path.startsWith("messages[")).reduce((n, s) => n + s.claudeTokensEstimate, 0);
  const marked = first.reduce((n, s) => n + s.claudeTokensEstimate, 0);
  const expectedReads = [0, name === "choice-without-setup-marker" ? 0 : setup, marked];
  if (check === "--expect-repaired") {
    for (const scenario of ["actual", "optimized"]) {
      assert.deepEqual(result.cacheSimulation[scenario].map((s) => s.readTokens), expectedReads, `${name}: ${scenario}`);
      result.cacheSimulation[scenario].forEach((s, i) => assert.equal(s.readTokens + s.writeTokens5m + s.writeTokens1h + s.uncachedTokens, result.reports[i].totals.claudeTokensEstimate));
    }
    assert(result.findings.some((f) => f.kind === "anthropic_message_cache_scope" && f.requestIndex === 1));
  }
  return { name, inputSha256: createHash("sha256").update(text).digest("hex"), expectedReads, cacheSimulation: result.cacheSimulation, findings: result.findings, prefixMatches: result.prefixMatches };
});
const evidence = {
  synthetic: true, note: "Estimated tokens and costs under documented cache rules; no API calls or observed charges.",
  implementationSha256: Object.fromEntries(["core/cache-anthropic.js", "core/findings.js"].map((p) => [p, createHash("sha256").update(readFileSync(resolve(dist, p))).digest("hex")])),
  cases: results,
};
writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(results.map((r) => ({ name: r.name, expectedReads: r.expectedReads, actualReads: r.cacheSimulation.actual.map((s) => s.readTokens) }))));
