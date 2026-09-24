import type { Provider } from "./types.js";

/**
 * Auto-detects whether a single request object is Anthropic Messages API or
 * OpenAI Chat Completions shaped. Scores a handful of shape-specific
 * signals rather than requiring one exact marker, since real requests often
 * carry only a subset (e.g. no tools, no system prompt).
 */
export function detectFormat(request: unknown): Provider {
  const scores = { anthropic: 0, openai: 0 };
  if (request === null || typeof request !== "object") return "anthropic";
  const obj = request as Record<string, unknown>;

  // Top-level `system` as a field is Anthropic-only; OpenAI has no such field.
  if ("system" in obj) scores.anthropic += 2;

  const tools = Array.isArray(obj["tools"]) ? (obj["tools"] as unknown[]) : [];
  for (const tool of tools) {
    if (tool !== null && typeof tool === "object") {
      const t = tool as Record<string, unknown>;
      if ("input_schema" in t) scores.anthropic += 2;
      if (t["type"] === "function" && "function" in t) scores.openai += 2;
    }
  }

  const messages = Array.isArray(obj["messages"]) ? (obj["messages"] as unknown[]) : [];
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const m = message as Record<string, unknown>;
    if (m["role"] === "tool") scores.openai += 2;
    if (m["role"] === "developer") scores.openai += 2;
    if (m["role"] === "system") scores.openai += 1; // Anthropic never uses a "system" message role
    if (Array.isArray(m["tool_calls"])) scores.openai += 2;
    if (typeof m["content"] === "string") scores.openai += 0.25; // both allow this; weak signal
    const content = Array.isArray(m["content"]) ? (m["content"] as unknown[]) : [];
    for (const block of content) {
      if (block === null || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      switch (b["type"]) {
        case "tool_use":
        case "tool_result":
        case "document":
        case "thinking":
        case "redacted_thinking":
          scores.anthropic += 2;
          break;
        case "image_url":
        case "input_audio":
        case "refusal":
          scores.openai += 2;
          break;
        case "image":
          // Anthropic image blocks use {type:"image", source:{...}}; OpenAI uses {type:"image_url", image_url:{...}}.
          if ("source" in b) scores.anthropic += 2;
          break;
        default:
          break;
      }
    }
  }

  return scores.openai > scores.anthropic ? "openai" : "anthropic";
}
