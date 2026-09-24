import { describe, expect, it } from "vitest";
import { containsVolatilePattern, stripVolatilePatterns } from "../src/core/volatile.js";

describe("volatile pattern detection", () => {
  it.each([
    "Current time: 2026-09-24T10:00:00Z",
    "request id 550e8400-e29b-41d4-a716-446655440000",
    "epoch ms 1758700800000",
  ])("detects: %s", (text) => {
    expect(containsVolatilePattern(text)).toBe(true);
  });

  it("does not flag ordinary prose", () => {
    expect(containsVolatilePattern("You are a helpful assistant with no special instructions.")).toBe(false);
  });

  it("is not stateful across repeated calls (regression test for a lastIndex bug)", () => {
    // A `/g` regex's `.test()` remembers position across calls unless guarded - verify two
    // consecutive detections on the same matchable string both come back true.
    const text = "seen at 2026-09-24T10:00:00Z";
    expect(containsVolatilePattern(text)).toBe(true);
    expect(containsVolatilePattern(text)).toBe(true);
  });

  it("redacts every occurrence, not just the first", () => {
    const text = "a: 2026-01-01T00:00:00Z b: 2026-02-02T00:00:00Z";
    const stripped = stripVolatilePatterns(text);
    expect(stripped).not.toMatch(/2026-01-01|2026-02-02/);
    expect(stripped.match(/TIMESTAMP/g)).toHaveLength(2);
  });
});
