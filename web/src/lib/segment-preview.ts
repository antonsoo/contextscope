import type { Provider, Segment, SegmentCategory } from "@core/types.js";

export const SEGMENT_PAGE_SIZE = 100;
export const TREEMAP_SEGMENT_LIMIT = 128;
export const INSPECTOR_TEXT_LIMIT = 20_000;

export interface PreviewBlock {
  id: string;
  category: SegmentCategory;
  label: string;
  value: number;
  segment?: Segment;
  count: number;
}

/** Aggregate only the visual tail. The areas still account for every positive token. */
export function treemapBlocks(segments: Segment[], provider: Provider): PreviewBlock[] {
  const items: PreviewBlock[] = segments.map((segment) => ({
    id: segment.id, category: segment.category, label: segment.label, segment, count: 1,
    value: provider === "openai" ? segment.openaiTokens : segment.claudeTokensEstimate,
  })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const visible = items.slice(0, TREEMAP_SEGMENT_LIMIT);
  const grouped = new Map<SegmentCategory, PreviewBlock>();
  for (const item of items.slice(TREEMAP_SEGMENT_LIMIT)) {
    let group = grouped.get(item.category);
    if (!group) {
      group = { id: `other:${item.category}`, category: item.category, label: `other ${item.category} segments`, value: 0, count: 0 };
      grouped.set(item.category, group);
    }
    group.value += item.value;
    group.count++;
  }
  return [...visible, ...grouped.values()];
}
