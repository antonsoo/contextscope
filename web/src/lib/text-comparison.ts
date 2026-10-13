import { diffLines } from "diff";

// These bound work and DOM size independently. A refused preview is never an
// equality verdict, and the complete source remains available for download.
export const MAX_COMPARISON_CHARS = 500_000;
export const MAX_COMPARISON_LINES = 10_000;
export const MAX_PREVIEW_CHARS = 32_000;
export const MAX_PREVIEW_ROWS = 600;
const CONTEXT_LINES = 3;

export type ComparisonRow =
  | { kind: "omitted"; count: number }
  | { kind: "context" | "removed" | "added"; firstLine: number | null; secondLine: number | null; text: string; ending: "LF" | "CRLF" | "none" };

export type TextComparison =
  | { kind: "identical" }
  | { kind: "limited"; reason: "input" | "work" | "preview" }
  | { kind: "diff"; removedLines: number; addedLines: number; rows: ComparisonRow[] };

/** Keep endings in the tokens; in particular, a missing final newline is a change. */
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Literal, case- and whitespace-sensitive line comparison, with folded context. */
export function compareText(first: string, second: string): TextComparison {
  if (first === second) return { kind: "identical" };
  if (first.length + second.length > MAX_COMPARISON_CHARS) return { kind: "limited", reason: "input" };
  if (lines(first).length + lines(second).length > MAX_COMPARISON_LINES) return { kind: "limited", reason: "input" };
  const changes = diffLines(first, second, { maxEditLength: 512, timeout: 40 });
  if (!changes) return { kind: "limited", reason: "work" };
  const rows: ComparisonRow[] = [];
  let firstLine = 1, secondLine = 1, shownCharacters = 0, removedLines = 0, addedLines = 0;
  const append = (row: ComparisonRow): boolean => {
    if (row.kind !== "omitted") shownCharacters += row.text.length;
    if (shownCharacters > MAX_PREVIEW_CHARS || rows.length >= MAX_PREVIEW_ROWS) return false;
    rows.push(row);
    return true;
  };
  for (const [part, change] of changes.entries()) {
    const chunk = lines(change.value);
    const kind = change.removed ? "removed" : change.added ? "added" : "context";
    if (kind === "removed") removedLines += chunk.length;
    if (kind === "added") addedLines += chunk.length;
    const head = kind === "context" ? (part > 0 ? Math.min(CONTEXT_LINES, chunk.length) : 0) : chunk.length;
    const tail = kind === "context" && part < changes.length - 1 ? Math.max(head, chunk.length - CONTEXT_LINES) : chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      if (i === head && tail > head) {
        if (!append({ kind: "omitted", count: tail - head })) return { kind: "limited", reason: "preview" };
        i = tail - 1;
        continue;
      }
      const raw = chunk[i]!;
      const ending = raw.endsWith("\r\n") ? "CRLF" : raw.endsWith("\n") ? "LF" : "none";
      const text = raw.slice(0, raw.length - (ending === "CRLF" ? 2 : ending === "LF" ? 1 : 0));
      if (!append({ kind, firstLine: kind === "added" ? null : firstLine + i,
        secondLine: kind === "removed" ? null : secondLine + i, text, ending })) return { kind: "limited", reason: "preview" };
    }
    if (kind !== "added") firstLine += chunk.length;
    if (kind !== "removed") secondLine += chunk.length;
  }
  return { kind: "diff", removedLines, addedLines, rows };
}

/** JSON-style escapes distinguish tabs, spaces at line ends and invisible controls. */
export function escapedLine(text: string): string {
  return JSON.stringify(text).replace(/[\p{Cf}\u007f-\u009f]/gu, char =>
    `\\u{${char.codePointAt(0)!.toString(16)}}`);
}

/** UTF-8 cannot preserve lone surrogates. Use a JSON string for those texts. */
export function requiresJsonTextDownload(text: string): boolean {
  return /[\ud800-\udfff]/u.test(text);
}

export function textDownload(text: string): { content: string; type: string; extension: string } {
  return requiresJsonTextDownload(text)
    ? { content: JSON.stringify(text), type: "application/json", extension: "text.json" }
    : { content: text, type: "text/plain;charset=utf-8", extension: "txt" };
}
