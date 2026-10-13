import type { Segment } from "@core/types.js";
import { esc } from "./lib/dom.js";
import { compareText, escapedLine, requiresJsonTextDownload, textDownload, type TextComparison } from "./lib/text-comparison.js";

export interface LocatedSegment { requestIndex: number; segment: Segment }

function save(content: string, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function source(label: string, located: LocatedSegment): string {
  const { segment, requestIndex } = located;
  return `<section class="comparison-source" aria-label="${label}">
    <h4>${label} / request ${requestIndex + 1}</h4><code>${esc(segment.path)}</code></section>`;
}

function downloads(side: "first" | "second", located: LocatedSegment): string {
  const encoded = requiresJsonTextDownload(located.segment.text);
  return `<div class="comparison-downloads"><button type="button" class="btn" data-download="${side}-text">Download ${side} text${encoded ? " (JSON)" : ""}</button>
    <button type="button" class="btn" data-download="${side}-raw">Download ${side} original JSON</button></div>
    ${encoded ? `<p>The ${side} text contains unpaired Unicode surrogates. Its text download is a JSON string so those values are preserved.</p>` : ""}`;
}

function renderRows(root: HTMLElement, comparison: Extract<TextComparison, { kind: "diff" }>, escapes: boolean): void {
  const fragment = document.createDocumentFragment();
  for (const row of comparison.rows) {
    const element = document.createElement("div");
    element.className = `comparison-row ${row.kind}`;
    if (row.kind === "omitted") {
      element.textContent = `${row.count.toLocaleString("en-US")} unchanged lines not shown`;
    } else {
      for (const number of [row.firstLine, row.secondLine]) {
        const cell = document.createElement("span");
        cell.className = "comparison-line-number";
        cell.textContent = number === null ? "" : String(number);
        element.append(cell);
      }
      const marker = document.createElement("span");
      marker.className = "comparison-marker";
      marker.textContent = row.kind === "removed" ? "-" : row.kind === "added" ? "+" : " ";
      const text = document.createElement("code");
      // textContent preserves literal markup and control characters. Never parse
      // source text as HTML, including when the user toggles escaped display.
      text.textContent = escapes ? escapedLine(row.text) : row.text;
      if (row.kind !== "context") {
        const ending = document.createElement("span");
        ending.className = "comparison-ending";
        ending.textContent = ` [${row.ending === "none" ? "no final newline" : row.ending}]`;
        text.append(ending);
      }
      element.append(marker, text);
    }
    fragment.append(element);
  }
  root.replaceChildren(fragment);
}

/** Browser-only review. Analysis and portable reports remain untouched. */
export function mountTextComparison(root: HTMLElement, first: LocatedSegment, second: LocatedSegment): void {
  const result = compareText(first.segment.text, second.segment.text);
  const summary = result.kind === "identical"
    ? "The analyzed text is identical. Original JSON may still contain different metadata."
    : result.kind === "limited"
      ? `The text differs. ${result.reason === "input" ? "These blocks exceed the inline comparison size limit." : result.reason === "preview" ? "The changes exceed the display limit." : "The comparison could not finish within the preview work limit."} Download both texts to compare the complete content.`
      : `${result.removedLines} line${result.removedLines === 1 ? "" : "s"} removed from the first text; ${result.addedLines} line${result.addedLines === 1 ? "" : "s"} added in the compared text.`;
  root.innerHTML = `<p class="comparison-intro">Compare the analyzed text used for duplicate detection. This does not establish that either block is safe to remove.</p>
    <div class="comparison-sources">${source("First match", first)}${source("Compared match", second)}</div>
    <p class="comparison-summary" role="status">${summary}</p>
    ${result.kind === "diff" ? `<label class="comparison-escapes"><input type="checkbox" id="comparison-escapes"> Show whitespace and control-character escapes</label>
      <p class="hint">Line numbers: first text / compared text. Minus removes; plus adds. Line endings are shown as LF, CRLF or no final newline.</p>
      <div class="comparison-diff" role="region" aria-label="Text differences" tabindex="0"></div>` : ""}
    <div class="comparison-files">${downloads("first", first)}${downloads("second", second)}</div>`;
  for (const [side, located] of [["first", first], ["second", second]] as const) {
    root.querySelector(`[data-download="${side}-text"]`)!.addEventListener("click", () => {
      const download = textDownload(located.segment.text);
      save(download.content, download.type, `contextscope-${side}-req-${located.requestIndex + 1}.${download.extension}`);
    });
    root.querySelector(`[data-download="${side}-raw"]`)!.addEventListener("click", () => {
      save(JSON.stringify(located.segment.raw, null, 2), "application/json", `contextscope-${side}-req-${located.requestIndex + 1}-original.json`);
    });
  }
  if (result.kind === "diff") {
    const output = root.querySelector<HTMLElement>(".comparison-diff")!;
    const toggle = root.querySelector<HTMLInputElement>("#comparison-escapes")!;
    renderRows(output, result, false);
    toggle.addEventListener("change", () => renderRows(output, result, toggle.checked));
  }
}
