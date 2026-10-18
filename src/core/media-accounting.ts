import { isRecord } from "./json-utils.js";
import type { CacheSimStep, MediaKind, ParsedRequest, Provider, TokenCount } from "./types.js";

/** Follow content grammar, never arbitrary JSON in tool arguments or quoted text.
 * Encoded bytes, URLs and file IDs are transport representations, not model tokens.
 * No remote content is fetched, and no media decoder or provider renderer is assumed.
 */
export function unmodeledMedia(block: unknown, provider: Provider): MediaKind[] {
  const kinds = new Set<MediaKind>();
  function visit(value: unknown): void {
    if (!isRecord(value)) return;
    const type = value.type;
    if (provider === "anthropic") {
      if (type === "image") kinds.add("image");
      else if (type === "document") {
        const source = value.source;
        if (isRecord(source) && source.type === "text" && typeof source.data === "string") return;
        if (isRecord(source) && source.type === "content" && (typeof source.content === "string" || Array.isArray(source.content))) {
          if (Array.isArray(source.content)) source.content.forEach(visit);
        } else kinds.add("document");
      } else if (type === "tool_result" || (typeof type === "string" && type.endsWith("_tool_result"))) {
        if (Array.isArray(value.content)) value.content.forEach(visit);
        else if (type === "web_fetch_tool_result" && isRecord(value.content) && value.content.type === "web_fetch_result") visit(value.content.content);
      }
    } else {
      if (type === "image_url" || type === "input_image" || type === "computer_screenshot") kinds.add("image");
      else if (type === "file" || type === "input_file") kinds.add("file");
      else if (type === "input_audio") kinds.add("audio");
      else if (type === "function_call_output" && Array.isArray(value.output)) value.output.forEach(visit);
      else if (type === "computer_call_output") kinds.add("image");
    }
  }
  visit(block);
  return [...kinds].sort();
}

export function sumTokenCounts(values: Iterable<TokenCount>): TokenCount {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function hasUnmodeledTokens(requests: ParsedRequest[], provider: Provider): boolean {
  return requests.some(request => request.segments.some(segment => (provider === "openai" ? segment.openaiTokens : segment.claudeTokensEstimate) === null));
}

export const UNMODELED_CACHE_REASON = "Media token counts are unavailable. Cache token partitions and costs are unavailable for this sequence because unknown media lengths can affect cache thresholds and entries written by earlier requests.";

export function unavailableCacheReason(requests: ParsedRequest[]): string {
  if (requests.some(r => r.segments.some(s => s.unmodeledContext === "mcp_tools"))) {
    return "MCP tool context is not modeled. Resolved tool definitions and their provider-side rendering cannot be established by this estimator. Whole-request cache token partitions and costs are unavailable for this sequence; visible text matches do not establish the resolved prompt or prior cache entries.";
  }
  const context = requests.some(r => r.segments.some(s => s.unmodeledContext));
  const media = requests.some(r => r.segments.some(s => s.unmodeledContent));
  if (context) return `${media ? "Media and stored or opaque context" : "Stored or opaque context"} cannot be reconstructed from these records. Whole-request cache token partitions and costs are unavailable for this sequence; visible text matches do not establish the resolved prompt or prior cache entries.`;
  return UNMODELED_CACHE_REASON;
}

export function unavailableCacheStep(requestIndex: number, reason = UNMODELED_CACHE_REASON): CacheSimStep {
  return { requestIndex, readTokens: null, writeTokens5m: null, writeTokens1h: null,
    uncachedTokens: null, costUsd: undefined, unavailableReason: reason };
}
