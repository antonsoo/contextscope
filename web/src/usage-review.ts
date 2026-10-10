import type { AnalysisResult, ParsedRequest, UsageComparisonRow, UsageReadOutcome } from "@core/types.js";
import { USAGE_OUTCOME_LABEL, usageDelta, usageNumber, usageSourceLabel } from "@core/usage-labels.js";
import { $all, esc } from "./lib/dom.js";

type Filter = "all" | "simulated_hit_reported_zero" | "reported_hit_simulated_zero" | "unavailable";
export interface UsageView { filter: Filter; page: number }
const PAGE_SIZE = 25;

/** Renders a bounded review table; totals and downloads always retain the whole capture. */
export function mountUsageReview(root: HTMLElement, result: AnalysisResult, selected: number, view: UsageView, selectRequest: (index: number) => void): void {
  const review = result.usageComparison;
  const rows = review.rows.filter((row) => view.filter === "all" || row.readOutcome === view.filter);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  view.page = Math.max(0, Math.min(view.page, pages - 1));
  const start = view.page * PAGE_SIZE;
  const shown = rows.slice(start, start + PAGE_SIZE);
  const filters: [Filter, string, number][] = [
    ["all", "All requests", review.rows.length],
    ["simulated_hit_reported_zero", "Simulated hit / reported zero", review.readOutcomes.simulated_hit_reported_zero],
    ["reported_hit_simulated_zero", "Reported hit / simulated zero", review.readOutcomes.reported_hit_simulated_zero],
    ["unavailable", "Read unavailable", review.readOutcomes.unavailable],
  ];
  root.innerHTML = `
    <h2 id="usage-heading">Reported usage <span class="count">compared with the simulation</span></h2>
    <p class="usage-intro">What the response recorded, beside what this file predicts. Each total uses the same covered requests on both sides.</p>
    <div class="table-scroll usage-totals" tabindex="0" role="group" aria-label="Reported usage totals">
      <table class="usage-table"><thead><tr><th scope="col">Metric</th><th scope="col">Coverage</th><th scope="col">Reported</th><th scope="col">Estimated / simulated</th><th scope="col">Delta</th></tr></thead><tbody>
        ${([['Input tokens', review.input], ['Cache reads', review.cacheRead]] as const).map(([label, metric]) => `<tr><th scope="row">${label}<span class="usage-mobile">${metric.requestIndices.length}/${review.rows.length} requests</span></th><td>${metric.requestIndices.length}/${review.rows.length}</td><td class="usage-reported">${usageNumber(metric.reportedTokens)}</td><td>${usageNumber(metric.simulatedTokens)}</td><td>${usageDelta(metric.deltaTokens)}</td></tr>`).join("")}
      </tbody></table>
    </div>
    <p class="muted usage-note">Delta = estimate/simulation minus reported. n/a means unavailable. ${review.invalidRequestIndices.length} invalid usage record(s) excluded. Costs below remain simulated.</p>
    ${review.uncomparedRequestIndices.length ? `<p class="usage-issue">${review.uncomparedRequestIndices.length} request(s) have paired usage but no analyzable prompt; excluded from comparisons. Select their request tabs to inspect the original counters.</p>` : ""}
    ${review.issues.map((issue) => `<p class="usage-issue">${esc(issue)}</p>`).join("")}
    <div class="usage-filters" role="group" aria-label="Filter usage comparisons">
      ${filters.map(([filter, label, count]) => `<button class="btn" type="button" data-usage-filter="${filter}" aria-pressed="${view.filter === filter}">${label} <span>${count}</span></button>`).join("")}
    </div>
    <p id="usage-range" class="muted" role="status">${rows.length ? `${start + 1}-${start + shown.length} of ${rows.length} matching requests` : "No requests match this filter"}. Totals and exports include the whole capture.</p>
    <p class="usage-mobile muted">The table shows cache reads. Select a request for input counts and original counters.</p>
    <div class="table-scroll usage-rows" tabindex="0" role="group" aria-label="Per-request usage comparison">
      <table class="usage-table"><thead><tr><th scope="col">Request / source</th><th scope="col">Reported input</th><th scope="col">Estimated input</th><th scope="col">Reported read</th><th scope="col">Simulated read</th><th scope="col">Read comparison</th></tr></thead><tbody>
        ${shown.map((row) => `<tr class="${row.requestIndex === selected ? "usage-selected" : ""}"><th scope="row"><button type="button" class="usage-inspect" data-usage-request="${row.requestIndex}" aria-label="Inspect usage for request ${row.requestIndex + 1}" aria-pressed="${row.requestIndex === selected}">req ${row.requestIndex + 1}</button><span class="usage-source">${usageSourceLabel(result.parse.requests[row.requestIndex]!)}</span></th><td class="usage-reported">${usageNumber(row.reportedInputTokens)}</td><td>${usageNumber(row.estimatedInputTokens)}</td><td class="usage-reported">${usageNumber(row.reportedReadTokens)}</td><td>${usageNumber(row.simulatedReadTokens)}</td><td class="usage-outcome ${disagrees(row.readOutcome) ? "usage-disagrees" : ""}">${USAGE_OUTCOME_LABEL[row.readOutcome]}</td></tr>`).join("")}
      </tbody></table>
    </div>
    ${pages > 1 ? `<div class="usage-pagination"><button class="btn" id="usage-previous" type="button" ${view.page === 0 ? "disabled" : ""}>Previous requests</button><span>Page ${view.page + 1} of ${pages}</span><button class="btn" id="usage-next" type="button" ${view.page === pages - 1 ? "disabled" : ""}>Next requests</button></div>` : ""}
    <p class="muted usage-note">A discrepancy does not identify its cause: routing, eviction, timing and hidden context are not captured. Reuse on both sides does not mean the token counts agree.</p>
    ${evidence(result.parse.requests[selected]!, review.rows.find((row) => row.requestIndex === selected))}
  `;
  const redraw = (focus: string): void => {
    mountUsageReview(root, result, selected, view, selectRequest);
    root.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  };
  for (const button of $all<HTMLButtonElement>("[data-usage-filter]", root)) button.addEventListener("click", () => {
    view.filter = button.dataset["usageFilter"] as Filter;
    view.page = 0;
    redraw(`[data-usage-filter="${view.filter}"]`);
  });
  for (const button of $all<HTMLButtonElement>("[data-usage-request]", root)) button.addEventListener("click", () => {
    const index = Number(button.dataset["usageRequest"]);
    selectRequest(index);
    document.querySelector<HTMLElement>(`[data-usage-request="${index}"]`)?.focus({ preventScroll: true });
  });
  root.querySelector("#usage-previous")?.addEventListener("click", () => { view.page--; redraw(view.page === 0 ? "#usage-next" : "#usage-previous"); });
  root.querySelector("#usage-next")?.addEventListener("click", () => { view.page++; redraw(view.page === pages - 1 ? "#usage-previous" : "#usage-next"); });
}

