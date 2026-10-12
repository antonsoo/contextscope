import { describe, expect, it } from "vitest";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { findDuplicates } from "../src/core/duplicates.js";
import { fnv1a } from "../src/core/json-utils.js";

const BIG_FILE_CONTENT = Array.from({ length: 200 }, (_, i) => `line ${i}: some repeated file content for testing duplicate detection across tool results.`).join("\n");

/** A single request whose message history contains one tool_result block per entry in `contents` -
 * duplicate detection is scoped to the LAST request's own segments (see duplicates.ts), so fixtures
 * that want to exercise it need every duplicate inside one request, the way a real agent transcript
 * accumulates repeated tool calls within its own growing history. */
function reqWithToolResults(contents: string[]) {
  const messages = contents.flatMap((content, i) => [
    { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "read_file", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content }] },
  ]);
  return parseAnthropicRequest({ model: "claude-sonnet-5", messages }, 0);
}

describe("findDuplicates", () => {
  it("groups identical large tool_result blocks repeated within one request's history", () => {
    const requests = [reqWithToolResults([BIG_FILE_CONTENT, "unrelated small output", BIG_FILE_CONTENT])];
    const groups = findDuplicates(requests);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const group = groups[0]!;
    expect(group.members).toHaveLength(2);
    expect(group.similarity).toBeGreaterThanOrEqual(0.85);
    expect(group.estimatedReviewTokens).toBeGreaterThan(0);
  });

  it("does not flag short segments even if repeated", () => {
    const requests = [reqWithToolResults(["ok", "ok"])];
    expect(findDuplicates(requests)).toHaveLength(0);
  });

  it("does not flag genuinely different large content as duplicates", () => {
    const a = Array.from({ length: 200 }, (_, i) => `alpha entry ${i} completely different wording here`).join("\n");
    const b = Array.from({ length: 200 }, (_, i) => `zeta record ${i} unrelated content about something else`).join("\n");
    const requests = [reqWithToolResults([a, b])];
    expect(findDuplicates(requests)).toHaveLength(0);
  });

  it("only scans the last request, not the whole sequence (repeated history across turns is not a duplicate)", () => {
    const turn1 = reqWithToolResults([BIG_FILE_CONTENT]);
    const turn2 = parseAnthropicRequest(
      { model: "claude-sonnet-5", messages: [...(turn1.raw as { messages: unknown[] }).messages, { role: "assistant", content: "ok" }] },
      1,
    );
    // BIG_FILE_CONTENT appears once in turn2's own history - not a duplicate on its own.
    expect(findDuplicates([turn1, turn2])).toHaveLength(0);
  });

  it("keeps every pair above the threshold, regardless of the order of an edit chain", () => {
    const snapshots = [0, 1, 2].map((stage) => Array.from({ length: 200 }, (_, i) =>
      `record_${String(i).padStart(3, "0")}=${(stage >= 1 && i >= 50 && i < 60) || (stage >= 2 && i >= 100 && i < 110) ? "updated" : "original"}`,
    ).join("\n"));
    // Each edit replaces 14 of 196 distinct five-word shingles. The disjoint
    // first-to-last edits share 168/224 = 75%; adjacent versions share 182/210.
    for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const request = reqWithToolResults(order.map(i => snapshots[i]!));
      const groups = findDuplicates([request]);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.members).toHaveLength(2);
      expect(groups[0]!.matchKind).toBe("near");
      expect(groups[0]!.similarity).toBeCloseTo(182 / 210, 14);
      const sourceIndices = groups[0]!.members.map(m => order[(Number(m.segmentId.match(/messages\[(\d+)\]/)![1]) - 1) / 2]);
      expect(sourceIndices).toContain(1);
    }
  });

  it("distinguishes identical text from perfect shingle overlap with changed repetition", () => {
    const text = "one two three four five six ".repeat(20);
    const exact = findDuplicates([reqWithToolResults([text, text])])[0]!;
    expect(exact.matchKind).toBe("exact");
    expect(exact.similarity).toBe(1);
    expect(exact.estimatedReviewTokens).toBe(exact.members[1]!.tokens);
    const near = findDuplicates([reqWithToolResults([text, text.repeat(2)])])[0]!;
    expect(near.matchKind).toBe("near");
    expect(near.similarity).toBe(1);
    expect(near.estimatedReviewTokens).toBe(near.members[1]!.tokens);
  });

  it("a short fingerprint collision cannot create a match or hide another conversation", () => {
    const prefix = `synthetic-opaque-value-${"x".repeat(190)}`;
    const a = `${prefix}41d6d051e04b0a5f`;
    const b = `${prefix}b4e1d39a5cc84eb3`;
    expect(fnv1a(a)).toBe("c4332357");
    expect(fnv1a(b)).toBe(fnv1a(a));
    expect(findDuplicates([reqWithToolResults([a, b])])).toEqual([]);
    const first = reqWithToolResults([a, a]);
    const second = { ...reqWithToolResults([b, b]), index: 1 };
    const groups = findDuplicates([first, second], [0, 1]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.members[0]!.requestIndex)).toEqual([0, 1]);
  });
});
