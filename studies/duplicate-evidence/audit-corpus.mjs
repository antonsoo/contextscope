import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const [dist, scratch, repo, out] = process.argv.slice(2);
const { parseAnthropicRequest } = await import(
  pathToFileURL(resolve(dist, "core/parse-anthropic.js"))
);
const { findDuplicates } = await import(
  pathToFileURL(resolve(dist, "core/duplicates.js"))
);
const { estimateClaudeTokens } = await import(
  pathToFileURL(resolve(dist, "core/tokenize-claude.js"))
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const rec = JSON.parse(readFileSync(resolve(scratch, "reconstruction.json")));
if (
  sha(
    readFileSync(resolve(repo, "studies/real-trajectories/manifest.json")),
  ) !== rec.manifestSha256
)
  throw Error("manifest mismatch");
const grams = (text) => {
  const w = text.trim().split(/\s+/);
  return new Set(
    w.length < 5
      ? [w.join(" ")]
      : w.slice(4).map((_, i) => w.slice(i, i + 5).join(" ")),
  );
};
const result = {
  note: "Audit of the last reconstructed request per trajectory. OpenAI counting is bypassed; the unchanged Claude estimator supplies member sizes. Grouping is checked with unhashed word-shingle strings.",
  compiled: ["duplicates.js", "parse-anthropic.js", "tokenize-claude.js"].map(
    (path) => ({
      path: "core/" + path,
      sha256: sha(readFileSync(resolve(dist, "core", path))),
    }),
  ),
  sources: [],
  totals: { snapshots: 0, groups: 0, misstatedMinimum: 0, belowThreshold: 0 },
  violations: [],
};
for (const source of rec.sources) {
  const bytes = readFileSync(
    resolve(repo, "studies/real-trajectories/cache", source.entry, source.file),
  );
  if (sha(bytes) !== source.sourceSha256)
    throw Error("source mismatch " + source.file);
  const raw = gunzipSync(
    readFileSync(
      resolve(
        scratch,
        "bodies",
        source.entry,
        source.file.replace(".traj.json", ".jsonl.gz"),
      ),
    ),
  );
  if (sha(raw) !== source.requestsSha256)
    throw Error("body mismatch " + source.file);
  const rows = raw.toString().trim().split("\n").map(JSON.parse).slice(1);
  const r = parseAnthropicRequest(rows.at(-1).body, 0, (text) => ({
    openai: 0,
    claude: estimateClaudeTokens(text),
  }));
  const groups = findDuplicates([r]);
  result.totals.snapshots++;
  result.totals.groups += groups.length;
  const byId = new Map(r.segments.map((s) => [s.id, s]));
  const sourceGroups = [];
  for (const g of groups) {
    let min = 1;
    const sets = g.members.map((m) => grams(byId.get(m.segmentId).text));
    let worst = [];
    for (let i = 0; i < sets.length; i++)
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i],
          b = sets[j];
        let shared = 0;
        for (const gram of a) if (b.has(gram)) shared++;
        const sim = shared / (a.size + b.size - shared);
        if (sim < min) {
          min = sim;
          worst = [g.members[i].segmentId, g.members[j].segmentId];
        }
      }
    sourceGroups.push({
      members: g.members,
      reportedSimilarity: g.similarity,
      actualMinimum: min,
      reportedKind: g.matchKind ?? null,
      actualKind:
        new Set(g.members.map((m) => byId.get(m.segmentId).text)).size === 1
          ? "exact"
          : "near",
      reviewTokens: g.members.slice(1).reduce((n, m) => n + m.tokens, 0),
    });
    if (Math.abs(min - g.similarity) > 1e-12) result.totals.misstatedMinimum++;
    if (min < 0.85) result.totals.belowThreshold++;
    if (min < 0.85 || Math.abs(min - g.similarity) > 1e-12)
      result.violations.push({
        entry: source.entry,
        file: source.file,
        members: g.members.length,
        claimed: g.similarity,
        minimum: min,
        worst,
      });
  }
  result.sources.push({ ...source, groups: sourceGroups });
  if (result.totals.snapshots % 40 === 0) console.log(result.totals);
}
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(result.totals);
