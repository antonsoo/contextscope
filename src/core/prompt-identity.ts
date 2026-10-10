import type { Provider, Segment } from "./types.js";
import { isRecord } from "./json-utils.js";

/** The message's header belongs to every part; following tool calls have their own segments. */
function header(message: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(message).filter(([key]) => !["content", "tool_calls", "function_call"].includes(key)));
}

/** A tool result's string content is shorthand for one text block, as a message's string content is. */
function withTextBlockContent(block: unknown): unknown {
  if (!isRecord(block) || block["type"] !== "tool_result" || typeof block["content"] !== "string") return block;
  return { ...block, content: [{ type: "text", text: block["content"] }] };
}

/** Attach source prompt units after parsing, without changing their text or token counts.
 * A start marker retains message boundaries without binding history to absolute indices:
 * a sliding-window rewrite can still match older messages at their new positions. */
export function attachPromptIdentity(request: Record<string, unknown>, segments: Segment[], provider: Provider): void {
  let previousMessage: string | undefined;
  for (const segment of segments) {
    const path = segment.path;
    const messagePath = /^messages\[(\d+)\](.*)$/.exec(path);
    if (messagePath) {
      const index = Number(messagePath[1]);
      const message = (request["messages"] as unknown[])[index];
      const owner = `messages:${index}`;
      const context = { api: provider === "anthropic" ? "messages" : "chat", header: isRecord(message) ? header(message) : null, startsMessage: owner !== previousMessage };
      previousMessage = owner;
      let content: unknown = message;
      if (isRecord(message)) {
        const suffix = messagePath[2]!;
        const part = /^\.content\[(\d+)\]$/.exec(suffix);
        const call = /^\.tool_calls\[(\d+)\]$/.exec(suffix);
        if (suffix.startsWith(".content")) {
          const raw = message["content"];
          content = typeof raw === "string" ? { type: "text", text: raw }
            : part && Array.isArray(raw) ? (provider === "anthropic" ? withTextBlockContent(raw[Number(part[1])]) : raw[Number(part[1])]) : raw;
        } else if (call && Array.isArray(message["tool_calls"])) content = message["tool_calls"][Number(call[1])];
        else if (suffix === ".function_call") content = message["function_call"];
      }
      segment.prefix = { context, content };
      continue;
    }

    const responsePath = /^input\[(\d+)\](.*)$/.exec(path);
    if (provider === "openai" && responsePath && Array.isArray(request["input"])) {
      const index = Number(responsePath[1]);
      const item = request["input"][index];
      const owner = `input:${index}`;
      const outputPart = /^\.output\[(\d+)\]$/.exec(responsePath[2]!);
      if (isRecord(item) && outputPart && Array.isArray(item["output"])) {
        segment.prefix = {
          context: { api: "responses", header: Object.fromEntries(Object.entries(item).filter(([key]) => key !== "output")), startsMessage: owner !== previousMessage },
          content: item["output"][Number(outputPart[1])],
        };
        previousMessage = owner;
        continue;
      }
      const message = isRecord(item) && (item["type"] === undefined || item["type"] === "message");
      const context = { api: "responses", header: message ? header(item) : null, startsMessage: owner !== previousMessage };
      previousMessage = owner;
      let content: unknown = item;
      if (message && responsePath[2]!.startsWith(".content")) {
        const raw = item["content"];
        const part = /^\.content\[(\d+)\]$/.exec(responsePath[2]!);
        content = typeof raw === "string" ? { type: item["role"] === "assistant" ? "output_text" : "input_text", text: raw }
          : part && Array.isArray(raw) ? raw[Number(part[1])] : raw;
      }
      segment.prefix = { context, content };
      continue;
    }

    // A plain system string is shorthand for one text block, not a different prompt.
    const system = /^system(?:\[(\d+)\])?$/.exec(path);
    if (provider === "anthropic" && system) {
      const raw = request["system"];
      segment.prefix = { content: typeof raw === "string" ? { type: "text", text: raw }
        : Array.isArray(raw) && system[1] !== undefined ? raw[Number(system[1])] : raw };
    } else segment.prefix = { content: segment.raw };
  }
}
