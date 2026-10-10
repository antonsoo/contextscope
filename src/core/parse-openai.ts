import type { ParsedRequest, Segment, SegmentCategory } from "./types.js";
import { asText, blockJson, isRecord } from "./json-utils.js";
import { countTokens, type TokenCounter } from "./token-counter.js";
import { attachPromptIdentity } from "./prompt-identity.js";

interface OpenAiContentPart {
  type?: string;
  text?: string;
  image_url?: unknown;
  [key: string]: unknown;
}

/**
 * Tokens the Chat Completions format adds around each message (role, delimiters), which the
 * message's text does not contain. Measured on 2,205 requests of gpt-5.1 and gpt-5.2 whose
 * messages were all plain text: reported prompt_tokens equalled the o200k_base count of the
 * contents plus exactly 5 per message, with no remainder in any request (see
 * studies/real-trajectories/README.md). Not measured for messages with array content, tool calls
 * or tool definitions, or for other models, so only plain-string messages get it.
 */
const CHAT_MESSAGE_FRAMING_TOKENS = 5;

type SegmentParams = { id: string; category: SegmentCategory; label: string; path: string; text: string; raw: unknown };

function makeSegment(params: SegmentParams, counter: TokenCounter): Segment {
  // `text` is whatever the log had in that position: a number or an object is kept as its JSON.
  const text = asText(params.text);
  const counts = counter(text);
  return {
    ...params,
    text,
    charLength: text.length,
    openaiTokens: counts.openai,
    claudeTokensEstimate: counts.claude,
    ...(isRecord(params.raw) && isRecord(params.raw["prompt_cache_breakpoint"]) && params.raw["prompt_cache_breakpoint"].mode === "explicit" ? { promptCacheBreakpoint: true as const } : {}),
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

  const tools: unknown[] = Array.isArray(obj["tools"]) ? obj["tools"] : [];
  tools.forEach((entry, i) => {
    const tool = isRecord(entry) ? entry : {};
    // Chat Completions nests the definition under `function`; the Responses API flattens it.
    const fn = isRecord(tool["function"]) ? tool["function"] : tool;
    const name = typeof fn["name"] === "string" ? fn["name"] : typeof tool["type"] === "string" ? tool["type"] : `tool_${i}`;
    segments.push(
      seg({
        id: `tools[${i}]`,
        category: "tools",
        label: `tool: ${name}`,
        path: `tools[${i}]`,
        text: blockJson(entry),
        raw: entry,
      }),
    );
  });

  if (!Array.isArray(obj["messages"]) && ("input" in obj || "instructions" in obj)) {
    segments.push(...parseResponsesBody(obj, seg));
    attachPromptIdentity(obj, segments, "openai");
    const model = typeof obj["model"] === "string" ? (obj["model"] as string) : undefined;
    return { provider: "openai", index, model, raw, segments };
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
    const category = roleCategory(role);
    const content = message["content"];

    if (typeof content === "string" || content === undefined || content === null) {
      if (typeof content === "string" && content.length > 0) {
        const segment = seg({
          id: `messages[${mi}].content`,
          category,
          label: `message ${mi + 1} (${role}) text`,
          path: `messages[${mi}].content`,
          text: content,
          raw: message,
        });
        segment.openaiTokens += CHAT_MESSAGE_FRAMING_TOKENS;
        segments.push(segment);
      }
    } else if (Array.isArray(content)) {
      (content as unknown[]).forEach((entry, pi) => {
        const path = `messages[${mi}].content[${pi}]`;
        if (!isRecord(entry)) {
          segments.push(seg({ id: path, category, label: `message ${mi + 1} (${role}) malformed part`, path, text: blockJson(entry), raw: entry }));
          return;
        }
        const part: OpenAiContentPart = entry;
        if (part.type === "text") {
          segments.push(
            seg({ id: path, category, label: `message ${mi + 1} (${role}) text`, path, text: asText(part.text ?? ""), raw: part }),
          );
        } else if (part.type === "image_url") {
          segments.push(
            seg({ id: path, category: "image", label: `message ${mi + 1} image`, path, text: blockJson(part.image_url), raw: part }),
          );
        } else {
          segments.push(
            seg({ id: path, category, label: `message ${mi + 1} (${role}) ${typeof part.type === "string" ? part.type : "content"}`, path, text: blockJson(part), raw: part }),
          );
        }
      });
    } else {
      // A number or an object where the content should be: still part of what was sent.
      const path = `messages[${mi}].content`;
      segments.push(seg({ id: path, category, label: `message ${mi + 1} (${role}) malformed content`, path, text: blockJson(content), raw: message }));
    }

    // assistant tool calls
    const toolCalls: unknown[] = Array.isArray(message["tool_calls"]) ? message["tool_calls"] : [];
    toolCalls.forEach((call, ci) => {
      const fn = isRecord(call) && isRecord(call["function"]) ? call["function"] : {};
      const path = `messages[${mi}].tool_calls[${ci}]`;
      segments.push(
        seg({
          id: path,
          category: "tool_call",
          label: `message ${mi + 1} tool_call: ${String(fn["name"] ?? "?")}`,
          path,
          text: blockJson(call),
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
          text: blockJson(message["function_call"]),
          raw: message["function_call"],
        }),
      );
    }
  });

  attachPromptIdentity(obj, segments, "openai");
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
  } else if (obj["instructions"] !== undefined && obj["instructions"] !== null && typeof obj["instructions"] !== "string") {
    segments.push(seg({ id: "instructions", category: "system", label: "instructions (malformed)", path: "instructions", text: blockJson(obj["instructions"]), raw: obj["instructions"] }));
  }

  const input = obj["input"];
  if (typeof input === "string") {
    if (input.length > 0) segments.push(seg({ id: "input", category: "user", label: "input (user) text", path: "input", text: input, raw: input }));
    return segments;
  }
  if (!Array.isArray(input)) {
    if (input !== undefined && input !== null) segments.push(seg({ id: "input", category: "user", label: "input (malformed)", path: "input", text: blockJson(input), raw: input }));
    return segments;
  }

  (input as unknown[]).forEach((item, ii) => {
    const path = `input[${ii}]`;
    if (!isRecord(item)) {
      // Not an item object (null, a bare string): kept whole, so later positions don't shift.
      segments.push(seg({ id: path, category: "user", label: `item ${ii + 1} (malformed)`, path, text: blockJson(item), raw: item }));
      return;
    }
    const type = typeof item["type"] === "string" ? (item["type"] as string) : "message";
    switch (type) {
      case "message": {
        const role = typeof item["role"] === "string" ? (item["role"] as string) : "user";
        const category = roleCategory(role);
        const content = item["content"];
        if (typeof content === "string") {
          if (content.length > 0) segments.push(seg({ id: path, category, label: `item ${ii + 1} (${role}) text`, path: `${path}.content`, text: content, raw: item }));
        } else if (Array.isArray(content)) {
          (content as unknown[]).forEach((entry, pi) => {
            const partPath = `${path}.content[${pi}]`;
            if (!isRecord(entry)) {
              segments.push(seg({ id: partPath, category, label: `item ${ii + 1} (${role}) malformed part`, path: partPath, text: blockJson(entry), raw: entry }));
              return;
            }
            const part: OpenAiContentPart = entry;
            const partType = typeof part.type === "string" ? part.type : "content";
            if ((partType === "input_text" || partType === "output_text" || partType === "text") && typeof part.text === "string") {
              segments.push(seg({ id: partPath, category, label: `item ${ii + 1} (${role}) text`, path: partPath, text: part.text, raw: part }));
            } else if (partType === "input_image") {
              segments.push(seg({ id: partPath, category: "image", label: `item ${ii + 1} image`, path: partPath, text: blockJson(part), raw: part }));
            } else {
              segments.push(seg({ id: partPath, category, label: `item ${ii + 1} (${role}) ${partType}`, path: partPath, text: blockJson(part), raw: part }));
            }
          });
        } else if (content !== undefined && content !== null) {
          segments.push(seg({ id: path, category, label: `item ${ii + 1} (${role}) malformed content`, path: `${path}.content`, text: blockJson(content), raw: item }));
        }
        break;
      }
      case "function_call":
        segments.push(seg({ id: path, category: "tool_call", label: `item ${ii + 1} function_call: ${String(item["name"] ?? "?")}`, path, text: blockJson(item), raw: item }));
        break;
      case "function_call_output": {
        const output = item["output"];
        if (Array.isArray(output) && output.length > 0) {
          output.forEach((part, pi) => {
            const partPath = `${path}.output[${pi}]`;
            segments.push(seg({ id: partPath, category: "tool_result", label: `item ${ii + 1} function_call_output part ${pi + 1}`, path: partPath,
              text: isRecord(part) && typeof part.text === "string" ? part.text : blockJson(part), raw: part }));
          });
        } else segments.push(seg({ id: path, category: "tool_result", label: `item ${ii + 1} function_call_output`, path, text: typeof output === "string" ? output : blockJson(output), raw: item }));
        break;
      }
      case "reasoning":
        segments.push(seg({ id: path, category: "thinking", label: `item ${ii + 1} reasoning`, path, text: blockJson(item), raw: item }));
        break;
      default:
        // Built-in tool calls (web_search_call, file_search_call, computer_call, ...) and their outputs.
        segments.push(
          seg({
            id: path,
            category: type.endsWith("_output") ? "tool_result" : type.endsWith("_call") ? "tool_call" : "user",
            label: `item ${ii + 1} ${type}`,
            path,
            text: blockJson(item),
            raw: item,
          }),
        );
    }
  });
  return segments;
}
