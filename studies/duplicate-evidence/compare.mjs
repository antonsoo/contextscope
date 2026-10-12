import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const [root = "studies/duplicate-evidence", output = "/tmp/duplicate-comparison.json"] = process.argv.slice(2);
const read = (name) => JSON.parse(readFileSync(resolve(root, name)));
const before = read("before.json"), after = read("after.json");
assert.equal(before.results.length, after.results.length);
const cases = after.results.map((row, i) => {
  const old = before.results[i];
  assert.equal(row.name, old.name);
  assert.equal(row.inputSha256, old.inputSha256);
  assert.equal(row.unchangedReportSha256, old.unchangedReportSha256, row.name);
  return {
    name: row.name,
    inputSha256: row.inputSha256,
    beforeMembers: old.duplicates.map((g) => g.members.length),
    afterMembers: row.duplicates.map((g) => g.members.length),
    beforeDisplayedFindings: old.displayedFindings.length,
    afterDisplayedFindings: row.displayedFindings.length,
    nonDuplicateReportIdentical: true,
  };
});
const oldCorpus = read("corpus-before.json"), corpus = read("corpus-after.json");
assert.equal(oldCorpus.sources.length, corpus.sources.length);
assert.equal(corpus.totals.belowThreshold, 0);
assert.equal(corpus.totals.misstatedMinimum, 0);
assert.deepEqual(corpus.violations, []);
const key = (g) => JSON.stringify(g.members);
let unchangedGroups = 0;
const changes = [], kinds = { exact: 0, near: 0 };
for (let i = 0; i < corpus.sources.length; i++) {
  const { groups: oldGroups, ...oldSource } = oldCorpus.sources[i];
  const { groups, ...source } = corpus.sources[i];
  assert.deepEqual(source, oldSource);
  const oldByMembers = new Map(oldGroups.map((g) => [key(g), g]));
  for (const g of groups) {
    assert.equal(g.reportedKind, g.actualKind);
    assert.ok(g.actualMinimum >= 0.85);
    assert.ok(Math.abs(g.actualMinimum - g.reportedSimilarity) < 1e-12);
    kinds[g.reportedKind]++;
    const old = oldByMembers.get(key(g));
    if (old) {
      assert.equal(g.actualMinimum, old.actualMinimum);
      assert.equal(g.actualKind, old.actualKind);
      assert.equal(g.reviewTokens, old.reviewTokens);
      unchangedGroups++;
      oldByMembers.delete(key(g));
    } else {
      changes.push({ entry: source.entry, file: source.file, afterMembers: g.members.map((m) => m.segmentId) });
    }
  }
  for (const old of oldByMembers.values()) {
    // Only groups with independently established below-threshold pairs may change.
    assert.ok(old.actualMinimum < 0.85, source.file);
  }
}
const oldBrowser = read("browser-before.json"), browser = read("browser-after.json");
assert.equal(browser.inputSha256, oldBrowser.inputSha256);
assert.equal(browser.results.length, 4);
const browserCases = browser.results.map((r, i) => {
  assert.equal(r.engine, oldBrowser.results[i].engine);
  assert.equal(r.width, oldBrowser.results[i].width);
  assert.equal(r.serverStoppedAfterAnalysis, true);
  assert.equal(r.matchesFullCoreReport, true);
  assert.equal(r.originalHashes.length, 2);
  for (const name of ["pageErrors", "policyViolations", "lateRequests", "offlineHtmlRequests"]) assert.deepEqual(r[name], []);
  assert.ok(r.overflow <= 0 && r.htmlOverflow <= 0);
  assert.deepEqual(r.duplicates, after.results[0].duplicates);
  return { engine: r.engine, width: r.width, offlineInspectionAndDownloads: true, completeCoreReportParity: true };
});
const result = {
  cases,
  corpus: {
    snapshots: corpus.totals.snapshots,
    beforeGroups: oldCorpus.totals.groups,
    afterGroups: corpus.totals.groups,
    belowThresholdBefore: oldCorpus.totals.belowThreshold,
    belowThresholdAfter: corpus.totals.belowThreshold,
    unchangedGroups,
    correctedGroups: changes,
    kinds,
    originalAndReconstructedSourceHashesIdentical: true,
  },
  browsers: browserCases,
};
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(`${cases.length} complete non-duplicate reports identical; ${unchangedGroups} public groups unchanged, ${changes.length} corrected; ${browserCases.length} offline browser workflows`);
