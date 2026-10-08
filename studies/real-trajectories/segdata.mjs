// Dump, for every consecutive pair of requests in the reconstructed sequences, the
// segments the later request added (category, characters, symbol density) and the
// change in the provider's reported input tokens. Used by fit_estimator.py.
//   node segdata.mjs <dist-dir> <bodies-dir> <out.json>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const [distDir, bodiesDir, outPath] = process.argv.slice(2);
const { parseInput } = await import(pathToFileURL(path.resolve(distDir, "core/index.js")).href);

function density(text) {
  if (!text.length) return 0;
  let sym = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 128) { if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32)) sym++; }
    else if (!/[\p{L}\p{N}]/u.test(ch)) sym++;
  }
  return sym / text.length;
}

const out = [];
for (const entry of fs.readdirSync(bodiesDir).sort()) {
  for (const f of fs.readdirSync(path.join(bodiesDir, entry)).sort()) {
    const recs = zlib.gunzipSync(fs.readFileSync(path.join(bodiesDir, entry, f))).toString().split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(1);
    if (!recs.length || recs.some((r) => r.error)) continue;
    const parsed = parseInput(recs.map((r) => JSON.stringify(r.body)).join("\n")).requests;
    const segTable = (s) => [s.category, s.charLength, +density(s.text).toFixed(4), s.openaiTokens];
    out.push({
      entry, traj: f.replace(".jsonl.gz", ""),
      usage: recs.map((r) => r.usage),
      first: parsed[0].segments.map(segTable),
      added: parsed.slice(1).map((p, i) => p.segments.slice(parsed[i].segments.length).map(segTable)),
      nseg: parsed.map((p) => p.segments.length),
    });
  }
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.error(out.length, "trajectories");
