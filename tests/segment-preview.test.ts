import { describe, expect, it } from "vitest";
import { treemapBlocks, TREEMAP_SEGMENT_LIMIT } from "../web/src/lib/segment-preview.js";
import type { Segment } from "../src/core/types.js";

describe("bounded treemap evidence", () => {
  const segments: Segment[] = Array.from({ length: 4000 }, (_, i) => ({
    id: `s${i}`, label: `segment ${i}`, category: i % 3 ? "user" : "assistant", path: `s${i}`,
    raw: `text ${i}`, text: `text ${i}`, charLength: 10,
    openaiTokens: i % 17, claudeTokensEstimate: i % 23,
  }));

  it.each(["openai", "anthropic"] as const)("preserves complete %s totals and category sums", (provider) => {
    const blocks = treemapBlocks(segments, provider);
    const count = (segment: Segment): number => provider === "openai" ? segment.openaiTokens : segment.claudeTokensEstimate;
    expect(blocks.length).toBeLessThanOrEqual(TREEMAP_SEGMENT_LIMIT + 8);
    expect(blocks.reduce((sum, block) => sum + block.value, 0)).toBe(segments.reduce((sum, segment) => sum + count(segment), 0));
    expect(blocks.reduce((sum, block) => sum + block.count, 0)).toBe(segments.filter((s) => count(s) > 0).length);
    for (const category of ["user", "assistant"]) {
      expect(blocks.filter((block) => block.category === category).reduce((sum, block) => sum + block.value, 0)).toBe(segments.filter((s) => s.category === category).reduce((sum, segment) => sum + count(segment), 0));
    }
    const individuallyShown = blocks.filter((block) => block.segment);
    expect(individuallyShown).toHaveLength(TREEMAP_SEGMENT_LIMIT);
    const largestHidden = Math.max(...segments.filter((s) => !individuallyShown.some((block) => block.id === s.id)).map(count));
    expect(individuallyShown.every((block) => block.value >= largestHidden)).toBe(true);
  });

  it("keeps small requests individually inspectable and leaves its source unchanged", () => {
    const input = segments.slice(1, 4);
    const before = structuredClone(input);
    const blocks = treemapBlocks(input, "openai");
    expect(blocks.every((block) => block.segment && block.count === 1)).toBe(true);
    expect(input).toEqual(before);
  });
});
