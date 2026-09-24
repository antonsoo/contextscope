import type { ParsedRequest, Segment, SegmentCategory } from "./types.js";
import { canonicalJson } from "./json-utils.js";
import { countOpenaiTokens } from "./tokenize-openai.js";
import { estimateClaudeTokens } from "./tokenize-claude.js";

interface OpenAiContentPart {
  type?: string;
  text?: string;
  image_url?: unknown;
  [key: string]: unknown;
}

function makeSegment(params: { id: string; category: SegmentCategory; label: string; path: string; text: string; raw: unknown }): Segment {
  return {
    ...params,
    charLength: params.text.length,
    openaiTokens: countOpenaiTokens(params.text),
    claudeTokensEstimate: estimateClaudeTokens(params.text),
  };
}

/**
 * Parses one OpenAI Chat Completions request body into segments, ordered
 * `tools -> messages` (OpenAI has no separate top-level system field; the
 * system/developer message is simply `messages[0]`).
 */
export function parseOpenAiRequest(raw: unknown, index: number): ParsedRequest {
  const obj = (raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const segments: Segment[] = [];

  const tools = Array.isArray(obj["tools"]) ? (obj["tools"] as Record<string, unknown>[]) : [];
  tools.forEach((tool, i) => {
    const fn = (tool["function"] as Record<string, unknown> | undefined) ?? {};
    const name = typeof fn["name"] === "string" ? (fn["name"] as string) : `tool_${i}`;
    segments.push(
      makeSegment({
        id: `tools[${i}]`,
        category: "tools",
        label: `tool: ${name}`,
        path: `tools[${i}]`,
        text: canonicalJson(tool),
        raw: tool,
      }),
    );
  });

  const messages = Array.isArray(obj["messages"]) ? (obj["messages"] as Record<string, unknown>[]) : [];
  messages.forEach((message, mi) => {
    const role = typeof message["role"] === "string" ? message["role"] : "user";
    const category: SegmentCategory = role === "system" || role === "developer" ? "system" : role === "assistant" ? "assistant" : role === "tool" ? "tool_result" : "user";
    const content = message["content"];

    if (typeof content === "string" || content === undefined || content === null) {
      if (typeof content === "string" && content.length > 0) {
        segments.push(
          makeSegment({
            id: `messages[${mi}].content`,
            category,
            label: `message ${mi + 1} (${role}) text`,
            path: `messages[${mi}].content`,
            text: content,
            raw: message,
          }),
        );
      }
    } else if (Array.isArray(content)) {
      (content as OpenAiContentPart[]).forEach((part, pi) => {
        const path = `messages[${mi}].content[${pi}]`;
        if (part.type === "text") {
          segments.push(
            makeSegment({ id: path, category, label: `message ${mi + 1} (${role}) text`, path, text: part.text ?? "", raw: part }),
          );
        } else if (part.type === "image_url") {
          segments.push(
            makeSegment({ id: path, category: "image", label: `message ${mi + 1} image`, path, text: canonicalJson(part.image_url), raw: part }),
          );
        } else {
          segments.push(
            makeSegment({ id: path, category, label: `message ${mi + 1} (${role}) ${part.type ?? "content"}`, path, text: canonicalJson(part), raw: part }),
          );
        }
      });
    }

    // assistant tool calls
    const toolCalls = Array.isArray(message["tool_calls"]) ? (message["tool_calls"] as Record<string, unknown>[]) : [];
    toolCalls.forEach((call, ci) => {
      const fn = (call["function"] as Record<string, unknown> | undefined) ?? {};
      const path = `messages[${mi}].tool_calls[${ci}]`;
      segments.push(
        makeSegment({
          id: path,
          category: "tool_call",
          label: `message ${mi + 1} tool_call: ${String(fn["name"] ?? "?")}`,
          path,
          text: canonicalJson(call),
          raw: call,
        }),
      );
    });

    // legacy function_call (pre tool_calls)
    if (message["function_call"] !== undefined && message["function_call"] !== null) {
      const path = `messages[${mi}].function_call`;
      segments.push(
        makeSegment({
          id: path,
          category: "tool_call",
          label: `message ${mi + 1} function_call`,
          path,
          text: canonicalJson(message["function_call"]),
          raw: message["function_call"],
        }),
      );
    }
  });

  const model = typeof obj["model"] === "string" ? (obj["model"] as string) : undefined;
  return { provider: "openai", index, model, raw, segments };
}
