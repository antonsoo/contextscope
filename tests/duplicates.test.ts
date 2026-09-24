import { describe, expect, it } from "vitest";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { findDuplicates } from "../src/core/duplicates.js";

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
    expect(group.estimatedWastedTokens).toBeGreaterThan(0);
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
});