function evidence(request: ParsedRequest, row: UsageComparisonRow | undefined): string {
  const usage = request.reportedUsage;
  return `<section class="usage-evidence" aria-labelledby="usage-evidence-heading"><h3 id="usage-evidence-heading">Request ${request.index + 1} <span class="muted">${usageSourceLabel(request)} / original counters</span></h3>
    ${!request.segments.length ? '<p class="usage-issue">No analyzable prompt; excluded from comparisons.</p>' : ""}
    ${usage ? `<p class="muted">${usage.schema} · ${usage.status} · ${esc(usage.sources.join(", "))}</p>
    ${usage.issues.map((issue) => `<p class="usage-issue">${esc(issue)}</p>`).join("")}
    ${usage.notes.map((note) => `<p class="muted">${esc(note)}</p>`).join("")}
    <div class="usage-summary"><p>Input <strong>${usageNumber(usage.inputTokens)}</strong> reported / <strong>${usageNumber(row?.estimatedInputTokens ?? null)}</strong> estimated</p><p>Cache read <strong>${usageNumber(usage.cacheReadTokens)}</strong> reported / <strong>${usageNumber(row?.simulatedReadTokens ?? null)}</strong> simulated (delta ${usageDelta(row?.readDeltaTokens ?? null)})</p><p>Cache write <strong>${usageNumber(usage.cacheWriteTokens)}</strong> · output <strong>${usageNumber(usage.outputTokens)}</strong></p></div>
    <div class="table-scroll" tabindex="0" role="group" aria-label="Original usage counters"><table class="usage-table usage-counters"><thead><tr><th scope="col">Original counter path</th><th scope="col">Value / state</th></tr></thead><tbody>${usage.counters.map((counter) => `<tr><th scope="row"><code>${esc(counter.path)}</code></th><td>${counter.status === "reported" ? usageNumber(counter.value!) : counter.status}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">No paired response usage for this request. Keep the response beside its request to compare recorded counts.</p>'}
  </section>`;
}

function disagrees(outcome: UsageReadOutcome): boolean {
  return outcome === "simulated_hit_reported_zero" || outcome === "reported_hit_simulated_zero";
}
