import { canonicalJson, isRecord } from "./json-utils.js";
import type { ParsedRequest, Segment } from "./types.js";

/** Message entries depend on request settings even when their visible prefix is unchanged.
 * Tools and the top-level system prompt survive these two documented invalidators.
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache
 */
export interface AnthropicMessageCacheScope {
  toolChoice: string;
  hasImages: boolean;
}

export function isAnthropicMessageSegment(segment: Segment): boolean {
  // A role:system message is still in the message cache, not the top-level system cache.
  return segment.path.startsWith("messages[");
}

function hasImages(request: Record<string, unknown>): boolean {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const pending: unknown[] = messages.flatMap((message) => isRecord(message) && Array.isArray(message.content) ? message.content : []);
  while (pending.length) {
    const block = pending.pop();
    if (!isRecord(block)) continue;
    if (block.type === "image") return true;
    // Follow content grammar only. A tool input or text may describe an image
    // without actually including one in the prompt.
    if ((block.type === "tool_result" || block.type === "mcp_tool_result") && Array.isArray(block.content)) {
      for (const child of block.content) pending.push(child);
    } else if (block.type === "document" && isRecord(block.source) && block.source.type === "content" && Array.isArray(block.source.content)) {
      for (const child of block.source.content) pending.push(child);
    }
  }
  return false;
}

export function anthropicMessageCacheScope(request: ParsedRequest): AnthropicMessageCacheScope {
  const raw = isRecord(request.raw) ? request.raw : {};
  let choice = raw.tool_choice;
  if (choice === undefined || choice === null) {
    // Documented defaults for ordinary tools. Unsupported toolset-only bodies
    // retain an unspecified scope rather than guessing their implicit choice.
    choice = Array.isArray(raw.tools) && raw.tools.length > 0 ? { type: "auto" }
      : Array.isArray(raw.toolsets) && raw.toolsets.length > 0 ? null : { type: "none" };
  }
  if (isRecord(choice) && ["auto", "any", "tool"].includes(String(choice.type)) && choice.disable_parallel_tool_use === false) {
    const normalized = { ...choice };
    delete normalized.disable_parallel_tool_use;
    choice = normalized;
  }
  return { toolChoice: canonicalJson(choice), hasImages: hasImages(raw) };
}

export function anthropicMessageCacheKey(scope: AnthropicMessageCacheScope): string {
  return JSON.stringify([scope.toolChoice, scope.hasImages]);
}
