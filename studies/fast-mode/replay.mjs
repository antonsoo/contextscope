// node studies/fast-mode/replay.mjs OUTPUT [DIST] [--check]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cases } from "./cases.mjs";

const [output, dist = "dist", check] = process.argv.slice(2);
const { analyze } = await import(pathToFileURL(resolve(dist, "core/index.js")).href);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const results = cases.map(({ name, requests, second, fastRate }) => {
  const input = requests.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const result = analyze(input);
  const first = result.reports[0];
  const tools = first.segments.filter((s) => s.path.startsWith("tools[")).reduce((n, s) => n + s.claudeTokensEstimate, 0);
  const full = first.totals.claudeTokensEstimate;
  const expectedReads = [0, second === "full" ? full : second === "tools" ? tools : 0, full, ...(requests.length === 4 ? [full] : [])];
  if (check === "--check") {
    for (const scenario of ["actual", "optimized"]) {
      const steps = result.cacheSimulation[scenario];
      assert.deepEqual(steps.map((s) => s.readTokens), expectedReads, `${name}: ${scenario}`);
      steps.forEach((s, i) => assert.equal(s.readTokens + s.writeTokens5m + s.writeTokens1h + s.uncachedTokens, result.reports[i].totals.claudeTokensEstimate));
      const s = steps[1];
      if (fastRate === undefined) {
        assert.equal(s.costUsd, undefined);
        assert.equal(result.cacheSimulation.totalActualCostUsd, undefined);
      } else {
        const readMultiplier = requests[1].model === "claude-opus-5-5" ? 0.05 : 0.1;
        const expected = (s.readTokens * readMultiplier + s.writeTokens5m * 1.25 + s.writeTokens1h * 2 + s.uncachedTokens) * fastRate / 1e6;
        assert(Math.abs(s.costUsd - expected) < 1e-12, `${name}: price`);
      }
    }
    assert(result.findings.some((f) => f.kind === "anthropic_speed"));
  }
  return { name, inputSha256: sha(input), expectedReads, cacheSimulation: result.cacheSimulation, prefixMatches: result.prefixMatches.map((m) => ({ from: m.fromIndex, to: m.toIndex, matchedSegments: m.matchedSegments })), speedFindings: result.findings.filter((f) => f.kind.startsWith("anthropic_speed")) };
});
const implementation = ["cache-anthropic.js", "findings.js"];
writeFileSync(output, JSON.stringify({
  synthetic: true,
  note: "Controlled request bodies and current documented Claude API rules; estimated tokens and prices, no provider requests or observed charges.",
  implementationSha256: Object.fromEntries(implementation.map((file) => [file, sha(readFileSync(resolve(dist, "core", file)))])),
  cases: results,
}, null, 2) + "\n");
console.log(JSON.stringify(results.map((r) => ({ name: r.name, reads: r.cacheSimulation.actual.map((s) => s.readTokens), costs: r.cacheSimulation.actual.map((s) => s.costUsd ?? null) }))));
