import type { CacheControl, CacheTtl, ParsedRequest, Segment, SegmentCategory } from "./types.js";
import { blockJson } from "./json-utils.js";
import { countTokens, type TokenCounter } from "./token-counter.js";

interface AnthropicBlock {
  type?: string;
  text?: string;
  cache_control?: { type?: string; ttl?: string };
  [key: string]: unknown;
}

function readCacheControl(block: { cache_control?: { type?: string; ttl?: string } }): CacheControl | undefined {
  const cc = block.cache_control;
  if (!cc || cc.type !== "ephemeral") return undefined;
  const ttl: CacheTtl = cc.ttl === "1h" ? "1h" : "5m";
  return { type: "ephemeral", ttl };
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
  const counts = counter(params.text);
  return {
    ...rest,
    charLength: params.text.length,
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
function otherBlockCategory(type: string | undefined, role: string): SegmentCategory {
  if (type === "server_tool_use" || type === "mcp_tool_use") return "tool_call";
  if (type !== undefined && type.endsWith("_tool_result")) return "tool_result";
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

  const tools = Array.isArray(obj["tools"]) ? (obj["tools"] as AnthropicBlock[]) : [];
  tools.forEach((tool, i) => {
    const name = typeof tool["name"] === "string" ? (tool["name"] as string) : `tool_${i}`;
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
    (system as AnthropicBlock[]).forEach((block, i) => {
      segments.push(
        seg({
          id: `system[${i}]`,
          category: "system",
          label: `system block ${i + 1}`,
          path: `system[${i}]`,
          text: typeof block.text === "string" ? block.text : blockJson(block),
          raw: block,
          cacheControl: readCacheControl(block),
        }),
      );
    });
  }

  const messages = Array.isArray(obj["messages"]) ? (obj["messages"] as Record<string, unknown>[]) : [];
  messages.forEach((message, mi) => {
    const role = typeof message["role"] === "string" ? message["role"] : "user";
    const content = message["content"];
    const blocks: AnthropicBlock[] =
      typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as AnthropicBlock[]) : [];

    blocks.forEach((block, bi) => {
      const path = `messages[${mi}].content[${bi}]`;
      const id = path;
      switch (block.type) {
        case "text":
          segments.push(
            seg({
              id,
              category: roleCategory(role),
              label: `message ${mi + 1} (${role}) text`,
              path,
              text: block.text ?? "",
              raw: block,
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
                    .map((c) => (c !== null && typeof c === "object" && typeof (c as AnthropicBlock).text === "string" ? (c as AnthropicBlock).text : blockJson(c)))
                    .join("\n")
                : blockJson(resultContent);
          segments.push(
            seg({
              id,
              category: "tool_result",
              label: `message ${mi + 1} tool_result`,
              path,
              text: text ?? "",
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
              label: `message ${mi + 1} (${role}) ${block.type ?? "content"}`,
              path,
              text: blockJson(block),
              raw: block,
            }),
          );
      }
    });
  });

  const model = typeof obj["model"] === "string" ? (obj["model"] as string) : undefined;
  return { provider: "anthropic", index, model, raw, segments };
}
