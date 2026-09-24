/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk, 2000). Takes items with a positive
 * `value` and a container rect, returns each item's pixel rect. No dependency pulled in for
 * this - the algorithm is ~40 lines and pulling in d3-hierarchy for one layout call isn't worth
 * the bundle weight for a tool that advertises "few dependencies".
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapInput<T> {
  value: number;
  item: T;
}

export interface TreemapResult<T> {
  rect: Rect;
  item: T;
}

export function squarify<T>(items: TreemapInput<T>[], container: Rect): TreemapResult<T>[] {
  const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || positive.length === 0) return [];

  // Scale values to the container's area so worst-aspect-ratio comparisons are meaningful.
  const area = container.w * container.h;
  const scaled = positive.map((i) => ({ ...i, value: (i.value / total) * area }));

  const results: TreemapResult<T>[] = [];
  let rect = { ...container };
  let row: typeof scaled = [];
  let remaining = scaled;

  function worstRatio(currentRow: typeof scaled, length: number): number {
    const sum = currentRow.reduce((s, i) => s + i.value, 0);
    let worst = 0;
    for (const i of currentRow) {
      const side = i.value / (sum / length);
      const ratio = Math.max(side / length, length / side);
      if (ratio > worst) worst = ratio;
    }
    return worst;
  }

  function layoutRow(currentRow: typeof scaled, r: Rect): Rect {
    const sum = currentRow.reduce((s, i) => s + i.value, 0);
    const horizontal = r.w >= r.h;
    const length = horizontal ? r.h : r.w;
    const thickness = length > 0 ? sum / length : 0;
    let offset = 0;
    for (const i of currentRow) {
      const size = sum > 0 ? (i.value / sum) * length : 0;
      if (horizontal) {
        results.push({ rect: { x: r.x, y: r.y + offset, w: thickness, h: size }, item: i.item });
      } else {
        results.push({ rect: { x: r.x + offset, y: r.y, w: size, h: thickness }, item: i.item });
      }
      offset += size;
    }
    return horizontal ? { x: r.x + thickness, y: r.y, w: r.w - thickness, h: r.h } : { x: r.x, y: r.y + thickness, w: r.w, h: r.h - thickness };
  }

  while (remaining.length > 0) {
    const next = remaining[0]!;
    const candidateRow = [...row, next];
    if (row.length === 0 || worstRatio(candidateRow, Math.min(rect.w, rect.h)) <= worstRatio(row, Math.min(rect.w, rect.h))) {
      row = candidateRow;
      remaining = remaining.slice(1);
    } else {
      rect = layoutRow(row, rect);
      row = [];
    }
  }
  if (row.length > 0) layoutRow(row, rect);

  return results;
}
