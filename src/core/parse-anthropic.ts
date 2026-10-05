import type { CacheControl, CacheTtl, ParsedRequest, Segment, SegmentCategory } from "./types.js";
import { asText, blockJson, isRecord } from "./json-utils.js";
import { countTokens, type TokenCounter } from "./token-counter.js";
import { attachPromptIdentity } from "./prompt-identity.js";

interface AnthropicBlock {
  type?: string;
  text?: string;
  cache_control?: { type?: string; ttl?: string };
  [key: string]: unknown;
}

function readCacheControl(block: unknown): CacheControl | undefined {
  const cc = isRecord(block) ? block["cache_control"] : undefined;
  if (!isRecord(cc) || cc["type"] !== "ephemeral") return undefined;
  const ttl: CacheTtl = cc.ttl === "1h" ? "1h" : "5m";
  return { type: "ephemeral", ttl };
}

/**
 * Automatic caching: a `cache_control` at the top level of the request, beside `model` and
 * `messages`, "automatically applies a cache_control marker to the last cacheable block in
 * the request" (the SDK's own description of the parameter). It is the one-line way to turn
 * caching on, and it moves forward by itself as the conversation grows.
 *
 * The last cacheable block is the last block that could carry a marker of its own: thinking
 * blocks can't, and an empty text block can't be cached. A block that already has a marker
 * keeps it.
 */
function applyAutomaticBreakpoint(request: Record<string, unknown>, segments: Segment[]): void {
  const automatic = readCacheControl(request);
  if (!automatic) return;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    if (segment.category === "thinking" || segment.text.length === 0) continue;
    if (!segment.cacheControl) segment.cacheControl = { ...automatic, automatic: true };
    return;
  }
}

function makeSegment(params: {
  id: string;
  category: SegmentCategory;
  label: string;
  path: string;
  text: string;
  raw: unknown;
  cacheControl?: CacheControl | undefined;
}, counter: TokenCounter): Segment {
  const { cacheControl, ...rest } = params;
  // `text` is whatever the log had in that position: a number or an object is kept as its JSON.
  const text = asText(params.text);
  const counts = counter(text);
  return {
    ...rest,
    text,
    charLength: text.length,
    openaiTokens: counts.openai,
    claudeTokensEstimate: counts.claude,
    ...(cacheControl ? { cacheControl } : {}),
  };
}

/** Mid-conversation `system` messages (supported on current Claude models) are operator text, not user text. */
function roleCategory(role: string): SegmentCategory {
  return role === "assistant" ? "assistant" : role === "system" ? "system" : "user";
}

/** Server-side and MCP tool blocks (`server_tool_use`, `web_search_tool_result`, `mcp_tool_use`...) are tool traffic too. */
function otherBlockCategory(type: unknown, role: string): SegmentCategory {
  if (type === "server_tool_use" || type === "mcp_tool_use") return "tool_call";
  if (typeof type === "string" && type.endsWith("_tool_result")) return "tool_result";
  return roleCategory(role);
}

