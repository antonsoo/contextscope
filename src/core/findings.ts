import type { CacheSimulation, DuplicateGroup, Finding, ParsedRequest, PrefixMatch, Provider, Segment } from "./types.js";
import { canonicalJson, isRecord, keyOrderFingerprint } from "./json-utils.js";
import { ANTHROPIC_LOOKBACK_POSITIONS, findAnthropicModel, resolveModel } from "./pricing.js";
import { openAiCachePlan, openAiCacheScope } from "./openai-breakpoints.js";
import { containsVolatilePattern } from "./volatile.js";
import { sameModel } from "./model-id.js";
import { comparisonKeys } from "./prefix.js";
import { anthropicPositions } from "./anthropic-breakpoints.js";

function push(list: Finding[], f: Finding): void {
  list.push(f);
}

function toolSegments(request: ParsedRequest): Segment[] {
  return request.segments.filter((s) => s.category === "tools");
}

// A gap between actual and optimized cost below this fraction isn't worth a finding of its own -
// matches the ">10%" bar findings.test.ts and the CLI/web "potential savings" framing both use,
// so "no findings" and "no material savings shown" always agree (see missing_tail_breakpoint below).
const MATERIAL_SAVINGS_RATIO = 0.1;

// Finding kinds that already explain *why* a request's cache isn't paying off - if one of these
// already fired for a request, missing_tail_breakpoint would just be restating the same gap in
// different words, so it's skipped there.
const EXPLAINS_CACHE_GAP: ReadonlySet<Finding["kind"]> = new Set(["volatile_prefix", "breakpoint_before_change", "no_cache_control", "below_minimum_cacheable", "model_switch"]);

/** Only the window of positions that moved: "positions 2-3: [read_file, grep_search] → [grep_search, read_file]". */
export function describeReorder(before: string[], after: string[]): string {
  let first = 0;
  while (first < before.length && before[first] === after[first]) first++;
  let last = before.length - 1;
  while (last > first && before[last] === after[last]) last--;
  const span = first === last ? `position ${first + 1}` : `positions ${first + 1}–${last + 1}`;
  return `${span}: [${before.slice(first, last + 1).join(", ")}] → [${after.slice(first, last + 1).join(", ")}]`;
}

/** A tool definition's name, wherever the provider puts it: top level, or under `function` in
 * Chat Completions. Undefined for an entry that isn't a tool object at all. */
function toolName(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined;
  const fn = raw["function"];
  return raw["name"] ?? (isRecord(fn) ? fn["name"] : undefined);
}

/** A system segment counts as the system prompt only if no conversation turn comes before it
 * (a mid-conversation system message is operator text too, but not "the system prompt"). */
function isSystemPrompt(segments: readonly Segment[], index: number): boolean {
  if (segments[index]?.category !== "system") return false;
  return segments.slice(0, index).every((seg) => seg.category === "tools" || seg.category === "system");
}

/** The request cut down to its tools and system prompt, or to `atLeast` segments if that is more. */
function setupOf(request: ParsedRequest, atLeast: number): ParsedRequest {
  let setup = 0;
  while (setup < request.segments.length && (request.segments[setup]!.category === "tools" || request.segments[setup]!.category === "system")) setup++;
  return { ...request, segments: request.segments.slice(0, Math.max(setup, atLeast)) };
}

function volatileFix(provider: Provider, modelInfo: ReturnType<typeof findAnthropicModel> | undefined): string {
  if (provider === "anthropic" && modelInfo?.midConversationSystem) {
    return `Move it out of the cached region: ${modelInfo.displayName} accepts a mid-conversation {"role": "system"} message after the cached history, or put it at the end of the latest user turn.`;
  }
  return "Move it out of the cached region, e.g. to the end of the latest user turn.";
}

