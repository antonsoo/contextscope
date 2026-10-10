// Compare two compiled versions on the same rebuilt, hash-checked Claude bodies.
// node studies/cache-accounting/compare-corpus.mjs SCRATCH BASELINE_DIST OUTPUT
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { analyze, clearTokenCache } from "../../dist/core/index.js";

const [scratch, baselineDist, output] = process.argv.slice(2);
const baseline = await import(pathToFileURL(resolve(baselineDist, "core/index.js")).href);
const reconstruction = JSON.parse(readFileSync(resolve(scratch, "reconstruction.json"), "utf8"));
const groups = {};
const changes = [];
let count = 0;
for (const source of reconstruction.sources) {
  const raw = gunzipSync(readFileSync(resolve(scratch, "bodies", source.entry, source.file.replace(".traj.json", ".jsonl.gz"))));
  if (createHash("sha256").update(raw).digest("hex") !== source.requestsSha256) throw new Error(`Rebuilt bodies changed: ${source.file}`);
  const records = raw.toString().trim().split("\n").map((line) => JSON.parse(line)).slice(1);
  const text = records.map((r) => JSON.stringify(r.body)).join("\n");
  const before = baseline.analyze(text);
  const after = analyze(text);
  const group = groups[source.entry] ??= { trajectories: 0, requests: 0, changedActualSteps: 0, changedOptimizedSteps: 0, beforeExcessSteps: 0, afterExcessSteps: 0, beforeHitAgreement: 0, afterHitAgreement: 0, reportedReadTokens: 0, beforeReadTokens: 0, afterReadTokens: 0 };
  group.trajectories++;
  group.requests += records.length;
  for (const scenario of ["actual", "optimized"]) {
    for (let i = 0; i < records.length; i++) {
      const a = before.cacheSimulation[scenario][i];
      const b = after.cacheSimulation[scenario][i];
      const expected = after.reports[i].totals.claudeTokensEstimate;
      if (before.reports[i].totals.claudeTokensEstimate !== expected) throw new Error("Estimator unexpectedly changed");
      const total = (s) => s.readTokens + s.writeTokens5m + s.writeTokens1h + s.uncachedTokens;
      if (total(a) !== expected) group.beforeExcessSteps++;
      if (total(b) !== expected) group.afterExcessSteps++;
      if (total(b) !== expected || [b.readTokens, b.writeTokens5m, b.writeTokens1h, b.uncachedTokens].some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error(`Invalid accounting: ${source.entry}/${source.file}:${i}:${scenario}`);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        group[scenario === "actual" ? "changedActualSteps" : "changedOptimizedSteps"]++;
        changes.push({ entry: source.entry, file: source.file, requestIndex: i, scenario, before: a, after: b });
      }
      if (scenario === "actual") {
        const reported = records[i].usage.cache_read;
        if (!Number.isSafeInteger(reported)) throw new Error("Missing reported read count");
        group.reportedReadTokens += reported;
        group.beforeReadTokens += a.readTokens;
        group.afterReadTokens += b.readTokens;
        group.beforeHitAgreement += Number((a.readTokens > 0) === (reported > 0));
        group.afterHitAgreement += Number((b.readTokens > 0) === (reported > 0));
      }
    }
  }
  baseline.clearTokenCache();
  clearTokenCache();
  if (++count % 10 === 0) console.log(`Compared ${count}/${reconstruction.sources.length} trajectories`);
}
const totals = Object.values(groups).reduce((total, group) => {
  for (const [key, value] of Object.entries(group)) total[key] = (total[key] ?? 0) + value;
  return total;
}, {});
writeFileSync(output, JSON.stringify({ note: "Historical bodies reconstructed by the pinned mini-SWE-agent and LiteLLM harness; no live provider calls.", manifestSha256: reconstruction.manifestSha256, totals, groups, changes, sources: reconstruction.sources }, null, 2) + "\n");
console.log(JSON.stringify(totals));
