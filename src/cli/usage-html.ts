import type { AnalysisResult } from "../core/types.js";
import { USAGE_OUTCOME_LABEL, usageDelta, usageNumber, usageSourceLabel } from "../core/usage-labels.js";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderUsageHtml(result: AnalysisResult): string {
  const review = result.usageComparison;
  if (!review.capturedRequests) return '<p class="muted">No paired response usage. Cache reads and costs are simulations.</p>';
  const metrics = ([['Input tokens', review.input], ['Cache reads', review.cacheRead]] as const).map(([label, metric]) => `<tr><th scope="row">${label}</th><td>${metric.requestIndices.length}/${review.rows.length}</td><td>${usageNumber(metric.reportedTokens)}</td><td>${usageNumber(metric.simulatedTokens)}</td><td>${usageDelta(metric.deltaTokens)}</td></tr>`).join("");
  const rows = review.rows.map((row) => `<tr><th scope="row"><a href="#usage-${row.requestIndex}">req ${row.requestIndex + 1}</a><br>${usageSourceLabel(result.parse.requests[row.requestIndex]!)}</th><td>${usageNumber(row.reportedInputTokens)}</td><td>${usageNumber(row.estimatedInputTokens)}</td><td>${usageNumber(row.reportedReadTokens)}</td><td>${usageNumber(row.simulatedReadTokens)}</td><td>${USAGE_OUTCOME_LABEL[row.readOutcome]}</td></tr>`).join("");
  const details = review.rows.map((row) => {
    const request = result.parse.requests[row.requestIndex]!;
    const usage = request.reportedUsage;
    return `<details id="usage-${row.requestIndex}" class="usage-evidence"><summary>Request ${row.requestIndex + 1} · ${usageSourceLabel(request)} · ${usage?.status ?? "not recorded"}</summary>
      ${usage ? `<p>${usage.schema}; source: ${esc(usage.sources.join(", "))}. Reported input: ${usageNumber(usage.inputTokens)}; cache reads: ${usageNumber(usage.cacheReadTokens)}; cache writes: ${usageNumber(usage.cacheWriteTokens)}; output: ${usageNumber(usage.outputTokens)}.</p>
      ${usage.issues.length ? `<ul>${usage.issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul>` : ""}
      ${usage.notes.map((note) => `<p>${esc(note)}</p>`).join("")}
      <div class="table-scroll" tabindex="0" role="group" aria-label="Source counters for request ${row.requestIndex + 1}"><table><thead><tr><th scope="col">Original counter path</th><th scope="col">Value / state</th></tr></thead><tbody>${usage.counters.map((counter) => `<tr><th scope="row"><code>${counter.path}</code></th><td>${counter.status === "reported" ? usageNumber(counter.value!) : counter.status}</td></tr>`).join("")}</tbody></table></div>` : "<p>No paired response usage for this request.</p>"}
    </details>`;
  }).join("");
  return `<section class="card"><h2>Reported usage vs simulation</h2>
    <p>Each total compares the same covered requests. Delta = estimate/simulation minus reported. Missing or invalid counts are n/a, never zero.</p>
    <div class="table-scroll" tabindex="0" role="group" aria-label="Usage totals"><table><thead><tr><th scope="col">Metric</th><th scope="col">Coverage</th><th scope="col">Reported</th><th scope="col">Estimated / simulated</th><th scope="col">Delta</th></tr></thead><tbody>${metrics}</tbody></table></div>
    <p>${review.readOutcomes.simulated_hit_reported_zero} simulated hit / reported zero; ${review.readOutcomes.reported_hit_simulated_zero} reported hit / simulated zero. ${review.readOutcomes.unavailable} read count unavailable. ${review.invalidRequestIndices.length} invalid usage record(s) excluded.</p>
    <p class="muted">Counts do not establish a cause: cache routing, eviction, timing and hidden context are not captured. Reuse on both sides does not mean the token counts agree. Reported writes are retained below; costs remain simulated.</p>
    ${review.issues.map((issue) => `<p>${esc(issue)}</p>`).join("")}
    <div class="table-scroll" tabindex="0" role="group" aria-label="Per-request usage comparison"><table><thead><tr><th scope="col">Request / source</th><th scope="col">Reported input</th><th scope="col">Estimated input</th><th scope="col">Reported read</th><th scope="col">Simulated read</th><th scope="col">Read comparison</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>Original counters</h3>${details}
  </section>`;
}
