// Deterministic constructed text histories. These are not captured user traffic.
export function sparse(count) {
  return Array.from({ length: count }, (_, i) => Array.from({ length: 50 }, (_, j) =>
    `measurement_${i}_${j} at sensor_${i} returned reading_${j} with quality accepted`).join('\n'));
}

export function chain() {
  return [0, 1, 2].map(stage => Array.from({ length: 200 }, (_, i) =>
    `record_${String(i).padStart(3, '0')}=${(stage >= 1 && i >= 50 && i < 60) || (stage >= 2 && i >= 100 && i < 110) ? 'updated' : 'original'}`).join('\n'));
}

export const cases = {
  'sparse-100': () => sparse(100),
  'sparse-500': () => sparse(500),
  'sparse-2000': () => sparse(2000),
  'mixed-2000': () => {
    const blocks = sparse(2000), edits = chain();
    blocks[0] = edits[1]; blocks[800] = edits[0]; blocks[1500] = edits[2];
    blocks[1999] = blocks[42];
    return blocks;
  },
  'exact-2000': () => Array(2000).fill(sparse(1)[0]),
  'dense-250': () => Array.from({ length: 250 }, (_, i) =>
    `version_${i} ` + Array.from({ length: 200 }, (_, j) => `shared_record_${j}=original`).join(' ')),
};

export function request(blocks) {
  return { model: 'claude-sonnet-5', messages: [{ role: 'user', content: blocks.map(text => ({ type: 'text', text })) }] };
}
