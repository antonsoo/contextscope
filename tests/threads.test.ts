// A request log is rarely one conversation. These are the shapes real logs have - a proxy capture
// of an agent with side requests between its turns, a gateway's log of many users, an eval run -
// and what the analysis has to say about each: the same as it says about the conversations apart.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { analyze } from "../src/core/analyze.js";
import { renderTerminalReport } from "../src/cli/terminal-report.js";
import type { AnalysisResult } from "../src/core/types.js";

const example = (name: string): string[] => {
  const bytes = readFileSync(new URL(`../examples/${name}`, import.meta.url));
  return (name.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8").trim().split("\n");
};
const fixed = example("anthropic-agent-cache-fixed.jsonl.gz");
const bust = example("anthropic-agent-cache-bust.jsonl.gz");

const run = (lines: string[]): AnalysisResult => analyze(lines.join("\n"));
const pairs = (result: AnalysisResult): string[] => result.prefixMatches.map((m) => `${m.fromIndex}>${m.toIndex}:${m.relation}`);
const kinds = (result: AnalysisResult): string[] => result.findings.map((f) => f.kind);
const cost = (result: AnalysisResult, indices: number[]): number => indices.reduce((sum, i) => sum + result.cacheSimulation.actual[i]!.costUsd!, 0);

/** A small request on another model, as an agent sends between turns (a title, a safety check). */
const side = (n: number): string =>
  JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 64, system: "Summarize the user message in five words or fewer.", messages: [{ role: "user", content: `message ${n}: please look at the checkout latency regression` }] });

/** `lines` with a side request after every second line; returns the new lines and where the originals went. */
function withSideRequests(lines: string[]): { lines: string[]; main: number[] } {
  const out: string[] = [];
  const main: number[] = [];
  lines.forEach((line, i) => {
    main.push(out.length);
    out.push(line);
    if (i % 2 === 1) out.push(side(i));
  });
  return { lines: out, main };
}

describe("a file that is one conversation", () => {
  for (const name of ["anthropic-agent-cache-bust.jsonl.gz", "anthropic-agent-cache-fixed.jsonl.gz", "anthropic-duplicate-tool-results.jsonl", "openai-agent-tools-reordered.jsonl"]) {
    it(`${name}: every request continues the one before it`, () => {
      const result = run(example(name));
      expect(result.conversations.count).toBe(1);
      expect(pairs(result)).toEqual(result.parse.requests.slice(1).map((_, i) => `${i}>${i + 1}:continues`));
    });
  }
});

describe("an agent's main loop with side requests between its turns", () => {
  const alone = run(fixed);
  const { lines, main } = withSideRequests(fixed);
  const mixed = run(lines);

  it("finds the main conversation, and each side request as one of its own", () => {
    expect(mixed.parse.requests).toHaveLength(36);
    expect(mixed.conversations.count).toBe(13);
    const byRequest = mixed.conversations.byRequest;
    expect(new Set(main.map((i) => byRequest[i])).size).toBe(1);
    // Each main request continues the main request before it, whatever lies between them.
    for (let k = 1; k < main.length; k++) {
      expect(pairs(mixed)).toContain(`${main[k - 1]}>${main[k]}:continues`);
    }
  });

  it("says about the main conversation what it says about it alone", () => {
    expect(alone.findings).toEqual([]);
    expect(mixed.findings).toEqual([]);
    expect(main.map((i) => mixed.cacheSimulation.actual[i])).toEqual(alone.cacheSimulation.actual.map((step, k) => ({ ...step, requestIndex: main[k] })));
    expect(cost(mixed, main)).toBeCloseTo(alone.cacheSimulation.totalActualCostUsd!, 10);
    // The side requests are a 27-token prompt each: nothing read, nothing written, next to nothing spent.
    const sides = mixed.parse.requests.map((_, i) => i).filter((i) => !main.includes(i));
    expect(sides).toHaveLength(12);
    for (const i of sides) expect(mixed.cacheSimulation.actual[i]).toMatchObject({ readTokens: 0, writeTokens5m: 0 });
    expect(cost(mixed, sides)).toBeLessThan(0.002);
  });

  it("still reports a cache break that is really there, once per turn and against the right request", () => {
    const broken = run(bust);
    const { lines: mixedLines, main: at } = withSideRequests(bust);
    const mixedBroken = run(mixedLines);
    const volatile = (result: AnalysisResult): number[] => result.findings.filter((f) => f.kind === "volatile_prefix").map((f) => f.requestIndex);
    expect(volatile(broken)).toHaveLength(23);
    expect(volatile(mixedBroken)).toEqual(volatile(broken).map((i) => at[i]));
    expect(new Set(kinds(mixedBroken))).toEqual(new Set(kinds(broken)));
    expect(kinds(mixedBroken)).not.toContain("model_switch");
    expect(cost(mixedBroken, at)).toBeCloseTo(broken.cacheSimulation.totalActualCostUsd!, 10);
    // The finding names the two requests of the conversation, not two neighbouring lines.
    const third = mixedBroken.findings.find((f) => f.kind === "volatile_prefix" && f.requestIndex === at[2])!;
    expect(third.detail).toContain(`differs between requests ${at[1]! + 1} and ${at[2]! + 1}`);
  });
});

