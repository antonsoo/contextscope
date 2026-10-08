// Run contextscope over reconstructed request sequences and write one summary
// record per request: what contextscope says next to what the provider reported.
//
//   node analyze.mjs <dist-dir> <bodies-dir> <out.jsonl> [entry ...]
//
// <dist-dir> is a compiled contextscope (dist/ of a checkout or of a tag).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const [distDir, bodiesDir, outPath, ...only] = process.argv.slice(2);
const { analyze } = await import(pathToFileURL(path.resolve(distDir, "core/index.js")).href);

const entries = (only.length ? only : fs.readdirSync(bodiesDir)).sort();
const out = fs.createWriteStream(outPath);
let nTraj = 0;
for (const entry of entries) {
  for (const f of fs.readdirSync(path.join(bodiesDir, entry)).sort()) {
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(bodiesDir, entry, f))).toString().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const meta = lines[0].meta;
    const recs = lines.slice(1);
    if (recs.some((r) => r.error)) continue;
    const input = recs.map((r) => JSON.stringify(r.body)).join("\n");
    const t0 = Date.now();
    const res = analyze(input);
    const sim = res.cacheSimulation.actual;
    for (let k = 0; k < recs.length; k++) {
      const r = recs[k];
      const rep = res.reports[k];
      const pm = res.prefixMatches.find((m) => m.toIndex === k);
      const finds = res.findings.filter((x) => x.requestIndex === k).map((x) => x.kind);
      const cat = {};
      for (const c of rep.byCategory) cat[c.category] = [c.openaiTokens, c.claudeTokensEstimate, c.segmentCount, 0];
      for (const sg of rep.segments) cat[sg.category][3] += sg.charLength;
      out.write(JSON.stringify({
        entry, traj: f.replace(".jsonl.gz", ""), k, meta_calls: meta.api_calls, n: recs.length,
        created: r.created, usage: r.usage, body_model: r.body.model,
        cs: {
          openai: rep.totals.openaiTokens, claude: rep.totals.claudeTokensEstimate, cat,
          read: sim[k].readTokens, w5: sim[k].writeTokens5m, w1: sim[k].writeTokens1h, unc: sim[k].uncachedTokens,
          rel: pm?.relation ?? null, from: pm?.fromIndex ?? null,
          matchedClaude: pm?.matchedClaudeTokensEstimate ?? null, matchedSeg: pm?.matchedSegments ?? null, nseg: rep.segments.length, matchedOpenai: pm?.matchedOpenaiTokens ?? null,
          diverged: pm?.divergedAt ? (pm.divergedAt.toSegmentId ?? null) : null,
          finds, model: res.model.id, threads: res.conversations.count,
        },
      }) + "\n");
    }
    nTraj++;
    if (nTraj % 20 === 0) console.error(nTraj, "trajectories", f, Date.now() - t0, "ms");
  }
}
out.end();
