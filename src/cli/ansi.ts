/** Minimal ANSI helpers - no chalk dependency; contextscope has almost no runtime deps by design. */

const isTTY = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

function wrap(code: string): (s: string) => string {
  return (s: string) => (isTTY ? `\u001b[${code}m${s}\u001b[0m` : s);
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

export function fmtPct(n: number | undefined): string {
  if (n === undefined) return "n/a";
  return `${(n * 100).toFixed(1)}%`;
}
