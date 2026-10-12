// Component timing, excluding parsing/tokenization. Synthetic repeated settings.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [baselineDist, afterDist, output] = process.argv.slice(2);
const before = await import(
  pathToFileURL(resolve(baselineDist, "core/duplicates.js"))
);
const after = await import(
  pathToFileURL(resolve(afterDist, "core/duplicates.js"))
);
const { parseAnthropicRequest } = await import(
  pathToFileURL(resolve(afterDist, "core/parse-anthropic.js"))
);
const { estimateClaudeTokens } = await import(
  pathToFileURL(resolve(afterDist, "core/tokenize-claude.js"))
);
const text = Array.from(
  { length: 200 },
  (_, i) => `setting_${i}=example_value`,
).join("\n");
const rows = [];
for (const n of [100, 500, 1000]) {
  const request = parseAnthropicRequest(
    {
      model: "claude-sonnet-4-5",
      messages: Array.from({ length: n }, () => ({
        role: "user",
        content: text,
      })),
    },
    0,
    (content) => ({ openai: 0, claude: estimateClaudeTokens(content) }),
  );
  const samples = { before: [], after: [] };
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const [name, detector] of [
      ["before", before.findDuplicates],
      ["after", after.findDuplicates],
    ]) {
      const start = performance.now(),
        groups = detector([request]);
      samples[name].push(performance.now() - start);
      assert.equal(groups.length, 1);
      assert.equal(groups[0].members.length, n);
      assert.equal(groups[0].similarity, 1);
      if (name === "after") assert.equal(groups[0].matchKind, "exact");
    }
  }
  rows.push({
    segments: n,
    textBytesPerSegment: Buffer.byteLength(text),
    samplesMs: samples,
  });
}
const sha = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
writeFileSync(
  output,
  JSON.stringify(
    {
      node: process.version,
      workload:
        "Synthetic identical text; findDuplicates only, parsing and tokenization excluded. Not an end-to-end latency or memory measurement.",
      beforeCompiledSha256: sha(resolve(baselineDist, "core/duplicates.js")),
      afterCompiledSha256: sha(resolve(afterDist, "core/duplicates.js")),
      rows,
    },
    null,
    2,
  ) + "\n",
);
console.log(rows);
