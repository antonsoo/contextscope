import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analyze.js";
import { parseOpenAiRequest } from "../src/core/parse-openai.js";
import { lookupAnthropicModel } from "../src/core/pricing.js";
import { countTokens } from "../src/core/token-counter.js";

// Each case below comes from the sampled mini-SWE-agent trajectories in studies/real-trajectories:
// the shape of the request or the number the provider reported, with the content reduced to filler.

const tail = { type: "ephemeral" } as const;
const bash = { name: "bash", description: "Execute a bash command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } };
const task = "Fix the bug described in the issue. ".repeat(400);
const output = "total 688\ndrwxrwxrwx  1 root root   4096 Sep 10 09:25 .\n".repeat(100);

/** mini-SWE-agent 2.0.0 through litellm: the marker moves to the newest tool result, which litellm
 * then sends as a list of text blocks, while the same result in later requests is a plain string. */
function step(n: number) {
  const messages: unknown[] = [{ role: "user", content: [{ type: "text", text: task }] }];
  for (let i = 0; i < n; i++) {
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: `toolu_${i}`, name: "bash", input: { command: `ls ${i}` } }] });
    const last = i === n - 1;
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `toolu_${i}`, content: last ? [{ type: "text", text: output + i }] : output + i, ...(last ? { cache_control: tail } : {}) }],
    });
  }
  return { model: "claude-sonnet-4-5-20250929", system: [{ type: "text", text: "You are a helpful assistant." }], tools: [bash], messages };
}

describe("a tool result's string content and its one-text-block form are the same prompt", () => {
  const result = analyze(JSON.stringify([step(1), step(2), step(3)]));

  it("continues the previous request through the re-serialized tool result", () => {
    expect(result.prefixMatches.map((m) => m.relation)).toEqual(["continues", "continues"]);
    const second = result.prefixMatches[1]!;
    expect(second.divergedAt?.toSegmentId).toBe("messages[5].content[0]");
  });

  it("reads the earlier request's cache and does not call the breakpoint out of the lookback window", () => {
    expect(result.cacheSimulation.actual[2]!.readTokens).toBeGreaterThan(0);
    expect(result.findings.map((f) => f.kind)).not.toContain("lookback_window_exceeded");
  });
});

describe("Claude 4.5 models", () => {
  it("are in the table with their documented minimum cacheable prefix", () => {
    expect(lookupAnthropicModel("claude-opus-4-5-20251101")?.minCacheableTokens).toBe(4096);
    expect(lookupAnthropicModel("claude-sonnet-4-5-20250929")?.minCacheableTokens).toBe(1024);
  });

  it("do not cache a prefix below the minimum, as Opus 4.5 reported on 1,400-token requests", () => {
    const request = { model: "claude-opus-4-5-20251101", system: [{ type: "text", text: "Short. ".repeat(300), cache_control: tail }], messages: [{ role: "user", content: "hi" }] };
    const result = analyze(JSON.stringify([request, request]));
    expect(result.model.id).toBe("claude-opus-4-5");
    expect(result.cacheSimulation.actual[1]!.readTokens).toBe(0);
  });
});

describe("Chat Completions framing", () => {
  it("adds 5 tokens per plain-text message, as reported by gpt-5.1 and gpt-5.2", () => {
    const messages = [
      { role: "system", content: "You are a helpful assistant that can interact multiple times with a computer shell." },
      { role: "user", content: "Please fix the failing test in the repository." },
    ];
    const parsed = parseOpenAiRequest({ model: "gpt-5.1", messages }, 0);
    const content = messages.reduce((sum, m) => sum + countTokens(m.content).openai, 0);
    expect(parsed.segments.reduce((sum, s) => sum + s.openaiTokens, 0)).toBe(content + 5 * messages.length);
  });
});
