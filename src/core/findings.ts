import type { CacheSimulation, DuplicateGroup, Finding, ParsedRequest, PrefixMatch, Provider, Segment } from "./types.js";
import { canonicalJson, isRecord, keyOrderFingerprint } from "./json-utils.js";
import { ANTHROPIC_LOOKBACK_POSITIONS, findAnthropicModel, resolveModel } from "./pricing.js";
import { openAiCachePlan, openAiCacheScope } from "./openai-breakpoints.js";
import { containsVolatilePattern } from "./volatile.js";
import { sameModel } from "./model-id.js";
import { comparisonKeys } from "./prefix.js";
import { anthropicPositions } from "./anthropic-breakpoints.js";
import { anthropicMessageCacheScope, isAnthropicMessageSegment } from "./anthropic-cache-scope.js";
import { anthropicSpeed, anthropicSpeedKey, anthropicSpeedMultiplier } from "./anthropic-speed.js";
import { anthropicReasoningScope } from "./anthropic-reasoning.js";
import { anthropicInjectedSettings } from "./anthropic-injected-settings.js";
import { sumTokenCounts } from "./media-accounting.js";

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
    const mediaSegments = request.segments.filter(s => s.unmodeledContent?.length);
    if (mediaSegments.length) push(findings, {
      kind: "unmodeled_media", severity: "warning", requestIndex: i,
      title: "Media token counts are unavailable",
      detail: "These segments contain media or opaque document/file references. Encoded bytes, URLs and file IDs are not model token counts. Request totals and context usage are unavailable. Cache token partitions and costs are unavailable for the whole sequence because unknown lengths affect thresholds and prior entries. Other segments retain their text counts, and original blocks remain inspectable. Captured provider usage remains visible. A scalar calibration cannot recover the missing media segments.",
      segmentIds: mediaSegments.map(s => s.id),
    });
    if (provider === "anthropic") {
      const injected = anthropicInjectedSettings(request);
      if (injected.format !== null || injected.citations) push(findings, {
        kind: "anthropic_injected_prompt", severity: "info", requestIndex: i,
        title: injected.format !== null ? "Output-format instructions are not counted" : "Citation instructions are not counted",
        detail: `${injected.format !== null ? "Structured output format" : "Enabled citations"} adds provider-side prompt instructions. The local token estimator does not reproduce those instructions, so these totals and costs omit their overhead. Cache scope changes are still respected. A count_tokens calibration request preserves output configuration and citation controls, but one calibration scale cannot reproduce every hidden segment or establish an actual cache hit.`,
        segmentIds: [],
      });
    }
    if (provider === "anthropic" && isRecord(request.raw) && request.raw.speed !== undefined && request.raw.speed !== "standard") {
      const speed = anthropicSpeed(request);
      const multiplier = anthropicSpeedMultiplier(request, resolveModel(provider, model, [request.model]));
      push(findings, {
        kind: "anthropic_speed", severity: multiplier === undefined ? "warning" : "info", requestIndex: i,
        title: multiplier === undefined ? "Speed pricing unavailable" : speed === "standard" ? "Fast request modeled at standard speed" : "Fast input pricing",
        detail: multiplier === undefined
          ? "This speed/model combination has no supported fast input price in the current table. Input costs and sequence totals are unavailable; token partitions remain hypothetical. Current Claude API fast mode supports Opus 5.5, Opus 5 and Opus 4.8, with a standard-speed fallback on Opus 4.6. An unsupported request may be rejected by the provider."
          : speed === "standard"
            ? "The current Claude API documents that Opus 4.6 accepts speed: fast but runs at standard speed. This simulation uses the standard cache scope and price. Request data cannot verify historical behavior or the response's actual speed."
            : "Fast mode uses 2x the resolved model's standard input rate, including cache reads and both write TTLs. The simulation uses current Claude API rates, not measured charges; response speed, beta headers, platform support and historical rates are not verified. The optimized scenario keeps this speed.",
        segmentIds: [],
      });
    }
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
        for (let s = 0; s < Math.min(left.length, right.length) && left[s] === right[s]; s++) shared += request.segments[s]!.openaiTokens!;
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
      const totalTokens = sumTokenCounts(request.segments.map(s => s.claudeTokensEstimate));
      const breakpoints = request.segments.filter((s) => s.cacheControl);
      if (breakpoints.length === 0 && requests.length > 1 && totalTokens !== null && totalTokens >= modelInfo.minCacheableTokens) {
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
        const cum = sumTokenCounts(request.segments.slice(0, request.segments.indexOf(bp) + 1).map(s => s.claudeTokensEstimate));
        if (cum !== null && cum < modelInfo.minCacheableTokens) {
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
    if (provider === "anthropic") {
      const before = anthropicInjectedSettings(prev), after = anthropicInjectedSettings(request);
      if (before.formatKey !== after.formatKey) push(findings, {
        kind: "anthropic_output_cache_scope", severity: "info", requestIndex: i,
        title: "Output format changed the prompt cache",
        detail: `The output format differs between requests ${from + 1} and ${i + 1}. Claude injects instructions for structured outputs, so this simulation separates their prompt caches even when the visible messages match. Grammar compilation caching is separate and does not establish prompt reuse. Schema descriptions and property order remain significant. Both scenarios preserve the format; an earlier request with the current format can still supply a hit.`,
        segmentIds: request.segments.filter(s => s.cacheControl).map(s => s.id),
      });
      if (before.citations !== after.citations) push(findings, {
        kind: "anthropic_citation_cache_scope", severity: "info", requestIndex: i,
        title: "Citation setting changed the system cache",
        detail: `Citation enablement differs between requests ${from + 1} and ${i + 1}. Claude's citation instructions change the system prompt, so system and message cache entries from that request cannot supply a hit, including before the cited document. Separately marked tool entries remain eligible. An earlier request with the current citation setting can still supply a hit; both scenarios preserve the setting.`,
        segmentIds: request.segments.filter(s => s.cacheControl && !s.path.startsWith("tools[")).map(s => s.id),
      });
    }
    if (provider === "anthropic" && request.segments.some((s) => s.cacheControl)) {
      const before = anthropicReasoningScope(prev), after = anthropicReasoningScope(request);
      const changed = [before.thinking !== after.thinking ? "thinking configuration" : "",
        before.effort !== after.effort ? "output_config.effort" : ""].filter(Boolean);
      if (changed.length) push(findings, {
        kind: "anthropic_reasoning_cache_scope", severity: "info", requestIndex: i,
        title: "Thinking or effort cache settings changed",
        detail: `${changed.join(" and ")} differs between requests ${from + 1} and ${i + 1}. Anthropic documents that these changes invalidate message entries even when visible text is identical. Tool and system survival is model-specific: this simulation conservatively isolates all three cache levels rather than inferring the provider's hidden prompt placement. Actual setup reuse and costs may differ. An earlier request with the current settings can still supply a hit. Both scenarios keep these settings; documented mode and effort defaults are normalized only for recognized recorded models.`,
        segmentIds: request.segments.filter((s) => s.cacheControl).map((s) => s.id),
      });
    }
    if (provider === "anthropic" && anthropicSpeedKey(prev) !== anthropicSpeedKey(request)) {
      push(findings, {
        kind: "anthropic_speed_cache_scope", severity: "info", requestIndex: i,
        title: "Processing speed changed",
        detail: `Processing speed differs between requests ${from + 1} and ${i + 1}. System and message cache entries from that request cannot supply a hit, even when the visible prefix matches. Separately marked tool entries remain eligible. An earlier request at the current speed can still supply a hit. Both simulation scenarios preserve the speed setting.`,
        segmentIds: request.segments.filter((s) => s.cacheControl && !s.path.startsWith("tools[")).map((s) => s.id),
      });
    }
    if (provider === "anthropic" && request.segments.some((s) => s.cacheControl && isAnthropicMessageSegment(s))) {
      const before = anthropicMessageCacheScope(prev);
      const after = anthropicMessageCacheScope(request);
      const changed = [before.toolChoice !== after.toolChoice ? "tool_choice" : "", before.hasImages !== after.hasImages ? "image presence" : ""].filter(Boolean);
      if (changed.length > 0) push(findings, {
        kind: "anthropic_message_cache_scope", severity: "info", requestIndex: i,
        title: "Message cache settings changed",
        detail: `${changed.join(" and ")} differs between requests ${from + 1} and ${i + 1}. Message cache entries from that request cannot be reused, even when the visible prefix matches or an image was added after its breakpoint. These changes alone preserve stable tools and top-level system entries. An earlier request with the current settings can still supply a hit; inspect the read/write counts. The optimized scenario preserves these settings.`,
        segmentIds: request.segments.filter((s) => s.cacheControl && isAnthropicMessageSegment(s)).map((s) => s.id),
      });
    }
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
      title: `${group.matchKind === "exact" ? "Identical text" : "Similar text"} appears in ${group.members.length} segments`,
      detail: `"${first.label}" and ${group.members.length - 1} other segment${group.members.length > 2 ? "s" : ""} ${group.matchKind === "exact" ? "contain identical text" : `have at least ${Math.floor(group.similarity * 100)}% word-shingle similarity across every pair`}. Later matches contain an estimated ≈${group.estimatedReviewTokens.toLocaleString("en-US")} tokens to review, not proven savings. ${group.matchKind === "exact" ? "Check whether the repeated observations are needed before removing them." : "Edits, ordering and repetition can carry new information; inspect the original segments before consolidating them."}`,
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
      if (actualStep.uncachedTokens === null) return;
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
