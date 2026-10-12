import assert from "node:assert/strict";

// The exporter stamps wall-clock time. Exclude only that one known field when
// comparing independently generated reports; retain each original file hash.
export function withoutGenerationTime(html) {
  const pattern = / · generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/p>/g;
  assert.equal([...html.matchAll(pattern)].length, 1);
  return html.replace(pattern, " · generated [generation time]</p>");
}