/** Parses one Anthropic Messages API request body into provider-order segments: tools -> system -> messages. */
export function parseAnthropicRequest(raw: unknown, index: number, counter: TokenCounter = countTokens): ParsedRequest {
  const seg = (params: Parameters<typeof makeSegment>[0]): Segment => makeSegment(params, counter);
  const obj = (raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const segments: Segment[] = [];

  const tools: unknown[] = Array.isArray(obj["tools"]) ? obj["tools"] : [];
  tools.forEach((tool, i) => {
    const name = isRecord(tool) && typeof tool["name"] === "string" ? tool["name"] : `tool_${i}`;
    segments.push(
      seg({
        id: `tools[${i}]`,
        category: "tools",
        label: `tool: ${name}`,
        path: `tools[${i}]`,
        text: blockJson(tool),
        raw: tool,
        cacheControl: readCacheControl(tool),
      }),
    );
  });

  const system = obj["system"];
  if (typeof system === "string") {
    segments.push(
      seg({
        id: "system[0]",
        category: "system",
        label: "system prompt",
        path: "system",
        text: system,
        raw: system,
      }),
    );
  } else if (Array.isArray(system)) {
    (system as unknown[]).forEach((block, i) => {
      segments.push(
        seg({
          id: `system[${i}]`,
          category: "system",
          label: `system block ${i + 1}`,
          path: `system[${i}]`,
          text: isRecord(block) && typeof block["text"] === "string" ? block["text"] : blockJson(block),
          raw: block,
          cacheControl: readCacheControl(block),
        }),
      );
    });
  } else if (system !== undefined && system !== null) {
    segments.push(seg({ id: "system", category: "system", label: "system prompt (malformed)", path: "system", text: blockJson(system), raw: system }));
  }

  const messages: unknown[] = Array.isArray(obj["messages"]) ? obj["messages"] : [];
  messages.forEach((message, mi) => {
    if (!isRecord(message)) {
      // Not a message object at all (null, a bare string): kept whole, so later positions don't shift.
      const path = `messages[${mi}]`;
      segments.push(seg({ id: path, category: "user", label: `message ${mi + 1} (malformed)`, path, text: blockJson(message), raw: message }));
      return;
    }
    const role = typeof message["role"] === "string" ? message["role"] : "user";
    const content = message["content"];
    const blocks: unknown[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    if (content !== undefined && content !== null && typeof content !== "string" && !Array.isArray(content)) {
      const path = `messages[${mi}].content`;
      segments.push(seg({ id: path, category: roleCategory(role), label: `message ${mi + 1} (${role}) malformed content`, path, text: blockJson(content), raw: message }));
    }

    blocks.forEach((entry, bi) => {
      const path = `messages[${mi}].content[${bi}]`;
      const id = path;
      if (!isRecord(entry)) {
        segments.push(seg({ id, category: roleCategory(role), label: `message ${mi + 1} (${role}) malformed block`, path, text: blockJson(entry), raw: entry }));
        return;
      }
      const block: AnthropicBlock = entry;
      switch (block.type) {
        case "text":
          segments.push(
            seg({
              id,
              category: roleCategory(role),
              label: `message ${mi + 1} (${role}) text`,
              path: typeof content === "string" ? `messages[${mi}].content` : path,
              text: asText(block.text ?? ""),
              // A plain content string is not a text-block object in the source log.
              raw: typeof content === "string" ? content : block,
              cacheControl: readCacheControl(block),
            }),
          );
          break;
        case "thinking":
        case "redacted_thinking":
          segments.push(
            seg({
              id,
              category: "thinking",
              label: `message ${mi + 1} thinking`,
              path,
              text: typeof block["thinking"] === "string" ? (block["thinking"] as string) : "[redacted thinking]",
              raw: block,
              cacheControl: readCacheControl(block),
            }),
          );
          break;
        case "tool_use":
          segments.push(
            seg({
              id,
              category: "tool_call",
              label: `message ${mi + 1} tool_use: ${String(block["name"] ?? "?")}`,
              path,
              text: blockJson(block),
              raw: block,
              cacheControl: readCacheControl(block),
            }),
          );
          break;
        case "tool_result": {
          const resultContent = block["content"];
          const text =
            typeof resultContent === "string"
              ? resultContent
              : Array.isArray(resultContent)
                ? resultContent
                    .map((c) => (isRecord(c) && typeof c["text"] === "string" ? c["text"] : blockJson(c)))
                    .join("\n")
                : blockJson(resultContent);
          segments.push(
            seg({
              id,
              category: "tool_result",
              label: `message ${mi + 1} tool_result`,
              path,
              text,
              raw: block,
              cacheControl: readCacheControl(block),
            }),
          );
          break;
        }
        case "image":
          segments.push(
            seg({
              id,
              category: "image",
              label: `message ${mi + 1} image`,
              path,
              text: blockJson(block["source"] ?? block),
              raw: block,
              cacheControl: readCacheControl(block),
            }),
          );
          break;
        case "document":
          segments.push(
            seg({
              id,
              category: roleCategory(role),
              label: `message ${mi + 1} document`,
              path,
              text: blockJson(block["source"] ?? block),
              raw: block,
              cacheControl: readCacheControl(block),
            }),
          );
          break;
        default:
          segments.push(
            seg({
              id,
              category: otherBlockCategory(block.type, role),
              label: `message ${mi + 1} (${role}) ${typeof block.type === "string" ? block.type : "content"}`,
              path,
              text: blockJson(block),
              raw: block,
            }),
          );
      }
    });
  });

  attachPromptIdentity(obj, segments, "anthropic");
  applyAutomaticBreakpoint(obj, segments);

  const model = typeof obj["model"] === "string" ? (obj["model"] as string) : undefined;
  return { provider: "anthropic", index, model, raw, segments };
}
