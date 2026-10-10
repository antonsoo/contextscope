import type { AnalysisResult } from "../core/types.js";
import { describeRequestIndices, groupFindings } from "../core/group-findings.js";
import { modelGroups, modelLabel, modelNotes, modelSummary } from "../core/model-summary.js";
import { renderUsageHtml } from "./usage-html.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CATEGORY_COLOR: Record<string, string> = {
  system: "#2a78d6",
  tools: "#eb6834",
  user: "#1baf7a",
  assistant: "#eda100",
  tool_call: "#e87ba4",
  tool_result: "#008300",
  image: "#4a3aa7",
  thinking: "#e34948",
};

/** A single self-contained HTML file: no external requests, no JS framework - a static report
 * meant to be opened locally or attached to a PR/ticket. The interactive web app is the place
 * for exploration; this is the "send this to a teammate" artifact. */
/**
 * The report is one file with no script in it, and this has the browser hold it to that:
 * nothing in it may run or be fetched, whatever a tool or a message in the log is called.
 * Text from the log is escaped; the policy is for the day some is not.
 */
const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export function renderHtmlReport(result: AnalysisResult): string {
  const { parse, reports, cacheSimulation, findings, duplicates } = result;

  const mixedModels = modelGroups(result).length > 1;
  const openai = cacheSimulation.provider === "openai";
  const requestSections = reports
    .map((report) => {
      const rows = report.byCategory
        .map(
          (c) =>
            `<tr><td><span class="swatch" style="background:${CATEGORY_COLOR[c.category]}"></span>${esc(c.category)}</td><td>${c.segmentCount}</td><td>${c.claudeTokensEstimate.toLocaleString("en-US")}</td><td>${c.openaiTokens.toLocaleString("en-US")}</td></tr>`,
        )
        .join("");
      return `<section class="card"><h3>Request ${report.requestIndex + 1} · ${esc(modelLabel(report.model))}</h3>
        <p class="muted">≈${report.totals.claudeTokensEstimate.toLocaleString("en-US")} Claude tokens · ${report.totals.openaiTokens.toLocaleString("en-US")} OpenAI tokens${report.percentOfContextWindow !== undefined ? ` · ${(report.percentOfContextWindow * 100).toFixed(1)}% of context window` : ""}</p>
        <div class="table-scroll" tabindex="0" role="group" aria-label="Token categories for request ${report.requestIndex + 1}"><table><thead><tr><th>category</th><th>segments</th><th>≈Claude tok</th><th>OpenAI tok</th></tr></thead><tbody>${rows}</tbody></table></div>
      </section>`;
    })
    .join("\n");

  const cacheRows = cacheSimulation.actual
    .map(
      (step, i) =>
        `<tr><td>req ${i + 1}</td>${openai ? `<td>${esc(step.cacheMode ?? "legacy")}</td>` : ""}${mixedModels ? `<td>${esc(modelLabel(reports[i]!.model))}</td>` : ""}<td>${step.readTokens.toLocaleString("en-US")}</td>${openai ? `<td>${(step.writeTokens30m ?? 0).toLocaleString("en-US")}</td>` : `<td>${step.writeTokens5m.toLocaleString("en-US")}</td><td>${step.writeTokens1h.toLocaleString("en-US")}</td>`}<td>${step.uncachedTokens.toLocaleString("en-US")}</td><td>${step.costUsd !== undefined ? `$${step.costUsd.toFixed(4)}` : "n/a"}</td></tr>`,
    )
    .join("");

  const groups = groupFindings(findings);
  const findingRows = groups
    .map(
      (g) =>
        `<li class="finding ${esc(g.severity)}"><span class="pill">${esc(g.severity)}</span> <strong>${esc(g.title)}</strong> <span class="muted">(${describeRequestIndices(g.requestIndices)}${g.requestIndices.length > 1 ? `, ${g.requestIndices.length}×` : ""})</span><p>${esc(g.detail)}</p></li>`,
    )
    .join("");

  const duplicateRows = duplicates
    .map((g) => `<li>${g.members.length}× "${esc(g.members[0]!.label)}" — ≈${g.estimatedWastedTokens.toLocaleString("en-US")} wasted tokens (similarity ${(g.similarity * 100).toFixed(0)}%)</li>`)
    .join("");

  const savings =
    cacheSimulation.totalActualCostUsd !== undefined && cacheSimulation.totalOptimizedCostUsd !== undefined
      ? cacheSimulation.totalActualCostUsd - cacheSimulation.totalOptimizedCostUsd
      : undefined;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>contextscope report — ${esc(parse.format)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-monospace, "IBM Plex Mono", "SFMono-Regular", Menlo, monospace; background: #0d0f13; color: #dfe3ea; max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
  @media (prefers-color-scheme: light) { body { background: #f5f4f0; color: #1b1f27; } }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 0; }
  h3 { font-size: 15px; margin: 0 0 8px; }
  .muted { color: #929aaa; font-size: 13px; }
  a { color: #7fb6fa; }
  @media (prefers-color-scheme: light) { .muted { color: #5c6270; } a { color: #1b5dad; } }
  .card { border: 1px solid rgba(127,127,127,.3); border-radius: 6px; padding: 16px; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid rgba(127,127,127,.2); }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
  ul.findings { list-style: none; padding: 0; }
  li.finding { border-left: 3px solid #7c8494; padding: 8px 12px; margin: 8px 0; }
  li.finding.error { border-color: #e34948; }
  li.finding.warning { border-color: #eda100; }
  li.finding.info { border-color: #2a78d6; }
  .pill { text-transform: uppercase; font-size: 10px; letter-spacing: .05em; opacity: .7; }
  .savings { color: #1baf7a; font-weight: bold; }
  @media (prefers-color-scheme: light) { .savings { color: #08764f; } }
  .table-scroll { overflow-x: auto; margin: 12px 0; }
  .table-scroll:focus-visible, summary:focus-visible, a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
  .usage-evidence { border-top: 1px solid rgba(127,127,127,.3); padding: 12px 0; scroll-margin-top: 12px; }
  .usage-evidence code { overflow-wrap: anywhere; }
  .usage-evidence summary { cursor: pointer; }
  .card > h2 { margin-top: 0; }
</style></head>
<body><main>
  <h1>contextscope report</h1>
  <p class="muted">${esc(parse.format)} · ${parse.requests.length} request(s)${parse.autoDetected ? " · format auto-detected" : ""} · priced as ${esc(modelSummary(result))}${result.claudeTokenScale !== 1 ? ` · Claude estimates calibrated ×${result.claudeTokenScale.toFixed(3)}` : ""} · generated ${new Date().toISOString()}</p>
  ${!parse.complete || parse.warnings.length > 0 ? `<section class="card"><h2>${parse.complete ? "Parse notes" : "Incomplete input"}</h2>${!parse.complete ? `<p>${parse.skippedRecords} of ${parse.sourceRecords} source records skipped or not analyzable. Counts and simulations cover retained content only; review all warnings.</p>` : ""}<ul>${parse.warnings.map((warning) => `<li>${esc(warning.message)}</li>`).join("")}</ul></section>` : ""}

  ${modelNotes(result).map((note) => `<p class="muted">${esc(note)}</p>`).join("\n")}
  ${renderUsageHtml(result)}

  <section class="card">
    <h2>Findings (${groups.length} issue${groups.length === 1 ? "" : "s"}${findings.length > groups.length ? ` from ${findings.length} findings` : ""})</h2>
    <ul class="findings">${findingRows || '<li class="muted">No supported cache or duplicate-content issues detected in the retained requests. This does not verify live cache hits.</li>'}</ul>
  </section>

  <section class="card">
    <h2>Cache simulation (${esc(cacheSimulation.provider)})</h2>
    <div class="table-scroll" tabindex="0" role="group" aria-label="Cache simulation"><table><thead><tr><th>request</th>${openai ? "<th>mode</th>" : ""}${mixedModels ? "<th>model</th>" : ""}<th>read</th>${openai ? "<th>write 30m</th>" : "<th>write (5m)</th><th>write (1h)</th>"}<th>uncached</th><th>cost</th></tr></thead><tbody>${cacheRows}</tbody></table></div>
    <p class="muted">total simulated: ${cacheSimulation.totalActualCostUsd !== undefined ? `$${cacheSimulation.totalActualCostUsd.toFixed(4)}` : "n/a"} · optimized simulated: ${cacheSimulation.totalOptimizedCostUsd !== undefined ? `$${cacheSimulation.totalOptimizedCostUsd.toFixed(4)}` : "n/a"}</p>
    ${savings !== undefined && savings >= 0.00005 ? `<p class="savings">Normalizing volatile text, JSON keys and tool order${cacheSimulation.provider === "anthropic" ? ", with a breakpoint on each request's last cacheable block (moving the last marker if all four slots are used)," : ""} would save $${savings.toFixed(4)} on this sequence — ≈$${Math.round(savings * 1000).toLocaleString("en-US")} per 1,000 sessions shaped like this one.</p>` : ""}
  </section>

  ${duplicates.length > 0 ? `<section class="card"><h2>Duplicate content</h2><ul>${duplicateRows}</ul></section>` : ""}


  <h2>Requests</h2>
  ${requestSections}

  <p class="muted">Generated by <a href="https://github.com/antonsoo/contextscope">contextscope</a>. Claude token counts are heuristic estimates (≈), not exact.</p>
</main></body></html>`;
}
