/** Minimal ANSI helpers - no chalk dependency; contextscope has almost no runtime deps by design. */

const colorEnabled =
  process.env["NO_COLOR"] === undefined && (process.stdout.isTTY === true || process.env["FORCE_COLOR"] !== undefined);

function wrap(code: string): (s: string) => string {
  return (s: string) => (colorEnabled ? `\u001b[${code}m${s}\u001b[0m` : s);
}

export const bold = wrap("1");
export const dim = wrap("2");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const blue = wrap("34");
export const magenta = wrap("35");
export const cyan = wrap("36");

export function severityColor(severity: "info" | "warning" | "error"): (s: string) => string {
  if (severity === "error") return red;
  if (severity === "warning") return yellow;
  return cyan;
}

export function bar(fraction: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function fmtTokens(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtUsd(n: number | undefined): string {
  if (n === undefined) return "n/a";
  return `$${n.toFixed(4)}`;
}

/** Whole-dollar formatting with thousands separators, for the "per 1,000 sessions" projection -
 * `fmtUsd`'s 4-decimal-place precision is the wrong shape once the number is in the hundreds/thousands. */
export function fmtUsdRounded(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtPct(n: number | undefined): string {
  if (n === undefined) return "n/a";
  return `${(n * 100).toFixed(1)}%`;
}

export function terminalWidth(): number {
  return process.stdout.columns || 100;
}

/**
 * Word-wraps `text` to `width` columns with a hanging indent: the first line is prefixed with
 * `indent` spaces same as every following line, so a long finding description lines up under its
 * own text instead of resetting to column 0 mid-sentence (the terminal's own soft-wrap would do
 * the latter, since it has no notion of our indent).
 */
export function wrapIndented(text: string, indent: number, width = terminalWidth()): string[] {
  const usable = Math.max(20, width - indent);
  const prefix = " ".repeat(indent);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > usable && current.length > 0) {
      lines.push(prefix + current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) lines.push(prefix + current);
  return lines;
}
