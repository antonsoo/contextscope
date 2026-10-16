import { canonicalJson, isRecord } from "./json-utils.js";
import { normalizeModelId } from "./pricing.js";
import type { ParsedRequest } from "./types.js";

// Claude API defaults checked 2026-10-16, not inferred from the pricing fallback.
// https://platform.claude.com/docs/en/build-with-claude/thinking#configuring-thinking
// https://platform.claude.com/docs/en/build-with-claude/effort#effort-levels
const DEFAULTS: Readonly<Record<string, { thinking: "adaptive" | "disabled"; effort?: "high" | "medium" }>> = {
  "claude-fable-5-1": { thinking: "adaptive", effort: "high" },
  "claude-fable-5": { thinking: "adaptive", effort: "high" },
  "claude-mythos-5-1": { thinking: "adaptive", effort: "high" },
  "claude-mythos-5": { thinking: "adaptive", effort: "high" },
  "claude-mythos-preview": { thinking: "adaptive", effort: "high" },
  "claude-opus-5-5": { thinking: "adaptive", effort: "medium" },
  "claude-opus-5": { thinking: "adaptive", effort: "high" },
  "claude-opus-4-8": { thinking: "disabled", effort: "high" },
  "claude-opus-4-7": { thinking: "disabled", effort: "high" },
  "claude-opus-4-6": { thinking: "disabled", effort: "high" },
  "claude-opus-4-5": { thinking: "disabled", effort: "high" },
  "claude-sonnet-5-5": { thinking: "adaptive", effort: "high" },
  "claude-sonnet-5": { thinking: "adaptive", effort: "high" },
  "claude-sonnet-4-6": { thinking: "disabled", effort: "high" },
  "claude-sonnet-4-5": { thinking: "disabled" },
  "claude-haiku-5-5": { thinking: "adaptive", effort: "medium" },
  "claude-haiku-4-5": { thinking: "disabled" },
};

export interface AnthropicReasoningScope { thinking: string; effort: string }

/** Top-level thinking/effort changes always invalidate message entries. Setup
 * survival is model-specific, so the simulator conservatively isolates every
 * level. This is not a prediction of the provider's hidden prompt placement.
 * Per-message effort stays in message identity and never changes this scope.
 * https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-and-prompt-caching
 */
export function anthropicReasoningScope(request: ParsedRequest): AnthropicReasoningScope {
  const raw = isRecord(request.raw) ? request.raw : {};
  const model = request.model === undefined ? undefined : normalizeModelId(request.model);
  const defaults = model !== undefined && Object.hasOwn(DEFAULTS, model) ? DEFAULTS[model] : undefined;
  let thinking = raw.thinking;
  if (isRecord(thinking) && (thinking.type === "adaptive" || thinking.type === "enabled")
    && (thinking.display === undefined || (typeof thinking.display === "string"
      && ["summarized", "omitted", "updates"].includes(thinking.display)))) {
    // Display controls returned thinking text, not mode or reasoning budget.
    // Preserve unrecognized fields conservatively rather than erasing them.
    thinking = Object.fromEntries(Object.entries(thinking).filter(([key]) => key !== "display"));
  }
  const config = raw.output_config;
  const effort = isRecord(config) ? config.effort : undefined;
  return {
    thinking: canonicalJson(thinking !== undefined ? ["value", thinking]
      : defaults ? ["value", { type: defaults.thinking }] : ["unrecorded"]),
    effort: config !== undefined && !isRecord(config) ? canonicalJson(["unrecognized", config])
      : canonicalJson(effort !== undefined ? ["value", effort]
        : defaults?.effort ? ["value", defaults.effort] : ["unrecorded"]),
  };
}

export function anthropicReasoningKey(request: ParsedRequest): string {
  const scope = anthropicReasoningScope(request);
  return JSON.stringify([scope.thinking, scope.effort]);
}
