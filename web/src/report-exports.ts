import type { AnalysisResult } from "@core/types.js";
import { toJsonReport } from "@core/json-report.js";
import { renderHtmlReport } from "../../src/cli/html-report.js";
import { $ } from "./lib/dom.js";

/** A complete analysis can be saved whether or not its capture contains response usage. */
export function mountReportExports(root: HTMLElement, result: AnalysisResult): void {
  root.innerHTML = `
    <h2 id="report-exports-heading">Save report</h2>
    <div class="report-downloads"><button class="btn" id="report-json" type="button">Download full JSON report</button><button class="btn" id="report-html" type="button">Download offline HTML report</button><span class="muted">All requests, findings and available counter paths; prompt and response text omitted.</span></div>
    <p class="usage-issue" id="report-export-error" role="alert" hidden></p>
  `;
  for (const format of ["json", "html"] as const) $("#report-" + format, root).addEventListener("click", () => {
    const error = $("#report-export-error", root);
    error.hidden = true;
    try {
      const content = format === "json" ? toJsonReport(result) : renderHtmlReport(result);
      const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/html" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `contextscope-report.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      error.textContent = "Could not build the report. Try a smaller capture, or export it with the CLI.";
      error.hidden = false;
    }
  });
}
