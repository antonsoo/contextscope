import type { ParsedRequest, Segment, SegmentCategory } from "./types.js";
import { canonicalJson } from "./json-utils.js";
import { countTokens, type TokenCounter } from "./token-counter.js";

interface OpenAiContentPart {
  type?: string;
  text?: string;
  image_url?: unknown;
  [key: string]: unknown;
}

type SegmentParams = { id: string; category: SegmentCategory; label: string; path: string; text: string; raw: unknown };

function makeSegment(params: SegmentParams, counter: TokenCounter): Segment {
  const counts = counter(params.text);
  return {
    ...params,
    charLength: params.text.length,
    openaiTokens: counts.openai,
    claudeTokensEstimate: counts.claude,
  };
}

/**
 * Parses one OpenAI request body into segments, ordered `tools -> messages`.
 * Two shapes are understood: Chat Completions (`messages`; the
 * system/developer message is simply `messages[0]`) and the Responses API
 * (`instructions` + `input`, where `input` is a string or a list of message,
 * function_call, function_call_output and reasoning items).
 */
export function parseOpenAiRequest(raw: unknown, index: number, counter: TokenCounter = countTokens): ParsedRequest {
  const seg = (params: SegmentParams): Segment => makeSegment(params, counter);
  const obj = (raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const segments: Segment[] = [];

  const tools = Array.isArray(obj["tools"]) ? (obj["tools"] as Record<string, unknown>[]) : [];
  tools.forEach((tool, i) => {
    // Chat Completions nests the definition under `function`; the Responses API flattens it.
    const fn = (tool["function"] as Record<string, unknown> | undefined) ?? tool;
    const name = typeof fn["name"] === "string" ? (fn["name"] as string) : typeof tool["type"] === "string" ? (tool["type"] as string) : `tool_${i}`;
    segments.push(
      seg({
        id: `tools[${i}]`,
        category: "tools",
        label: `tool: ${name}`,
        path: `tools[${i}]`,
        text: canonicalJson(tool),
        raw: tool,
      }),
    );
  });

  if (!Array.isArray(obj["messages"]) && ("input" in obj || "instructions" in obj)) {
    segments.push(...parseResponsesBody(obj, seg));
    const model = typeof obj["model"] === "string" ? (obj["model"] as string) : undefined;
    return { provider: "openai", index, model, raw, segments };
  }

  const messages = Array.isArray(obj["messages"]) ? (obj["messages"] as Record<string, unknown>[]) : [];
  messages.forEach((message, mi) => {
    const role = typeof message["role"] === "string" ? message["role"] : "user";
    const category = roleCategory(role);
    const content = message["content"];

    if (typeof content === "string" || content === undefined || content === null) {
      if (typeof content === "string" && content.length > 0) {
        segments.push(
          seg({
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
            seg({ id: path, category, label: `message ${mi + 1} (${role}) text`, path, text: part.text ?? "", raw: part }),
          );
        } else if (part.type === "image_url") {
          segments.push(
            seg({ id: path, category: "image", label: `message ${mi + 1} image`, path, text: canonicalJson(part.image_url), raw: part }),
          );
        } else {
          segments.push(
            seg({ id: path, category, label: `message ${mi + 1} (${role}) ${part.type ?? "content"}`, path, text: canonicalJson(part), raw: part }),
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
        seg({
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
        seg({
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

function roleCategory(role: string): SegmentCategory {
  return role === "system" || role === "developer" ? "system" : role === "assistant" ? "assistant" : role === "tool" ? "tool_result" : "user";
}

/** Responses API: `instructions` then each `input` item, in order. */
function parseResponsesBody(obj: Record<string, unknown>, seg: (params: SegmentParams) => Segment): Segment[] {
  const segments: Segment[] = [];
  if (typeof obj["instructions"] === "string" && obj["instructions"].length > 0) {
    segments.push(seg({ id: "instructions", category: "system", label: "instructions", path: "instructions", text: obj["instructions"], raw: obj["instructions"] }));
  }

  const input = obj["input"];
  if (typeof input === "string") {
    if (input.length > 0) segments.push(seg({ id: "input", category: "user", label: "input (user) text", path: "input", text: input, raw: input }));
    return segments;
  }
  if (!Array.isArray(input)) return segments;

  (input as Record<string, unknown>[]).forEach((item, ii) => {
    if (item === null || typeof item !== "object") return;
    const path = `input[${ii}]`;
    const type = typeof item["type"] === "string" ? (item["type"] as string) : "message";
    switch (type) {
      case "message": {
        const role = typeof item["role"] === "string" ? (item["role"] as string) : "user";
        const category = roleCategory(role);
        const content = item["content"];
        if (typeof content === "string") {
          if (content.length > 0) segments.push(seg({ id: path, category, label: `item ${ii + 1} (${role}) text`, path: `${path}.content`, text: content, raw: item }));
        } else if (Array.isArray(content)) {
          (content as OpenAiContentPart[]).forEach((part, pi) => {
            const partPath = `${path}.content[${pi}]`;
            const partType = part.type ?? "content";
            if ((partType === "input_text" || partType === "output_text" || partType === "text") && typeof part.text === "string") {
              segments.push(seg({ id: partPath, category, label: `item ${ii + 1} (${role}) text`, path: partPath, text: part.text, raw: part }));
            } else if (partType === "input_image") {
              segments.push(seg({ id: partPath, category: "image", label: `item ${ii + 1} image`, path: partPath, text: canonicalJson(part), raw: part }));
            } else {
              segments.push(seg({ id: partPath, category, label: `item ${ii + 1} (${role}) ${partType}`, path: partPath, text: canonicalJson(part), raw: part }));
            }
          });
        }
        break;
      }
      case "function_call":
        segments.push(seg({ id: path, category: "tool_call", label: `item ${ii + 1} function_call: ${String(item["name"] ?? "?")}`, path, text: canonicalJson(item), raw: item }));
        break;
      case "function_call_output": {
        const output = item["output"];
        segments.push(seg({ id: path, category: "tool_result", label: `item ${ii + 1} function_call_output`, path, text: typeof output === "string" ? output : canonicalJson(output), raw: item }));
        break;
      }
      case "reasoning":
        segments.push(seg({ id: path, category: "thinking", label: `item ${ii + 1} reasoning`, path, text: canonicalJson(item), raw: item }));
        break;
      default:
        // Built-in tool calls (web_search_call, file_search_call, computer_call, ...) and their outputs.
        segments.push(
          seg({
            id: path,
            category: type.endsWith("_output") ? "tool_result" : type.endsWith("_call") ? "tool_call" : "user",
            label: `item ${ii + 1} ${type}`,
            path,
            text: canonicalJson(item),
            raw: item,
          }),
        );
    }
  });
  return segments;
}
