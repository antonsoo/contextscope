import type { DuplicateGroup, Finding, ParsedRequest, PrefixMatch, Provider, Segment } from "./types.js";
import { canonicalJson, keyOrderFingerprint } from "./json-utils.js";
import { ANTHROPIC_LOOKBACK_POSITIONS, findAnthropicModel } from "./pricing.js";
import { containsVolatilePattern } from "./volatile.js";

function push(list: Finding[], f: Finding): void {
  list.push(f);
}

function toolSegments(request: ParsedRequest): Segment[] {
  return request.segments.filter((s) => s.category === "tools");
}

export function computeFindings(
  provider: Provider,
  requests: ParsedRequest[],
  prefixMatches: PrefixMatch[],
  model: string | undefined,
  duplicates: DuplicateGroup[],
): Finding[] {
  const findings: Finding[] = [];
  const modelInfo = provider === "anthropic" ? findAnthropicModel(model) : undefined;

  requests.forEach((request, i) => {
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
          detail: `Request ${i + 1} carries ≈${totalTokens.toLocaleString()} Claude tokens but no cache_control marker, so nothing is ever cached even though this is part of a ${requests.length}-request sequence.`,
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
            detail: `The cache_control breakpoint at "${bp.label}" covers only ≈${cum.toLocaleString()} tokens, below ${modelInfo.displayName}'s ${modelInfo.minCacheableTokens.toLocaleString()}-token minimum - it silently never caches.`,
            segmentIds: [bp.id],
          });
        }
      }

      // ttl_ordering: a 1h entry must appear before any 5m entries in the same request.
      let seenShort = false;
      for (const bp of breakpoints) {
        if (bp.cacheControl?.ttl === "5m") seenShort = true;
        if (bp.cacheControl?.ttl === "1h" && seenShort) {
          push(findings, {
            kind: "ttl_ordering",
            severity: "error",
            requestIndex: i,
            title: "1-hour TTL breakpoint placed after a 5-minute one",
            detail: `"${bp.label}" uses a 1-hour TTL but comes after a 5-minute breakpoint earlier in the request. Longer-TTL entries must appear before shorter ones, or this request is rejected.`,
            segmentIds: [bp.id],
          });
        }
      }
    }

    if (i === 0) return;
    const match = prefixMatches[i - 1]!;
    const prev = requests[i - 1]!;

    // volatile_prefix: a timestamp/UUID/epoch inside the stable-looking prefix busts the match every time.
    const boundary = Math.min(prev.segments.length, request.segments.length);
    for (let s = 0; s < boundary; s++) {
      const a = prev.segments[s]!;
      const b = request.segments[s]!;
      if (a.category !== b.category) break;
      if (a.text === b.text) continue;
      if (containsVolatilePattern(a.text) || containsVolatilePattern(b.text)) {
        push(findings, {
          kind: "volatile_prefix",
          severity: "error",
          requestIndex: i,
          title: `${b.category === "system" ? "System prompt" : b.label} contains a value that changes every request`,
          detail: `"${b.label}" differs between requests ${i} and ${i + 1}, and looks like a timestamp/UUID/epoch value. Every byte after this point falls out of the cached prefix on every request. Move it out of the cached region (e.g. into a mid-conversation "system" message, or the end of the user turn).`,
          segmentIds: [a.id, b.id],
        });
      }
      break; // only the first divergence point is the interesting one for this finding
    }

    // tools_reordered / tool_schema_key_order
    const prevTools = toolSegments(prev);
    const currTools = toolSegments(request);
    if (prevTools.length > 0 && currTools.length > 0) {
      const prevNames = prevTools.map((t) => (t.raw as Record<string, unknown>)["name"] ?? (t.raw as { function?: { name?: string } })["function"]?.name);
      const currNames = currTools.map((t) => (t.raw as Record<string, unknown>)["name"] ?? (t.raw as { function?: { name?: string } })["function"]?.name);
      const sameSet = prevNames.length === currNames.length && [...prevNames].sort().join("|") === [...currNames].sort().join("|");
      if (sameSet && prevNames.join("|") !== currNames.join("|")) {
        push(findings, {
          kind: "tools_reordered",
          severity: "error",
          requestIndex: i,
          title: `Tools reordered between requests ${i} and ${i + 1}`,
          detail: `Same ${currNames.length} tools, different order: [${prevNames.join(", ")}] → [${currNames.join(", ")}]. Tools render at position 0 of the prefix, so any reorder invalidates the entire cache. Sort tools deterministically (e.g. by name) before sending.`,
          segmentIds: currTools.map((t) => t.id),
        });
      }

      for (const currTool of currTools) {
        const name = (currTool.raw as Record<string, unknown>)["name"] ?? (currTool.raw as { function?: { name?: string } })["function"]?.name;
        const prevTool = prevTools.find((t) => ((t.raw as Record<string, unknown>)["name"] ?? (t.raw as { function?: { name?: string } })["function"]?.name) === name);
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
              detail: `The "${String(name)}" tool definition is semantically identical between requests ${i} and ${i + 1}, but its JSON key order changed - almost always non-deterministic object key iteration (e.g. building the schema from an unordered map/set) upstream. Serialize tool schemas with sorted keys before sending.`,
              segmentIds: [prevTool.id, currTool.id],
            });
          }
        }
      }
    }

    // breakpoint_before_change: a cache_control marker whose covered content is itself in the diverged region.
    if (provider === "anthropic") {
      for (const bp of request.segments.filter((s) => s.cacheControl)) {
        const idx = request.segments.indexOf(bp);
        if (idx >= match.matchedSegments) {
          push(findings, {
            kind: "breakpoint_before_change",
            severity: "warning",
            requestIndex: i,
            title: "Cache breakpoint placed after content that changes",
            detail: `"${bp.label}" carries a cache_control marker, but it (or something before it) already differs from request ${i}. The breakpoint can only pay off once the content it covers is stable.`,
            segmentIds: [bp.id],
          });
        }
      }

      // lookback_window_exceeded (approximate re-check, mirrors cache-anthropic.ts's own distance test).
      const positions: number[] = [];
      let pos = -1;
      let run: string | undefined;
      for (const s of request.segments) {
        const isRun = s.category === "tool_call" || s.category === "tool_result";
        if (isRun && s.category === run) {
          // same run
        } else {
          pos++;
          run = isRun ? s.category : undefined;
        }
        positions.push(pos);
      }
      const boundaryPos = match.matchedSegments > 0 ? positions[match.matchedSegments - 1]! : -1;
      for (const bp of request.segments.filter((s) => s.cacheControl)) {
        const idx = request.segments.indexOf(bp);
        if (idx < match.matchedSegments) continue;
        const distance = positions[idx]! - boundaryPos;
        if (distance > ANTHROPIC_LOOKBACK_POSITIONS) {
          push(findings, {
            kind: "lookback_window_exceeded",
            severity: "warning",
            requestIndex: i,
            title: "Breakpoint is outside the 20-position lookback window",
            detail: `"${bp.label}" sits ${distance} positions past the last matching prefix boundary with request ${i}. Anthropic only looks back 20 positions for a prior cache entry, so this breakpoint can never find one - add an intermediate breakpoint closer to the boundary.`,
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
      detail: `"${first.label}" and ${group.members.length - 1} other segment${group.members.length > 2 ? "s" : ""} are near-duplicates (similarity ${(group.similarity * 100).toFixed(0)}%), wasting an estimated ≈${group.estimatedWastedTokens.toLocaleString()} tokens. Consider caching or referencing this content once instead of repeating it inline.`,
      segmentIds: group.members.map((m) => m.segmentId),
    });
  }

  return findings;
}
