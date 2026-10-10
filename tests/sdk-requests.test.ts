/**
 * Requests as the SDKs serialize them.
 *
 * tests/fixtures/sdk/ holds request bodies written by the real anthropic and openai Python
 * SDKs (scripts/sdk-request-bodies.py: the SDK's HTTP transport is replaced by one that
 * records the request, so the bytes are the SDK's own). The first two are the same eight-turn
 * agent loop with caching turned on in two ways: a top-level `cache_control` (automatic
 * caching), and a marker placed by hand on the last block of every request.
 */
import { describe, expect, it } from "vitest";
import { readInputFile } from "../src/cli/read-input.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";
import { analyze, parseInput } from "../src/core/analyze.js";
import { parseAnthropicRequest } from "../src/core/parse-anthropic.js";

const fixture = (name: string): string => readInputFile(`tests/fixtures/sdk/${name}.jsonl.gz`);
const ESC = String.fromCharCode(27);
const plain = (text: string): string => text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

describe("Anthropic automatic caching (top-level cache_control)", () => {
  const automatic = analyze(fixture("anthropic-automatic-caching"));
  const byHand = analyze(fixture("anthropic-tail-breakpoint"));

  it("is what the SDK sends: the marker is beside model and messages, on no block", () => {
    const requests = fixture("anthropic-automatic-caching")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(requests).toHaveLength(8);
    for (const request of requests) {
      expect(request["cache_control"]).toEqual({ type: "ephemeral" });
      expect(JSON.stringify([request["tools"], request["system"], request["messages"]])).not.toContain("cache_control");
    }
  });

  it("puts the breakpoint on the last block of each request", () => {
    for (const request of automatic.parse.requests) {
      const marked = request.segments.filter((s) => s.cacheControl);
      expect(marked).toHaveLength(1);
      expect(marked[0]).toBe(request.segments[request.segments.length - 1]);
      expect(marked[0]!.cacheControl).toEqual({ type: "ephemeral", ttl: "5m", automatic: true });
    }
  });

  it("is simulated exactly like the marker placed by hand", () => {
    // Until 0.3.1 the top-level marker was not read: nothing cached, eight warnings, and
    // $0.3134 where the same loop with a hand-placed marker costs $0.0687.
    expect(automatic.cacheSimulation.actual).toEqual(byHand.cacheSimulation.actual);
    expect(automatic.cacheSimulation.totalActualCostUsd).toBe(byHand.cacheSimulation.totalActualCostUsd);
    expect(automatic.findings).toEqual([]);
    expect(byHand.findings).toEqual([]);

    const steps = automatic.cacheSimulation.actual;
    expect(steps[0]!.readTokens).toBe(0);
    expect(steps[0]!.writeTokens5m).toBeGreaterThan(8000);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.uncachedTokens).toBe(0);
      // Each request reads everything the one before it sent, and writes its own new turn.
      expect(steps[i]!.readTokens).toBe(steps[i - 1]!.readTokens + steps[i - 1]!.writeTokens5m);
    }
    expect(automatic.cacheSimulation.totalActualCostUsd).toBeLessThan(0.1);
  });

  it("reports no structural findings without claiming observed cache hits", () => {
    const report = plain(renderTerminalReport(automatic, { verbose: false }));
    expect(report).toContain("No supported cache or duplicate-content issues detected");
    expect(report).toContain("No paired response usage");
    expect(report).not.toContain("caches cleanly");
    expect(report).not.toContain("No cache_control breakpoint set");
  });

  it("uses the top-level marker's TTL", () => {
    const request = { model: "claude-opus-5-5", cache_control: { type: "ephemeral", ttl: "1h" }, messages: [{ role: "user", content: "hello" }] };
    const [segment] = parseAnthropicRequest(request, 0).segments;
    expect(segment!.cacheControl).toEqual({ type: "ephemeral", ttl: "1h", automatic: true });
  });

  it("skips blocks that cannot carry a marker, and leaves a marked block alone", () => {
    const thinkingLast = parseAnthropicRequest(
      {
        model: "claude-opus-5-5",
        cache_control: { type: "ephemeral" },
        messages: [
          { role: "user", content: "question" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "answer" },
              { type: "thinking", thinking: "reasoning", signature: "sig" },
              { type: "text", text: "" },
            ],
          },
        ],
      },
      0,
    );
    const marked = thinkingLast.segments.filter((s) => s.cacheControl);
    expect(marked.map((s) => s.text)).toEqual(["answer"]);

    const alreadyMarked = parseAnthropicRequest(
      {
        model: "claude-opus-5-5",
        cache_control: { type: "ephemeral", ttl: "1h" },
        messages: [{ role: "user", content: [{ type: "text", text: "question", cache_control: { type: "ephemeral", ttl: "1h" } }] }],
      },
      0,
    );
    expect(alreadyMarked.segments[0]!.cacheControl).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("does nothing without it, and the finding says how to turn caching on", () => {
    const requests = fixture("anthropic-automatic-caching")
      .trim()
      .split("\n")
      .map((line) => {
        const request = JSON.parse(line) as Record<string, unknown>;
        delete request["cache_control"];
        return request;
      });
    const result = analyze(JSON.stringify(requests));
    expect(result.cacheSimulation.actual.every((step) => step.readTokens === 0 && step.writeTokens5m === 0)).toBe(true);
    const kinds = new Set(result.findings.map((f) => f.kind));
    expect(kinds).toEqual(new Set(["no_cache_control"]));
    expect(result.findings[0]!.detail).toContain('a top-level "cache_control": {"type": "ephemeral"}');
    // Four and a half times the cost of the same loop with the one line added.
    expect(result.cacheSimulation.totalActualCostUsd! / automatic.cacheSimulation.totalActualCostUsd!).toBeGreaterThan(4);
  });

  it("names the automatic breakpoint when it lands below the cacheable minimum", () => {
    const short = Array.from({ length: 3 }, (_, i) => ({
      model: "claude-opus-5-5",
      cache_control: { type: "ephemeral" },
      messages: [{ role: "user", content: `short question ${i}` }],
    }));
    const result = analyze(JSON.stringify(short));
    const finding = result.findings.find((f) => f.kind === "below_minimum_cacheable");
    expect(finding?.detail).toContain("The automatic breakpoint (top-level cache_control), which lands on");
  });
});

