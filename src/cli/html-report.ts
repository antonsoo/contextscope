import type { AnalysisResult } from "../core/index.js";

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
export function renderHtmlReport(result: AnalysisResult): string {
  const { parse, reports, cacheSimulation, findings, duplicates } = result;

  const requestSections = reports
    .map((report) => {
      const rows = report.byCategory
        .map(
          (c) =>
            `<tr><td><span class="swatch" style="background:${CATEGORY_COLOR[c.category]}"></span>${esc(c.category)}</td><td>${c.segmentCount}</td><td>${c.claudeTokensEstimate.toLocaleString()}</td><td>${c.openaiTokens.toLocaleString()}</td></tr>`,
        )
        .join("");
      return `<section class="card"><h3>Request ${report.requestIndex + 1}</h3>
        <p class="muted">≈${report.totals.claudeTokensEstimate.toLocaleString()} Claude tokens · ${report.totals.openaiTokens.toLocaleString()} OpenAI tokens${report.percentOfContextWindow !== undefined ? ` · ${(report.percentOfContextWindow * 100).toFixed(1)}% of context window` : ""}</p>
        <table><thead><tr><th>category</th><th>segments</th><th>≈Claude tok</th><th>OpenAI tok</th></tr></thead><tbody>${rows}</tbody></table>
      </section>`;
    })
    .join("\n");

  const cacheRows = cacheSimulation.actual
    .map(
      (step, i) =>
        `<tr><td>req ${i + 1}</td><td>${step.readTokens.toLocaleString()}</td><td>${step.writeTokens5m.toLocaleString()}</td><td>${step.writeTokens1h.toLocaleString()}</td><td>${step.uncachedTokens.toLocaleString()}</td><td>${step.costUsd !== undefined ? `$${step.costUsd.toFixed(4)}` : "n/a"}</td></tr>`,
    )
    .join("");

  const findingRows = findings
    .map(
      (f) =>
        `<li class="finding ${esc(f.severity)}"><span class="pill">${esc(f.severity)}</span> <strong>${esc(f.title)}</strong> <span class="muted">(request ${f.requestIndex + 1})</span><p>${esc(f.detail)}</p></li>`,
    )
    .join("");

  const duplicateRows = duplicates
    .map((g) => `<li>${g.members.length}× "${esc(g.members[0]!.label)}" — ≈${g.estimatedWastedTokens.toLocaleString()} wasted tokens (similarity ${(g.similarity * 100).toFixed(0)}%)</li>`)
    .join("");

  const savings =
    cacheSimulation.totalActualCostUsd !== undefined && cacheSimulation.totalOptimizedCostUsd !== undefined
      ? cacheSimulation.totalActualCostUsd - cacheSimulation.totalOptimizedCostUsd
      : undefined;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>contextscope report — ${esc(parse.format)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-monospace, "IBM Plex Mono", "SFMono-Regular", Menlo, monospace; background: #0d0f13; color: #dfe3ea; max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
  @media (prefers-color-scheme: light) { body { background: #f5f4f0; color: #1b1f27; } }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h3 { font-size: 15px; margin: 0 0 8px; }
  .muted { color: #7c8494; font-size: 13px; }
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
</style></head>
<body>
  <h1>contextscope report</h1>
  <p class="muted">${esc(parse.format)} · ${parse.requests.length} request(s)${parse.autoDetected ? " · format auto-detected" : ""} · generated ${new Date().toISOString()}</p>

  ${requestSections}

  <section class="card">
    <h3>Cache simulation (${esc(cacheSimulation.provider)})</h3>
    <table><thead><tr><th>request</th><th>read</th><th>write (5m)</th><th>write (1h)</th><th>uncached</th><th>cost</th></tr></thead><tbody>${cacheRows}</tbody></table>
    <p class="muted">total actual: ${cacheSimulation.totalActualCostUsd !== undefined ? `$${cacheSimulation.totalActualCostUsd.toFixed(4)}` : "n/a"} · total optimized: ${cacheSimulation.totalOptimizedCostUsd !== undefined ? `$${cacheSimulation.totalOptimizedCostUsd.toFixed(4)}` : "n/a"}</p>
    ${savings !== undefined && savings > 1e-9 ? `<p class="savings">Applying the fixes below, plus an automatic breakpoint on every request's tail, would save $${savings.toFixed(4)} on this sequence — ≈$${Math.round(savings * 1000).toLocaleString("en-US")} per 1,000 sessions shaped like this one.</p>` : ""}
  </section>

  <section class="card">
    <h3>Findings (${findings.length})</h3>
    <ul class="findings">${findingRows || '<li class="muted">None — this sequence caches cleanly.</li>'}</ul>
  </section>

  ${duplicates.length > 0 ? `<section class="card"><h3>Duplicate content</h3><ul>${duplicateRows}</ul></section>` : ""}

  <p class="muted">Generated by <a href="https://github.com/antonsoo/contextscope">contextscope</a>. Claude token counts are heuristic estimates (≈), not exact.</p>
</body></html>`;
}
