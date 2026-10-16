// node studies/media-accounting/benchmark.mjs BEFORE_DIST AFTER_DIST OUTPUT
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { cpus, totalmem, release } from "node:os";

const hash = value => createHash("sha256").update(value).digest("hex");
if (process.argv[2] === "--worker") {
  const { analyze } = await import(pathToFileURL(resolve(process.argv[3], "core/index.js")).href);
  const input = readFileSync(new URL("./captures/anthropic-image-transports.jsonl.gz", import.meta.url));
  const start = performance.now();
  const result = analyze(gunzipSync(input).toString());
  const milliseconds = performance.now() - start;
  console.log(JSON.stringify({ milliseconds, maxRssKiB: process.resourceUsage().maxRSS,
    totals: result.reports.map(r => r.totals), workflows: result.reports.length }));
} else {
  const [before, after, output] = process.argv.slice(2);
  const groups = { before: [], after: [] };
  for (let i = 0; i < 5; i++) for (const [phase, dist] of [["before", before], ["after", after]]) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", dist], { encoding: "utf8" });
    if (child.status !== 0) throw new Error(child.stderr);
    groups[phase].push(JSON.parse(child.stdout));
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const result = { scope: "Five alternating fresh processes per implementation. Timed gunzip plus analyze after loading the library; excludes module loading, CLI startup, browser startup and network. One controlled four-request workflow, not a general benchmark.",
    implementations: Object.fromEntries([["before", before], ["after", after]].map(([phase, dist]) => [phase,
      Object.fromEntries(["analyze.js", "parse-anthropic.js", "parse-openai.js", "media-accounting.js", "cache-anthropic.js", "cache-openai.js", "prefix.js", "report.js", "usage-comparison.js"].map(name => {
        const file = resolve(dist, "core", name); return [name, existsSync(file) ? hash(readFileSync(file)) : null];
      }))])),
    environment: { node: process.version, platform: process.platform, kernel: release(), logicalCpus: cpus().length, cpu: cpus()[0]?.model, memoryBytes: totalmem() },
    input: { file: "anthropic-image-transports.jsonl.gz", sha256: hash(readFileSync(new URL("./captures/anthropic-image-transports.jsonl.gz", import.meta.url))) },
    runs: groups, medians: Object.fromEntries(Object.entries(groups).map(([phase, runs]) => [phase, {
      milliseconds: median(runs.map(r => r.milliseconds)), maxRssKiB: median(runs.map(r => r.maxRssKiB)),
    }])) };
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.medians));
}