export function computeFindings(
  provider: Provider,
  requests: ParsedRequest[],
  prefixMatches: PrefixMatch[],
  model: string | undefined,
  duplicates: DuplicateGroup[],
  cacheSimulation: CacheSimulation,
): Finding[] {
  const findings: Finding[] = [];
  // Each request is compared with the request it continues (threads.ts), which in a file that
  // holds several conversations is not the line before it.
  const matchTo = new Map(prefixMatches.map((match) => [match.toIndex, match]));
  const previousOpenAiScope = new Map<string, number>();

  requests.forEach((request, i) => {
    const modelInfo = provider === "anthropic" ? findAnthropicModel(resolveModel(provider, model, [request.model]).id) : undefined;
    const cacheStep = cacheSimulation.actual[i];
    const modernOpenAi = provider === "openai" && (cacheStep?.cacheMode === "implicit" || cacheStep?.cacheMode === "explicit");
    if (modernOpenAi) {
      const scope = openAiCacheScope(request);
      const priorIndex = previousOpenAiScope.get(scope);
      previousOpenAiScope.set(scope, i);
      // Thread inference may choose an identical setup on another cache key. Diagnose
      // against the previous request in this cache namespace, not that other thread.
      if (priorIndex !== undefined && cacheStep.readTokens === 0
        && (cacheSimulation.actual[priorIndex]?.writeTokens30m ?? 0) > 0
        && !(cacheStep.cacheMode === "explicit" && openAiCachePlan(request).explicit.length === 0)) {
        const left = comparisonKeys(requests[priorIndex]!.segments, false);
        const right = comparisonKeys(request.segments, false);
        let shared = 0;
        for (let s = 0; s < Math.min(left.length, right.length) && left[s] === right[s]; s++) shared += request.segments[s]!.openaiTokens;
        if (shared >= 1024) push(findings, { kind: "openai_cache_boundary", severity: "warning", requestIndex: i,
          title: "Shared text has no reusable cache boundary",
          detail: `Request ${i + 1} shares ${shared.toLocaleString("en-US")} modeled prefix tokens with request ${priorIndex + 1}, but none of its eligible lookup boundaries finds a cached endpoint. Matching text alone is insufficient. Keep earlier message endings intact, or mark the end of the stable content explicitly in both requests. An explicit-only request checks its explicit boundaries; implicit lookup also has a message lookback limit.`,
          segmentIds: [] });
      }
    }
    if (modernOpenAi && cacheStep.cacheMode === "explicit" && openAiCachePlan(request).explicit.length === 0) {
      push(findings, { kind: "openai_cache_disabled", severity: "info", requestIndex: i,
        title: "Explicit caching has no breakpoints",
        detail: `Request ${i + 1} selects explicit-only caching but marks no content blocks. This disables cache reads and writes, even when the prompt repeats. If caching is intended, add prompt_cache_breakpoint: {"mode":"explicit"} after the reusable content in both the earlier and later request.`,
        segmentIds: [] });
    }
    // no_cache_control / below_minimum_cacheable only apply to Anthropic, whose caching is opt-in via a marker.
    if (provider === "anthropic" && modelInfo) {
      const totalTokens = request.segments.reduce((sum, s) => sum + s.claudeTokensEstimate, 0);
      const breakpoints = request.segments.filter((s) => s.cacheControl);
      if (breakpoints.length === 0 && requests.length > 1 && totalTokens >= modelInfo.minCacheableTokens) {
        push(findings, {
          kind: "no_cache_control",
          severity: "warning",
          requestIndex: i,
          title: "No cache_control breakpoint set",
          detail: `Request ${i + 1} carries ≈${totalTokens.toLocaleString("en-US")} Claude tokens but no cache_control marker, so nothing is ever cached even though this is part of a ${requests.length}-request sequence. One line turns it on: a top-level "cache_control": {"type": "ephemeral"} beside "model" puts a breakpoint on the last block of every request.`,
          segmentIds: [],
        });
      }
      for (const bp of breakpoints) {
        const cum = request.segments.slice(0, request.segments.indexOf(bp) + 1).reduce((sum, s) => sum + s.claudeTokensEstimate, 0);
        if (cum < modelInfo.minCacheableTokens) {
          push(findings, {
            kind: "below_minimum_cacheable",
            severity: "warning",
            requestIndex: i,
            title: "Prefix below minimum cacheable length",
            detail: `The ${bp.cacheControl?.automatic ? "automatic breakpoint (top-level cache_control), which lands on" : "cache_control breakpoint at"} "${bp.label}"${bp.cacheControl?.automatic ? "," : ""} covers only ≈${cum.toLocaleString("en-US")} tokens, below ${modelInfo.displayName}'s ${modelInfo.minCacheableTokens.toLocaleString("en-US")}-token minimum - it silently never caches.`,
            segmentIds: [bp.id],
          });
        }
      }

    }

    const match = matchTo.get(i);
    if (!match) return;
    const from = match.fromIndex;
    const startsConversation = match.relation === "new_conversation";
    // A new conversation shares its predecessor's setup (tools and system prompt) and whatever
    // opening messages they have in common, not the rest of that other conversation.
    const prev = startsConversation ? setupOf(requests[from]!, match.matchedSegments) : requests[from]!;
    // A change blocks reuse from this predecessor, but not from earlier requests on the
    // destination model. Missing metadata is not evidence that a switch actually happened.
    if (prev.model && request.model && !sameModel(prev.model, request.model)) {
      push(findings, {
        kind: "model_switch",
        severity: "warning",
        requestIndex: i,
        title: `Model changed between requests ${from + 1} and ${i + 1}`,
        detail: `Request ${from + 1} ran on ${prev.model} and request ${i + 1} on ${request.model}. Request ${i + 1} cannot reuse cache entries from ${prev.model}; it can still reuse a matching prefix that earlier requests on ${request.model} cached. Inspect this request's simulated read and write counts before attributing cost to the switch.`,
        segmentIds: [],
      });
    }

    // volatile_prefix: a timestamp/UUID/epoch inside the stable-looking prefix busts the match every time.
    const boundary = Math.min(prev.segments.length, request.segments.length);
    for (let s = 0; s < boundary; s++) {
      const a = prev.segments[s]!;
      const b = request.segments[s]!;
      if (a.category !== b.category) break;
      if (comparisonKeys([a], false)[0] === comparisonKeys([b], false)[0]) continue;
      if ((containsVolatilePattern(a.text) || containsVolatilePattern(b.text))
        && comparisonKeys([a], true)[0] === comparisonKeys([b], true)[0]) {
        push(findings, {
          kind: "volatile_prefix",
          severity: "error",
          requestIndex: i,
          title: `${isSystemPrompt(request.segments, s) ? "System prompt" : b.label} contains a value that changes every request`,
          detail: `"${b.label}" differs between requests ${from + 1} and ${i + 1}, and looks like a timestamp/UUID/epoch value. Every byte after this point falls out of the cached prefix on every request. ${volatileFix(provider, modelInfo)}`,
          segmentIds: [a.id, b.id],
        });
      }
      break; // only the first divergence point is the interesting one for this finding
    }

    // tools_reordered / tool_schema_key_order
    const prevTools = toolSegments(prev);
    const currTools = toolSegments(request);
    if (prevTools.length > 0 && currTools.length > 0) {
      const prevNames = prevTools.map((t) => toolName(t.raw));
      const currNames = currTools.map((t) => toolName(t.raw));
      const sameSet = prevNames.length === currNames.length && [...prevNames].sort().join("|") === [...currNames].sort().join("|");
      if (sameSet && prevNames.join("|") !== currNames.join("|")) {
        push(findings, {
          kind: "tools_reordered",
          severity: "error",
          requestIndex: i,
          title: `Tools reordered between requests ${from + 1} and ${i + 1}`,
          detail: `Same ${currNames.length} tools, different order: ${describeReorder(prevNames.map(String), currNames.map(String))}. Tools render at position 0 of the prefix, so any reorder invalidates the entire cache. Sort tools deterministically (e.g. by name) before sending.`,
          segmentIds: currTools.map((t) => t.id),
        });
      }

      for (const currTool of currTools) {
        const name = toolName(currTool.raw);
        const prevTool = prevTools.find((t) => toolName(t.raw) === name);
        if (!prevTool) continue;
        if (canonicalJson(prevTool.raw) === canonicalJson(currTool.raw)) {
          // Sorted-key form is identical (same tool, same content) - any difference in the raw
          // insertion order is pure key-order drift, not a content change.
          const fpPrev = keyOrderFingerprint(prevTool.raw).join(",");
          const fpCurr = keyOrderFingerprint(currTool.raw).join(",");
          if (fpPrev !== fpCurr) {
            push(findings, {
              kind: "tool_schema_key_order",
              severity: "error",
              requestIndex: i,
              title: `Tool "${String(name)}" schema key order differs`,
              detail: `The "${String(name)}" tool definition is semantically identical between requests ${from + 1} and ${i + 1}, but its JSON key order changed - almost always non-deterministic object key iteration (e.g. building the schema from an unordered map/set) upstream. Serialize tool schemas with sorted keys before sending.`,
              segmentIds: [prevTool.id, currTool.id],
            });
          }
        }
      }
    }

    // breakpoint_before_change: a cache_control marker whose covered content is itself in the
    // diverged region *and* existed (at that same position) in the previous request - i.e. it's
    // genuinely unstable content (a timestamp, a UUID), not simply new content this turn. A
    // rolling breakpoint deliberately placed on the newest tail segment always fails the first
    // check (idx >= matchedSegments, since brand-new content is never part of the matched prefix)
    // but is the *correct* pattern, not a bug - the second check (idx < prev.segments.length)
    // excludes it: a genuinely new position has no corresponding segment in the previous request
    // to have "changed" from.
    if (provider === "anthropic") {
      for (const bp of request.segments.filter((s) => s.cacheControl)) {
        const idx = request.segments.indexOf(bp);
        if (idx >= match.matchedSegments && idx < prev.segments.length) {
          push(findings, {
            kind: "breakpoint_before_change",
            severity: "warning",
            requestIndex: i,
            title: "Cache breakpoint placed after content that changes",
            detail: `"${bp.label}" carries ${bp.cacheControl?.automatic ? "the automatic breakpoint (top-level cache_control)" : "a cache_control marker"}, but it (or something before it) already differs from request ${from + 1}. The breakpoint can only pay off once the content it covers is stable.`,
            segmentIds: [bp.id],
          });
        }
      }

      // lookback_window_exceeded (approximate re-check, mirrors cache-anthropic.ts's own distance test).
      // Not for a new conversation: its first breakpoints have no earlier entry of their own to find.
      if (startsConversation) return;
      const positions = anthropicPositions(request.segments);
      const boundaryPos = match.matchedSegments > 0 ? positions[match.matchedSegments - 1]! : -1;
      for (const bp of request.segments.filter((s) => s.cacheControl)) {
        const idx = request.segments.indexOf(bp);
        if (idx < match.matchedSegments) continue;
        const distance = positions[idx]! - boundaryPos;
        if (distance >= ANTHROPIC_LOOKBACK_POSITIONS) {
          push(findings, {
            kind: "lookback_window_exceeded",
            severity: "warning",
            requestIndex: i,
            title: "Breakpoint is outside the 20-position lookback window",
            detail: `"${bp.label}" sits ${distance} positions past the last matching prefix boundary with request ${from + 1}. Anthropic checks 20 positions including the breakpoint itself, so this lookup cannot reach that boundary. An intermediate breakpoint closer to it can find a cache entry there if an earlier request wrote one.`,
            segmentIds: [bp.id],
          });
        }
      }
    }
  });

  for (const group of duplicates) {
    if (group.members.length < 2) continue;
    const first = group.members[0]!;
    push(findings, {
      kind: "duplicate_content",
      severity: "info",
      requestIndex: first.requestIndex,
      title: `The same ~${Math.round(first.tokens / 100) / 10}k-token content appears ${group.members.length} times`,
      detail: `"${first.label}" and ${group.members.length - 1} other segment${group.members.length > 2 ? "s" : ""} are near-duplicates (similarity ${(group.similarity * 100).toFixed(0)}%), wasting an estimated ≈${group.estimatedWastedTokens.toLocaleString("en-US")} tokens. Consider caching or referencing this content once instead of repeating it inline.`,
      segmentIds: group.members.map((m) => m.segmentId),
    });
  }

  // missing_tail_breakpoint: the single most valuable fix for a real agent loop and the one the
  // other checks above don't cover - a cache_control breakpoint exists somewhere (so
  // no_cache_control didn't fire) and isn't sitting on volatile content (so
  // breakpoint_before_change didn't fire either), but it also never advances to cover the
  // conversation's growing tail, so every turn re-sends prior history uncached. Derived directly
  // from the cache simulation's own actual-vs-optimized gap (not a separately-reasoned estimate),
  // so this finding and the "potential savings" figure shown alongside it can never disagree: if
  // the saving is material, this (or one of the finding kinds above) is why.
  if (provider === "anthropic") {
    requests.forEach((request, i) => {
      const actualStep = cacheSimulation.actual[i];
      const optimizedStep = cacheSimulation.optimized[i];
      if (!actualStep || !optimizedStep) return;
      if (actualStep.costUsd === undefined || optimizedStep.costUsd === undefined || actualStep.costUsd <= 0) return;
      const gapUsd = actualStep.costUsd - optimizedStep.costUsd;
      const ratio = gapUsd / actualStep.costUsd;
      if (ratio < MATERIAL_SAVINGS_RATIO) return;
      if (findings.some((f) => f.requestIndex === i && EXPLAINS_CACHE_GAP.has(f.kind))) return;

      push(findings, {
        kind: "missing_tail_breakpoint",
        severity: "warning",
        requestIndex: i,
        title: "No cache breakpoint on the conversation tail",
        detail: `This request resends ≈${actualStep.uncachedTokens.toLocaleString("en-US")} tokens of prior conversation history uncached - nothing after the last cache_control breakpoint (or there is none) covers the turns already in this conversation. A rolling breakpoint on the latest turn (Anthropic allows up to 4 per request, and each one needs to land within the 20-position lookback of the one it reads from) would let most of that history read from cache instead of resending it in full - estimated ≈$${gapUsd.toFixed(4)} (${Math.round(ratio * 100)}%) cheaper on this request alone.`,
        segmentIds: [],
      });
    });

    // Safety net for the invariant itself: the per-request loop above catches the common case
    // (the gap is concentrated in individual requests, each clearing the 10% bar on its own), but
    // a gap spread thinly across many requests could in principle stay under 10% on every single
    // one while still summing to a material total. Check the aggregate the cost line itself shows
    // and, if nothing above already explains it, point at the single request with the largest
    // absolute gap - "no findings" must never coexist with a materially non-zero savings figure.
    const { totalActualCostUsd, totalOptimizedCostUsd } = cacheSimulation;
    if (totalActualCostUsd !== undefined && totalOptimizedCostUsd !== undefined && totalActualCostUsd > 0) {
      const aggregateRatio = (totalActualCostUsd - totalOptimizedCostUsd) / totalActualCostUsd;
      const alreadyExplained = findings.some((f) => EXPLAINS_CACHE_GAP.has(f.kind) || f.kind === "missing_tail_breakpoint");
      if (aggregateRatio >= MATERIAL_SAVINGS_RATIO && !alreadyExplained) {
        let worst = { index: -1, gap: -Infinity };
        cacheSimulation.actual.forEach((step, i) => {
          const optimizedCost = cacheSimulation.optimized[i]?.costUsd;
          if (step.costUsd === undefined || optimizedCost === undefined) return;
          const gap = step.costUsd - optimizedCost;
          if (gap > worst.gap) worst = { index: i, gap };
        });
        if (worst.index >= 0) {
          push(findings, {
            kind: "missing_tail_breakpoint",
            severity: "warning",
            requestIndex: worst.index,
            title: "No cache breakpoint on the conversation tail",
            detail: `Across this sequence, caching the growing conversation tail (in addition to whatever's cached today) would cost ≈$${totalOptimizedCostUsd.toFixed(4)} instead of ≈$${totalActualCostUsd.toFixed(4)} - about ${Math.round(aggregateRatio * 100)}% lower, spread across requests rather than concentrated in any single one. A rolling cache_control breakpoint on the latest turn each request is the fix.`,
            segmentIds: [],
          });
        }
      }
    }
  }

  return findings;
}
