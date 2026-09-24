import type { CacheControl, CacheTtl, ParsedRequest, Segment, SegmentCategory } from "./types.js";
import { canonicalJson } from "./json-utils.js";
import { countOpenaiTokens } from "./tokenize-openai.js";
import { estimateClaudeTokens } from "./tokenize-claude.js";

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
}): Segment {
  const { cacheControl, ...rest } = params;
  return {
    ...rest,
    charLength: params.text.length,
    openaiTokens: countOpenaiTokens(params.text),
    claudeTokensEstimate: estimateClaudeTokens(params.text),
    ...(cacheControl ? { cacheControl } : {}),
  };
}

/** Parses one Anthropic Messages API request body into provider-order segments: tools -> system -> messages. */
export function parseAnthropicRequest(raw: unknown, index: number): ParsedRequest {
  const obj = (raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const segments: Segment[] = [];

  const tools = Array.isArray(obj["tools"]) ? (obj["tools"] as AnthropicBlock[]) : [];
  tools.forEach((tool, i) => {
    const name = typeof tool["name"] === "string" ? (tool["name"] as string) : `tool_${i}`;
    segments.push(
      makeSegment({
        id: `tools[${i}]`,
        category: "tools",
        label: `tool: ${name}`,
        path: `tools[${i}]`,
        text: canonicalJson(tool),
        raw: tool,
        cacheControl: readCacheControl(tool),
      }),
    );
  });

  const system = obj["system"];
  if (typeof system === "string") {
    segments.push(
      makeSegment({
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
        makeSegment({
          id: `system[${i}]`,
          category: "system",
          label: `system block ${i + 1}`,
          path: `system[${i}]`,
          text: typeof block.text === "string" ? block.text : canonicalJson(block),
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
            makeSegment({
              id,
              category: role === "assistant" ? "assistant" : "user",
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
            makeSegment({
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
            makeSegment({
              id,
              category: "tool_call",
              label: `message ${mi + 1} tool_use: ${String(block["name"] ?? "?")}`,
              path,
              text: canonicalJson(block),
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
                    .map((c) => (c !== null && typeof c === "object" && typeof (c as AnthropicBlock).text === "string" ? (c as AnthropicBlock).text : canonicalJson(c)))
                    .join("\n")
                : canonicalJson(resultContent);
          segments.push(
            makeSegment({
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
            makeSegment({
              id,
              category: "image",
              label: `message ${mi + 1} image`,
              path,
              text: canonicalJson(block["source"] ?? block),
              raw: block,
              cacheControl: readCacheControl(block),
            }),
          );
          break;
        case "document":
          segments.push(
            makeSegment({
              id,
              category: role === "assistant" ? "assistant" : "user",
              label: `message ${mi + 1} document`,
              path,
              text: canonicalJson(block["source"] ?? block),
              raw: block,
              cacheControl: readCacheControl(block),
            }),
          );
          break;
        default:
          segments.push(
            makeSegment({
              id,
              category: role === "assistant" ? "assistant" : "user",
              label: `message ${mi + 1} (${role}) ${block.type ?? "content"}`,
              path,
              text: canonicalJson(block),
              raw: block,
            }),
          );
      }
    });
  });

  const model = typeof obj["model"] === "string" ? (obj["model"] as string) : undefined;
  return { provider: "anthropic", index, model, raw, segments };
}
