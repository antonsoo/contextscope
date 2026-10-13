// Exhaustive greedy complete-link reference: no candidate index, rare-first
// ordering, hashes, or length filter. Compare the public result's full semantics.
// Usage: node oracle.mjs DIST OUTPUT
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chain } from './cases.mjs';

const [dist, out] = process.argv.slice(2);
const { findDuplicates } = await import(pathToFileURL(resolve(dist, 'core/duplicates.js')));
let state = 20261013;
const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
const shingle = text => {
  const words = text.trim().split(/\s+/);
  if (words.length < 5) return new Set([words.join(' ')]);
  return new Set(Array.from({ length: words.length - 4 }, (_, i) => words.slice(i, i + 5).join(' ')));
};
const score = (a, b) => {
  const overlap = [...a].filter(value => b.has(value)).length;
  return overlap / new Set([...a, ...b]).size;
};
function reference(segments) {
  const texts = [...new Set(segments.map(s => s.text))];
  const grams = texts.map(shingle), groups = [];
  for (let i = 0; i < texts.length; i++) {
    const group = groups.find(g => g.every(j => score(grams[i], grams[j]) >= 0.85));
    if (group) group.push(i); else groups.push([i]);
  }
  return groups.map(g => {
    const members = segments.filter(s => g.some(i => texts[i] === s.text));
    let minimum = 1;
    for (const i of g) for (const j of g) minimum = Math.min(minimum, score(grams[i], grams[j]));
    return { members: members.map(s => s.id), similarity: minimum, matchKind: g.length === 1 ? 'exact' : 'near',
      estimatedReviewTokens: members.slice(1).reduce((sum, s) => sum + s.claudeTokensEstimate, 0) };
  }).filter(g => g.members.length > 1).sort((a, b) => b.estimatedReviewTokens - a.estimatedReviewTokens);
}

const results = [];
for (let c = 0; c < 240; c++) {
  const count = 60 + random(45), familyCount = 2 + random(8);
  const bases = Array.from({ length: familyCount }, (_, f) => Array.from({ length: 30 + random(80) }, (_, j) => `family_${f}_token_${j}`));
  const blocks = Array.from({ length: count }, (_, i) => {
    if (i % 9 === 0) return `opaque_${c}_${i}_${'x'.repeat(220)}`;
    const words = [...bases[random(familyCount)]];
    for (let k = random(8); k > 0; k--) words[random(words.length)] = `edited_${random(20)}`;
    if (i % 13 === 0) words.push(...words);
    return words.join(i % 7 === 0 ? '\n\t' : ' ');
  });
  blocks.push(...chain());
  // Exact threshold 17 / 20, plus a different below-threshold suffix.
  const boundary = Array.from({ length: 23 }, (_, i) => `boundary_token_${i}`);
  blocks.push(boundary.join(' '), ['replacement', ...boundary.slice(1, 22)].join(' '), [...boundary.slice(0, 21), 'different_end'].join(' '));
  for (let i = blocks.length - 1; i > 0; i--) { const j = random(i + 1); [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; }
  const segments = blocks.map((text, i) => ({ id: `block-${i}`, category: 'tool_result', label: `Block ${i}`, path: '', raw: text,
    text, charLength: text.length, openaiTokens: 0, claudeTokensEstimate: 1 + random(1000) }));
  assert.ok(segments.every(s => s.charLength >= 200));
  const actual = findDuplicates([{ provider: 'anthropic', index: c, model: undefined, raw: null, segments }]).map(g => ({
    members: g.members.map(m => m.segmentId), similarity: g.similarity, matchKind: g.matchKind, estimatedReviewTokens: g.estimatedReviewTokens,
  }));
  assert.deepEqual(actual, reference(segments), `Case ${c}`);
  results.push({ case: c, segments: segments.length, uniqueTexts: new Set(blocks).size, groups: actual.length,
    outputSha256: createHash('sha256').update(JSON.stringify(actual)).digest('hex') });
}
await writeFile(out, JSON.stringify({ seed: 20261013, node: process.version, cases: results.length, mismatches: 0, results }, null, 2) + '\n');
console.log(JSON.stringify({ cases: results.length, mismatches: 0 }));
