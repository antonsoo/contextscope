import type { Segment } from "./types.js";
import { isRecord } from "./json-utils.js";

/** Consecutive tool-use blocks and consecutive tool-result blocks each occupy one lookup position. */
export function anthropicPositions(segments: readonly Segment[]): number[] {
  let position = -1;
  let run: "tool_call" | "tool_result" | undefined;
  return segments.map((segment) => {
    const kind = segment.category === "tool_call" || segment.category === "tool_result" ? segment.category : undefined;
    if (kind === undefined || kind !== run) position++;
    run = kind;
    return position;
  });
}

export function isCacheableSegment(segment: Segment): boolean {
  if (segment.category === "thinking") return false;
  // An empty tool_result is still a block with routing information. Only empty
  // text is forbidden; counted text alone cannot decide whether a block exists.
  if (typeof segment.raw === "string") return segment.raw.length > 0;
  if (isRecord(segment.raw) && segment.raw.type === "text") return segment.text.length > 0;
  return true;
}

/** Automatic and hypothetical tail markers must skip thinking and empty text. */
export function lastCacheableSegment(segments: readonly Segment[]): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    if (isCacheableSegment(segment)) return i;
  }
  return -1;
}