describe("several conversations of one application", () => {
  /** The same agent on another task: the same tools and system prompt, another first message. */
  const otherTask = (lines: string[], task: string): string[] =>
    lines.map((line) => {
      const request = JSON.parse(line) as { messages: { role: string; content: unknown }[] };
      const first = request.messages[0]!;
      const content = Array.isArray(first.content) ? first.content.map((block: Record<string, unknown>, i: number) => (i === 0 ? { ...block, text: task } : block)) : task;
      request.messages = [{ ...first, content }, ...request.messages.slice(1)];
      return JSON.stringify(request);
    });
  const second = otherTask(fixed, "A different task entirely: audit the billing export job for timezone bugs.");

  it("two runs, one after the other: the second starts on the first one's cached setup", () => {
    const result = run([...fixed, ...second]);
    expect(result.conversations.count).toBe(2);
    expect(result.findings).toEqual([]);
    const start = result.prefixMatches.find((m) => m.toIndex === fixed.length)!;
    expect(start.relation).toBe("new_conversation");
    // Its first request reads the tools and system prompt the first run cached, and writes only its own message.
    const alone = run(second).cacheSimulation.actual[0]!;
    const here = result.cacheSimulation.actual[fixed.length]!;
    expect(alone.readTokens).toBe(0);
    expect(here.readTokens).toBeGreaterThan(7000);
    expect(here.readTokens + here.writeTokens5m).toBe(alone.writeTokens5m);
  });

  it("two runs interleaved turn by turn: each request continues its own run", () => {
    const result = run(fixed.flatMap((line, i) => [line, second[i]!]));
    expect(result.conversations.count).toBe(2);
    expect(result.findings).toEqual([]);
    expect(pairs(result).slice(0, 5)).toEqual(["0>1:new_conversation", "0>2:continues", "1>3:continues", "2>4:continues", "3>5:continues"]);
    expect(result.conversations.byRequest.slice(0, 6)).toEqual([0, 1, 0, 1, 0, 1]);
    const apart = run(fixed).cacheSimulation.totalActualCostUsd! + run(second).cacheSimulation.totalActualCostUsd!;
    // Cheaper together than apart, by what the second run reads of the first one's setup.
    expect(result.cacheSimulation.totalActualCostUsd!).toBeLessThan(apart);
    expect(result.cacheSimulation.totalActualCostUsd!).toBeGreaterThan(apart * 0.95);
  });

  it("an eval: five runs from the same first message that then go their own ways", () => {
    const system = [{ type: "text", text: "You are a careful agent. ".repeat(400), cache_control: { type: "ephemeral" } }];
    const turns = (runId: number, upTo: number) => {
      const messages: unknown[] = [{ role: "user", content: "Solve the task in the repository." }];
      for (let t = 0; t < upTo; t++) {
        messages.push({ role: "assistant", content: [{ type: "tool_use", id: `call_${runId}_${t}`, name: "shell", input: { cmd: `step ${t} of run ${runId}` } }] });
        messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `call_${runId}_${t}`, content: `output ${t} of run ${runId}` }] });
      }
      return { model: "claude-sonnet-5", system, messages };
    };
    const lines: string[] = [];
    for (let t = 0; t < 4; t++) for (let runId = 0; runId < 5; runId++) lines.push(JSON.stringify(turns(runId, t)));
    const result = run(lines);
    expect(kinds(result).filter((k) => k !== "missing_tail_breakpoint")).toEqual([]);
    // The five identical opening requests are one prefix; after that every request continues its own run.
    for (let i = 5; i < lines.length; i++) {
      const match = result.prefixMatches.find((m) => m.toIndex === i)!;
      expect(match.relation).toBe("continues");
      // Its predecessor's messages are the start of its own: the same run, or the shared opening.
      expect(match.fromIndex % 5 === i % 5 || match.fromIndex < 5).toBe(true);
      if (i >= 10) expect(match.fromIndex).toBe(i - 5);
    }
    expect(result.prefixMatches.filter((m) => m.relation === "rewrites")).toEqual([]);
  });

  it("a gateway's log: single requests of many users, a timestamp in the shared system prompt", () => {
    const request = (n: number, stamped: boolean) => ({
      model: "claude-sonnet-5",
      system: [{ type: "text", text: `${stamped ? `Now: 2026-09-24T10:${String(n).padStart(2, "0")}:00Z. ` : ""}${"Answer support questions about the product. ".repeat(300)}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `question ${n} from another user` }],
    });
    const unrelated = (n: number) => ({ model: "claude-haiku-4-5", system: `Classify ticket ${n % 2 ? "urgency" : "language"}.`, messages: [{ role: "user", content: `ticket ${n}` }] });
    const log = (stamped: boolean): string[] => Array.from({ length: 12 }, (_, n) => [JSON.stringify(request(n, stamped)), JSON.stringify(unrelated(n))]).flat();

    const clean = run(log(false));
    expect(kinds(clean)).toEqual([]);
    expect(clean.cacheSimulation.actual.filter((_, i) => i % 2 === 0).slice(1).every((step) => step.readTokens > 0)).toBe(true);

    const stamped = run(log(true));
    const volatile = stamped.findings.filter((f) => f.kind === "volatile_prefix");
    expect(volatile.map((f) => f.requestIndex)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
    expect(volatile[0]!.title).toBe("System prompt contains a value that changes every request");
    expect(kinds(stamped)).not.toContain("model_switch");
    expect(stamped.cacheSimulation.actual.filter((_, i) => i % 2 === 0).every((step) => step.readTokens === 0)).toBe(true);
    expect(stamped.cacheSimulation.totalOptimizedCostUsd!).toBeLessThan(stamped.cacheSimulation.totalActualCostUsd! * 0.5);
  });
});

describe("a conversation whose history is edited", () => {
  const system = [{ type: "text", text: "You are a careful agent. ".repeat(400), cache_control: { type: "ephemeral" } }];
  const message = (n: number) => ({ role: n % 2 ? "assistant" : "user", content: `message number ${n}, with enough words to be itself` });

  it("a sliding window is the same conversation, rewritten from its first message", () => {
    const requests = [0, 1, 2, 3].map((turn) => ({ model: "claude-sonnet-5", system, messages: [0, 1, 2, 3, 4, 5].map((k) => message(2 * turn + k)) }));
    const result = analyze(JSON.stringify(requests));
    expect(result.conversations.count).toBe(1);
    expect(pairs(result)).toEqual(["0>1:rewrites", "1>2:rewrites", "2>3:rewrites"]);
    // Only the system prompt survives as a prefix.
    expect(result.prefixMatches.map((m) => m.matchedSegments)).toEqual([1, 1, 1]);
  });

  it("a trimmed tool result is a rewrite of the request it trims, even with another conversation in between", () => {
    const history = [message(0), message(1), message(2), message(3), message(4)];
    const trimmed = [message(0), { role: "assistant", content: "[trimmed]" }, message(2), message(3), message(4), message(5)];
    const other = { model: "claude-sonnet-5", system, messages: [{ role: "user", content: "an unrelated question" }] };
    const result = analyze(JSON.stringify([{ model: "claude-sonnet-5", system, messages: history }, other, { model: "claude-sonnet-5", system, messages: trimmed }]));
    expect(pairs(result)).toEqual(["0>1:new_conversation", "0>2:rewrites"]);
    expect(result.conversations.byRequest).toEqual([0, 1, 0]);
    expect(result.prefixMatches[1]!.divergedAt).toBeDefined();
  });

  it("a model change inside a conversation is still a finding", () => {
    const first = { model: "claude-opus-5", system, messages: [message(0)] };
    const next = { model: "claude-sonnet-5-5", system, messages: [message(0), message(1), message(2)] };
    const result = analyze(JSON.stringify([first, { model: "claude-haiku-4-5", system: "Title this.", messages: [{ role: "user", content: "x" }] }, next]));
    const found = result.findings.filter((f) => f.kind === "model_switch");
    expect(found.map((f) => f.requestIndex)).toEqual([2]);
    expect(found[0]!.title).toBe("Model changed between requests 1 and 3");
    expect(found[0]!.detail).toContain("can still reuse a matching prefix");
  });
});

describe("the cache is keyed by content, not by the line before", () => {
  const big = (label: string) => [{ type: "text", text: `${label} `.repeat(1500), cache_control: { type: "ephemeral" } }];

  it("a prefix cached two requests ago is read again", () => {
    const a = { model: "claude-sonnet-5", system: big("alpha"), messages: [{ role: "user", content: "one" }] };
    const b = { model: "claude-sonnet-5", system: big("beta"), messages: [{ role: "user", content: "two" }] };
    const result = analyze(JSON.stringify([a, b, { ...a, messages: [{ role: "user", content: "three" }] }, { ...b, messages: [{ role: "user", content: "four" }] }]));
    expect(result.cacheSimulation.actual.map((step) => step.readTokens > 0)).toEqual([false, false, true, true]);
  });

  it("never across models, and missing model names do not bridge their caches", () => {
    const on = (model: string | undefined, n: number) => ({ ...(model ? { model } : {}), system: big("shared"), messages: [{ role: "user", content: `turn ${n}` }] });
    const reads = (models: (string | undefined)[]) => analyze(JSON.stringify(models.map(on)), { model: "claude-sonnet-5" }).cacheSimulation.actual.map((step) => step.readTokens > 0);
    expect(reads(["claude-sonnet-5", "claude-opus-5", "claude-sonnet-5", "claude-opus-5"])).toEqual([false, false, true, true]);
    expect(reads(["claude-sonnet-5", undefined, "claude-opus-5"])).toEqual([false, false, false]);
  });

  it("Legacy OpenAI: the longest prefix any earlier request on the model sent", () => {
    const messages = (app: string, n: number) => [{ role: "system", content: `${app} instructions. `.repeat(600) }, { role: "user", content: `turn ${n}` }];
    const result = analyze(JSON.stringify([0, 1, 2, 3, 4, 5].map((n) => ({ model: "gpt-5.2", messages: messages(n % 2 ? "second app" : "first app", n) }))));
    expect(result.cacheSimulation.actual.map((step) => step.readTokens > 0)).toEqual([false, false, true, true, true, true]);
    expect(result.conversations.count).toBe(6);
    expect(result.findings).toEqual([]);
  });
});

describe("requests with nothing in common", () => {
  it("are conversations of their own, with nothing to compare", () => {
    const result = analyze(
      JSON.stringify([
        { model: "claude-sonnet-5", system: "You translate to French.", messages: [{ role: "user", content: "hello" }] },
        { model: "claude-haiku-4-5", system: "You classify sentiment.", tools: [{ name: "label", input_schema: { type: "object" } }], messages: [{ role: "user", content: "great product" }] },
        { model: "claude-opus-5", messages: [{ role: "user", content: "write a poem" }] },
      ]),
    );
    expect(result.prefixMatches).toEqual([]);
    expect(result.conversations).toEqual({ count: 3, byRequest: [0, 1, 2] });
    expect(kinds(result).filter((k) => k !== "no_cache_control")).toEqual([]);
  });
});

describe("a long log", () => {
  it("is threaded in time that grows with its size, not with its square", () => {
    // 150 conversations of 20 turns each, interleaved: 3,000 requests.
    const conversations = 150;
    const turns = 20;
    const system = "You are a support agent. ".repeat(40);
    const lines: string[] = [];
    for (let t = 0; t < turns; t++) {
      for (let c = 0; c < conversations; c++) {
        const messages: { role: string; content: string }[] = [];
        for (let k = 0; k <= t; k++) {
          messages.push({ role: "user", content: `conversation ${c}, question ${k}` });
          if (k < t) messages.push({ role: "assistant", content: `conversation ${c}, answer ${k}` });
        }
        lines.push(JSON.stringify({ model: "claude-sonnet-5", system, messages }));
      }
    }
    const started = performance.now();
    const result = run(lines);
    const elapsed = performance.now() - started;
    expect(result.conversations.count).toBe(conversations);
    for (const match of result.prefixMatches) {
      if (match.toIndex >= conversations) expect(match.fromIndex).toBe(match.toIndex - conversations);
    }
    expect(result.prefixMatches.filter((m) => m.relation === "continues")).toHaveLength(conversations * (turns - 1));
    expect(elapsed).toBeLessThan(20_000);
  }, 60_000);
});

describe("repeated content", () => {
  const session = example("anthropic-duplicate-tool-results.jsonl");

  it("is looked for at the end of each conversation, not at the end of the file", () => {
    const alone = run(session);
    expect(alone.duplicates).toHaveLength(1);
    // A side request is the last line of the capture: the session's repeated file is still found.
    const followed = run([...session, side(0)]);
    expect(followed.duplicates).toEqual(alone.duplicates);
    expect(kinds(followed).filter((k) => k === "duplicate_content")).toHaveLength(1);
    const between = withSideRequests(session);
    expect(run(between.lines).duplicates.map((group) => group.estimatedWastedTokens)).toEqual(alone.duplicates.map((group) => group.estimatedWastedTokens));
  });

  it("is reported once when every conversation repeats the same thing in the same place", () => {
    const quoted = "The refund policy, quoted in full for reference. ".repeat(40);
    const request = (n: number) => ({ model: "claude-sonnet-5", system: [{ type: "text", text: quoted }, { type: "text", text: quoted }], messages: [{ role: "user", content: `question ${n}` }] });
    const result = analyze(JSON.stringify([0, 1, 2, 3, 4, 5].map(request)));
    expect(result.conversations.count).toBe(6);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]!.members.map((m) => m.requestIndex)).toEqual([0, 0]);
  });
});

describe("the terminal report on a file of several conversations", () => {
  const strip = (text: string): string => text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
  const section = (result: AnalysisResult): string[] => {
    const lines = strip(renderTerminalReport(result)).split("\n");
    const start = lines.indexOf("Prefix match across the sequence");
    return lines.slice(start, lines.indexOf("", start));
  };

  it("counts conversations, follow-ups and conversation starts apart", () => {
    const mixed = run(withSideRequests(fixed).lines);
    expect(strip(renderTerminalReport(mixed)).split("\n")[0]).toBe("contextscope — anthropic · 36 requests in 13 conversations (auto-detected)");
    expect(section(mixed)).toEqual([
      "Prefix match across the sequence",
      "  13 conversations in this file; each request is compared with the request it continues",
      "  all 23 follow-up requests only append to the request they continue",
      "  11 requests start a new conversation on a setup already sent",
    ]);
  });

  it("names the pairs it compared, not neighbouring lines", () => {
    const broken = section(run(withSideRequests(bust).lines));
    expect(broken[2]).toBe('  23 of 34 pairs rewrite content already sent, starting at "system block 1" (req 1 → 2 … req 34 → 35)');
    expect(broken.slice(3)).toEqual(["  0 of 23 follow-up requests only append to the request they continue", "  11 requests start a new conversation on a setup already sent"]);
  });

  it("keeps its wording for a file that is one conversation", () => {
    expect(strip(renderTerminalReport(run(fixed))).split("\n")[0]).toBe("contextscope — anthropic · 24 requests (auto-detected)");
    expect(section(run(fixed))).toEqual(["Prefix match across the sequence", "  all 23 consecutive pairs only append to the previous request"]);
    expect(section(run(bust))).toEqual([
      "Prefix match across the sequence",
      '  23 of 23 pairs rewrite content already sent, starting at "system block 1" (req 1 → 2 … req 23 → 24)',
      "  0 of 23 only append to the previous request",
    ]);
  });

  it("says nothing about follow-ups when every request starts a conversation", () => {
    const request = (n: number) => ({ model: "claude-sonnet-5", system: [{ type: "text", text: "Answer support questions. ".repeat(300), cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: `question ${n}` }] });
    expect(section(analyze(JSON.stringify([0, 1, 2, 3].map(request))))).toEqual([
      "Prefix match across the sequence",
      "  4 conversations in this file; each request is compared with the request it continues",
      "  3 requests start a new conversation on a setup already sent",
    ]);
  });
});
