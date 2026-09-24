import type { SegmentCategory } from "@core/types.js";

export const CATEGORY_LABEL: Record<SegmentCategory, string> = {
  system: "system",
  tools: "tool definitions",
  user: "user text",
  assistant: "assistant text",
  tool_call: "tool calls",
  tool_result: "tool results",
  image: "images",
  thinking: "thinking",
};

// Matches the --cat-* custom properties in style.css (a colorblind-validated 8-slot categorical
// palette, in its fixed hue order - see the README's "How it works" section).
export const CATEGORY_ORDER: SegmentCategory[] = ["system", "tools", "user", "assistant", "tool_call", "tool_result", "image", "thinking"];

export function categoryVar(category: SegmentCategory): string {
  return `var(--cat-${category})`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtUsd(n: number | undefined): string {
  if (n === undefined) return "n/a";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

/** Whole-dollar, thousands-separated - for the "per 1,000 sessions" projection, where `fmtUsd`'s
 * fixed 2-4 decimal places is the wrong shape once the number is in the hundreds or thousands. */
export function fmtUsdRounded(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtPct(n: number | undefined, digits = 1): string {
  if (n === undefined) return "n/a";
  return `${(n * 100).toFixed(digits)}%`;
}

export function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