describe("OpenAI requests whose state is elsewhere", () => {
  it("says once that a chain of stored responses is not in the file", () => {
    const result = analyze(fixture("openai-previous-response"));
    const notes = result.parse.warnings.map((w) => w.message);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^Requests 2–6 continue a stored response or conversation \(previous_response_id, conversation\)/);
  });

  it("covers a conversation object, and a single request", () => {
    const one = parseInput(JSON.stringify({ model: "gpt-6-sol", conversation: "conv_123", input: "and then?" }));
    expect(one.warnings).toHaveLength(1);
    expect(one.warnings[0]!.message).toMatch(/^Request 1 continues a stored response or conversation/);
  });

  it("simulates hand-placed cache breakpoints without the obsolete unsupported warning", () => {
    const withBreakpoint = {
      model: "gpt-6-sol",
      prompt_cache_options: { mode: "explicit" },
      input: [{ role: "user", content: [{ type: "input_text", text: "long shared context", prompt_cache_breakpoint: { mode: "explicit" } }] }],
    };
    const result = analyze(JSON.stringify([withBreakpoint, withBreakpoint]));
    expect(result.parse.warnings).toEqual([]);
    expect(result.cacheSimulation.actual[1]!.cacheMode).toBe("explicit");
  });

  it("says that explicit mode with no breakpoint caches nothing", () => {
    const request = { model: "gpt-6-sol", prompt_cache_options: { mode: "explicit" }, input: "hello" };
    const result = analyze(JSON.stringify(request));
    expect(result.findings.find((f) => f.kind === "openai_cache_disabled")?.detail).toContain("disables cache reads and writes");
  });

  it("reuses marked multipart SDK tool outputs without crossing call identities", () => {
    const result = analyze(fixture("openai-cache-tool-output"));
    expect(result.cacheSimulation.actual.map((s) => s.readTokens)).toEqual([0, 2423, 0]); // 22 call + 2,401 reference tokens
    expect(result.parse.requests[0]!.segments.find((s) => s.path === "input[1].output[0]")?.promptCacheBreakpoint).toBe(true);
  });

  it("says nothing about an ordinary request", () => {
    const result = parseInput(JSON.stringify({ model: "gpt-6-sol", prompt_cache_key: "user-7", messages: [{ role: "user", content: "hello" }] }));
    expect(result.warnings).toEqual([]);
  });
});
