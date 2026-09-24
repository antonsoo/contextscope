import { describe, expect, it } from "vitest";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";
import { computePrefixMatch } from "../src/core/prefix.js";

function req(system: string, userText: string, tools: { name: string }[] = [{ name: "get_weather" }]) {
  return {
    model: "claude-sonnet-5",
    system,
    tools: tools.map((t) => ({ name: t.name, description: "d", input_schema: { type: "object" } })),
    messages: [{ role: "user", content: userText }],
  };
}

describe("computePrefixMatch", () => {
  it("matches the full request when both are identical", () => {
    const a = parseAnthropicRequest(req("stable system prompt", "hello"), 0);
    const b = parseAnthropicRequest(req("stable system prompt", "hello"), 1);
    const match = computePrefixMatch(a, b);
    expect(match.matchedSegments).toBe(a.segments.length);
    expect(match.divergedAt).toBeUndefined();
  });

  it("breaks the prefix at the first segment that changes", () => {
    const a = parseAnthropicRequest(req("stable system prompt", "hello"), 0);
    const b = parseAnthropicRequest(req("DIFFERENT system prompt", "hello"), 1);
    const match = computePrefixMatch(a, b);
    // tools[0] still matches; system[0] is where it diverges.
    expect(match.matchedSegments).toBe(1);
    expect(match.divergedAt?.toSegmentId).toBe("system[0]");
  });

  it("breaks the prefix at position 0 when tools are reordered", () => {
    const a = parseAnthropicRequest(req("system", "hi", [{ name: "a" }, { name: "b" }]), 0);
    const b = parseAnthropicRequest(req("system", "hi", [{ name: "b" }, { name: "a" }]), 1);
    const match = computePrefixMatch(a, b);
    expect(match.matchedSegments).toBe(0);
  });

  it("normalizeVolatile ignores an embedded timestamp when matching the prefix", () => {
    const a = parseAnthropicRequest(req("Current time: 2026-09-24T10:00:00Z. Be helpful.", "hi"), 0);
    const b = parseAnthropicRequest(req("Current time: 2026-09-24T10:05:12Z. Be helpful.", "hi"), 1);
    expect(computePrefixMatch(a, b, false).matchedSegments).toBe(1); // only tools[0] matches literally
    expect(computePrefixMatch(a, b, true).matchedSegments).toBe(a.segments.length); // system matches once normalized
  });

  it("produces a diff that marks the changed segment and keeps matched ones as context", () => {
    const a = parseAnthropicRequest(req("system A", "hello"), 0);
    const b = parseAnthropicRequest(req("system B", "hello"), 1);
    const match = computePrefixMatch(a, b);
    const kinds = match.diff.map((l) => l.type);
    expect(kinds).toContain("remove");
    expect(kinds).toContain("add");
    expect(kinds).toContain("context");
  });
});
