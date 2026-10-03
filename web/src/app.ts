import type { AnalysisResult, Provider, RequestTokenReport, Segment } from "@core/types.js";
import type { CalibrationResult, FindingGroup } from "@core/index.js";
import { squarify } from "./lib/treemap.js";
import { BUILT_IN_EXAMPLES } from "./lib/examples.js";
import { CATEGORY_LABEL, CATEGORY_ORDER, categoryVar, fmtInt, fmtPct, fmtUsd, fmtUsdRounded, truncate } from "./lib/format.js";
import { $, $all, esc } from "./lib/dom.js";
import { checkTextSize, readPossiblyGzippedFile } from "./lib/gunzip.js";

// The core library (and the ~1MB o200k_base tokenizer data it pulls in) is loaded on demand, not
// on page load - the drop-zone screen should be instant. Everything that touches it is async.
type CoreModule = typeof import("@core/index.js");
let corePromise: Promise<CoreModule> | undefined;
let loadedCore: CoreModule | undefined;
function loadCore(): Promise<CoreModule> {
  corePromise ??= import("@core/index.js").catch((err: unknown) => {
    corePromise = undefined;
    throw err;
  });
  return corePromise;
}

interface State {
  /** Overrides chosen in the top bar for the current input; reset whenever a new input arrives. */
  format: Provider | "auto";
  model: string | undefined;
  analysis: AnalysisResult | undefined;
  selectedRequest: number;
  selectedPair: number;
  calibration: CalibrationResult | undefined;
}

const state: State = {
  format: "auto",
  model: undefined,
  analysis: undefined,
  selectedRequest: 0,
  selectedPair: 0,
  calibration: undefined,
};

export function initApp(root: HTMLElement): void {
  root.innerHTML = shellHtml();
  wireTopbar();
  wireIntake();
  applyStoredTheme();
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

function shellHtml(): string {
  return `
    <header class="topbar">
      <h1 class="wordmark"><span class="addr" aria-hidden="true">0x00&nbsp;</span>contextscope<span class="dot" aria-hidden="true">.</span></h1>
      <span class="tagline">what's actually in your context window, and why your cache keeps missing</span>
      <div class="topbar-controls" id="topbar-controls" hidden>
        <label class="field">format
          <select id="format-select">
            <option value="auto">auto-detect</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label class="field">model
          <select id="model-select"></select>
        </label>
        <button class="btn" id="new-analysis-btn" type="button">new analysis</button>
      </div>
      <button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle light/dark theme" title="Toggle theme">◐</button>
    </header>

    <div class="load-status" id="load-status" hidden>
      <span role="status">Reading and analyzing locally…</span>
      <button class="btn" id="cancel-load-btn" type="button">cancel import</button>
    </div>
    <p class="intake-error" id="intake-error" role="alert" hidden></p>

    <main id="intake" class="intake">
      <div class="dropzone" id="dropzone">
        <h2>drop a request, or paste one</h2>
        <p class="lead">A single Anthropic Messages or OpenAI (Chat Completions or Responses) request, a JSON array, or JSONL - one API request per line, the shape an agent loop actually sends. Batch-API files and gateway logs are unwrapped, and a gzipped <code>.jsonl.gz</code> works too, decompressed right here.</p>
        <div class="intake-actions">
          <button class="btn primary" id="pick-file-btn" type="button">choose file…</button>
          <button class="btn" id="paste-btn" type="button">paste JSON…</button>
          <input type="file" id="file-input" accept=".json,.jsonl,.gz,application/json,application/gzip" class="visually-hidden" aria-label="Request file" tabindex="-1" />
        </div>
        <textarea aria-label="Request JSON or JSONL" id="paste-area" placeholder="paste a request, a JSON array of requests, or JSONL here" spellcheck="false"></textarea>
        <div class="intake-actions" id="paste-run-row" hidden>
          <button class="btn primary" id="run-paste-btn" type="button">analyze</button>
        </div>
        <p class="hint">Nothing leaves your browser. Parsing and token counting run locally. Up to 50 MB before and after decompression.</p>
        <div class="examples-row">
          <p>or load a built-in example (synthetic data, labelled below)</p>
          <div class="example-chip-row" id="example-chips"></div>
        </div>
      </div>
    </main>

    <div id="dashboard" class="dashboard">
      <nav aria-label="Request navigation"><div class="request-tabs" id="request-tabs" role="tablist" aria-label="Requests"></div></nav>
      <main><div class="content" id="content" role="tabpanel" tabindex="0"></div></main>
      <footer class="app-footer">
        contextscope is local-first: analysis runs in your browser, nothing is uploaded. Claude token counts are estimates (≈) - see
        <a href="https://github.com/antonsoo/contextscope#accuracy-and-limitations" target="_blank" rel="noopener">accuracy and limitations</a>.
      </footer>
    </div>

    <dialog class="drawer" id="drawer" aria-labelledby="drawer-title">
      <div class="drawer-head">
        <h3 id="drawer-title">segment</h3>
        <button class="icon-btn" id="drawer-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="drawer-body" id="drawer-body" tabindex="0" role="region" aria-label="Segment details"></div>
    </dialog>
  `;
}

// ---------------------------------------------------------------------------
// intake
// ---------------------------------------------------------------------------

function wireIntake(): void {
  const dropzone = $("#dropzone");
  const fileInput = $("#file-input") as HTMLInputElement;
  const pasteArea = $("#paste-area") as HTMLTextAreaElement;
  const pasteRunRow = $("#paste-run-row");

  $("#pick-file-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // choosing the same file again should still fire "change"
    if (file) loadFile(file);
  });

  $("#paste-btn").addEventListener("click", () => {
    pasteArea.classList.add("shown");
    pasteRunRow.hidden = false;
    pasteArea.focus();
  });
  $("#run-paste-btn").addEventListener("click", () => {
    if (pasteArea.value.trim().length > 0) startNewInput(pasteArea.value);
    else showIntakeError("Paste a request (or JSONL of requests) first.");
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  const chipRow = $("#example-chips");
  chipRow.innerHTML = BUILT_IN_EXAMPLES.map(
    (ex) =>
      `<button class="example-chip" type="button" data-example="${ex.id}" title="${esc(ex.description)}">${esc(ex.label)}${ex.approxSizeMb >= 0.2 ? ` <span class="chip-size">(${ex.approxSizeMb.toFixed(2)} MB gz)</span>` : ""}</button>`,
  ).join("");
  chipRow.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-example]");
    if (!target || target.disabled) return;
    const example = BUILT_IN_EXAMPLES.find((ex) => ex.id === target.dataset["example"]);
    if (!example) return;
    runInput((signal) => example.load(signal), true);
  });
}

function loadFile(file: File): void {
  runInput((signal) => readPossiblyGzippedFile(file, { signal }), true);
}

function startNewInput(text: string): void {
  runInput(async () => text, true);
}

function showIntakeError(message: string | undefined): void {
  const el = $("#intake-error");
  el.textContent = message ?? "";
  el.hidden = message === undefined;
}

function wireTopbar(): void {
  $("#new-analysis-btn").addEventListener("click", resetAnalysis);
  $("#cancel-load-btn").addEventListener("click", () => {
    cancelPending();
    showIntakeError("Import cancelled.");
    $(state.analysis ? "#new-analysis-btn" : "#pick-file-btn").focus();
  });

  const formatSelect = $("#format-select") as HTMLSelectElement;
  formatSelect.addEventListener("change", () => {
    if (lastRawInput !== undefined) runAnalysis(lastRawInput, { format: formatSelect.value as Provider | "auto", model: undefined, calibration: undefined });
  });

  const modelSelect = $("#model-select") as HTMLSelectElement;
  modelSelect.addEventListener("change", () => {
    if (lastRawInput !== undefined) runAnalysis(lastRawInput, { ...state, model: modelSelect.value, calibration: undefined });
  });

  $("#theme-toggle").addEventListener("click", () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const next = isLight ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("contextscope-theme", next);
    } catch {
      /* private browsing / blocked storage - theme just won't persist */
    }
  });

  $("#drawer-close").addEventListener("click", closeDrawer);
  const drawer = $("#drawer") as HTMLDialogElement;
  drawer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer();
  });
  // Native dialogs make the background inert; explicitly wrap the last/first stops too,
  // so Chromium does not hand Tab off to the browser chrome at the end of this drawer.
  drawer.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const stops = $all('button, [tabindex="0"]', drawer);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  drawer.addEventListener("click", (event) => {
    const bounds = drawer.getBoundingClientRect();
    if (event.target === drawer && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) closeDrawer();
  });
}

function applyStoredTheme(): void {
  try {
    const stored = localStorage.getItem("contextscope-theme");
    if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
  } catch {
    /* ignore */
  }
}

let lastRawInput: string | undefined;

type AnalysisSettings = Pick<State, "format" | "model" | "calibration">;
let pendingLoad: AbortController | undefined;
let treemapObserver: ResizeObserver | undefined;

function cancelPending(): void {
  pendingLoad?.abort();
  pendingLoad = undefined;
  setLoading(false);
  syncControls();
}

function resetAnalysis(): void {
  cancelPending();
  closeDrawer();
  treemapObserver?.disconnect();
  treemapObserver = undefined;
  state.analysis = undefined;
  state.calibration = undefined;
  state.format = "auto";
  state.model = undefined;
  state.selectedRequest = 0;
  state.selectedPair = -1;
  lastRawInput = undefined;
  groupsCache = undefined;
  loadedCore?.clearTokenCache();
  $("#content").replaceChildren();
  $("#request-tabs").replaceChildren();
  const paste = $("#paste-area") as HTMLTextAreaElement;
  paste.value = "";
  paste.classList.remove("shown");
  $("#paste-run-row").hidden = true;
  showIntakeError(undefined);
  $("#dashboard").classList.remove("shown");
  $("#topbar-controls").hidden = true;
  $("#intake").style.display = "grid";
  $("#pick-file-btn").focus();
}

function runAnalysis(input: string, settings: AnalysisSettings): void {
  runInput(async () => input, false, { format: settings.format, model: settings.model, calibration: settings.calibration });
}

/** Prepare in isolation. Only the current successful operation may replace the workspace. */
function runInput(read: (signal: AbortSignal) => Promise<string>, fresh: boolean, settings: AnalysisSettings = { format: "auto", model: undefined, calibration: undefined }): void {
  cancelPending();
  const operation = new AbortController();
  pendingLoad = operation;
  const focusedId = (document.activeElement as HTMLElement | null)?.id;
  const { signal } = operation;
  showIntakeError(undefined);
  setLoading(true);
  void (async () => {
    try {
      const input = await read(signal);
      signal.throwIfAborted();
      checkTextSize(input);
      const core = await loadCore();
      loadedCore = core;
      signal.throwIfAborted();
      // Let the status paint before the synchronous tokenizer and analysis run.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      signal.throwIfAborted();
      const result = core.analyze(input, {
        format: settings.format === "auto" ? undefined : settings.format,
        model: settings.model,
        claudeTokenScale: settings.calibration?.scale,
      });
      closeDrawer();
      state.format = settings.format;
      state.model = settings.model;
      state.calibration = settings.calibration;
      state.analysis = result;
      lastRawInput = input;
      if (fresh || state.selectedRequest >= result.reports.length) {
        state.selectedRequest = result.conversations.count > 1 ? largestRequest(result) : result.reports.length - 1;
      }
      state.selectedPair = result.prefixMatches.findIndex((match) => match.toIndex === state.selectedRequest);
      showDashboard(core);
      if (fresh) $(".request-tab.active").focus();
    } catch (err) {
      if (!signal.aborted) {
        showIntakeError(`Could not analyze this input: ${(err as Error).message}`);
        syncControls();
      }
    } finally {
      if (pendingLoad === operation) {
        loadedCore?.clearTokenCache();
        pendingLoad = undefined;
        setLoading(false);
        if (!fresh && focusedId) {
          const target = document.getElementById(focusedId) ?? (focusedId === "calibrate-reset" ? document.getElementById("calibrate-count") : null);
          target?.focus({ preventScroll: true });
        }
      }
    }
  })();
}

function syncControls(): void {
  ($("#format-select") as HTMLSelectElement).value = state.format;
  if (state.analysis) ($("#model-select") as HTMLSelectElement).value = state.analysis.model.id;
}

function setLoading(loading: boolean): void {
  $("#load-status").hidden = !loading;
  for (const control of $all("#format-select, #model-select, #calibrate-count, #calibrate-btn, #calibrate-reset")) {
    (control as HTMLButtonElement).disabled = loading;
  }
  $("#dropzone").setAttribute("aria-busy", String(loading));
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

function showDashboard(core: CoreModule): void {
  const result = state.analysis;
  if (!result) return;
  loadedCore = core;

  ($("#intake") as HTMLElement).style.display = "none";
  $("#dashboard").classList.add("shown");
  $("#topbar-controls").hidden = false;

  const formatSelect = $("#format-select") as HTMLSelectElement;
  formatSelect.value = state.format;

  const modelSelect = $("#model-select") as HTMLSelectElement;
  const models = result.parse.format === "anthropic" ? core.ANTHROPIC_MODELS : core.OPENAI_MODELS;
  modelSelect.innerHTML = models.map((m) => `<option value="${m.id}">${esc(m.displayName)}</option>`).join("");
  modelSelect.value = result.model.id;

  renderRequestTabs();
  renderContent();
}

let requestTabsWired = false;

function renderRequestTabs(): void {
  const result = state.analysis!;
  const tabs = $("#request-tabs");
  tabs.innerHTML = result.reports
    .map(
      (r, i) =>
        `<button class="request-tab ${i === state.selectedRequest ? "active" : ""}" data-req="${i}" id="request-tab-${i}" role="tab" aria-selected="${i === state.selectedRequest}" aria-controls="content" tabindex="${i === state.selectedRequest ? 0 : -1}" type="button">req ${i + 1}<span class="pct">${fmtPct(r.percentOfContextWindow, 2)}</span></button>`,
    )
    .join("");

  $("#content").setAttribute("aria-labelledby", `request-tab-${state.selectedRequest}`);

  // Bring the active tab into view - important now that the default is the LAST request, which
  // is usually scrolled off the right edge of this horizontally-scrolling strip.
  tabs.querySelector(".request-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });

  // Wired once against the container (a fixture of the static shell), not per render - `tabs`
  // itself is never replaced, only its innerHTML, so re-adding a listener here on every render
  // would stack N duplicate handlers after N tab switches.
  if (!requestTabsWired) {
    requestTabsWired = true;
    // Keep the active tab visible as this strip narrows, without scrolling the page vertically.
    new ResizeObserver(() => {
      const active = tabs.querySelector<HTMLElement>(".request-tab.active");
      if (!active) return;
      const strip = tabs.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      if (tab.left < strip.left) tabs.scrollLeft += tab.left - strip.left;
      else if (tab.right > strip.right) tabs.scrollLeft += tab.right - strip.right;
    }).observe(tabs);
    tabs.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-req]");
      if (!btn) return;
      selectRequest(Number(btn.dataset["req"]));
    });
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-req]");
      if (!button) return;
      event.preventDefault();
      const count = state.analysis!.reports.length;
      const current = Number(button.dataset["req"]);
      const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + count) % count;
      selectRequest(next);
    });
  }
}

function selectRequest(index: number): void {
  state.selectedRequest = index;
  state.selectedPair = state.analysis!.prefixMatches.findIndex((match) => match.toIndex === index);
  renderRequestTabs();
  renderContent();
  $(".request-tab.active").focus({ preventScroll: true });
}

function renderContent(): void {
  treemapObserver?.disconnect();
  treemapObserver = undefined;
  const result = state.analysis!;
  const content = $("#content");
  const report = result.reports[state.selectedRequest]!;

  // The answer (findings) comes right after the headline numbers; the evidence follows.
  content.innerHTML = `
    ${statTilesPanel(report, result)}
    ${parseNotesPanel(result)}
    ${findingsPanel(result)}
    ${treemapPanel(report, result.parse.format)}
    ${segmentsTablePanel(report)}
    ${result.parse.requests.length > 1 ? sequencePanel(result) : ""}
    ${cachePanel(result)}
    ${result.duplicates.length > 0 ? duplicatesPanel(result) : ""}
    ${calibratePanel(result)}
  `;

  wireTreemap(report, result.parse.format);
  wireSegmentsTable(report);
  if (result.parse.requests.length > 1) wireSequencePanel(result);
  wireFindings(result);
  wireCalibrate(result);
}

/** Unwrapped envelopes and parse warnings (skipped lines, non-request records, stored-response
 * continuations) - things the user should know before trusting the numbers below. */
function parseNotesPanel(result: AnalysisResult): string {
  const notes: string[] = [];
  if (result.parse.envelope) notes.push(`Request bodies were read from each record's <code>${esc(result.parse.envelope)}</code> field.`);
  if (result.model.unrecognized) notes.push(`The requests name <code>${esc(result.model.unrecognized)}</code>, which isn't in the pricing table, so costs use ${esc(result.model.displayName)}. Pick the right model above.`);
  const warnings = result.parse.warnings;
  for (const w of warnings.slice(0, 5)) notes.push(esc(w.message));
  if (warnings.length > 5) notes.push(`…and ${warnings.length - 5} more parse warnings.`);
  if (notes.length === 0) return "";
  return `<section class="panel notes-panel" role="note">${notes.map((n) => `<p>${n}</p>`).join("")}</section>`;
}

// ---------------------------------------------------------------------------
// stat tiles
// ---------------------------------------------------------------------------

function statTilesPanel(report: RequestTokenReport, result: AnalysisResult): string {
  const groups = currentGroups(result);
  const errorCount = groups.filter((g) => g.severity === "error").length;
  const warnCount = groups.filter((g) => g.severity === "warning").length;
  const savings =
    result.cacheSimulation.totalActualCostUsd !== undefined && result.cacheSimulation.totalOptimizedCostUsd !== undefined
      ? result.cacheSimulation.totalActualCostUsd - result.cacheSimulation.totalOptimizedCostUsd
      : undefined;
  return `
    <section class="panel">
      <h2>Request ${state.selectedRequest + 1} of ${result.reports.length}${
        result.conversations.count > 1 ? ` <span class="count">conversation ${result.conversations.byRequest[state.selectedRequest]! + 1} of ${fmtInt(result.conversations.count)}</span>` : ""
      }</h2>
      <div class="stat-row">
        <div class="stat-tile"><div class="label">≈ Claude tokens${result.claudeTokenScale !== 1 ? " (calibrated)" : ""}</div><div class="value">${fmtInt(report.totals.claudeTokensEstimate)}</div></div>
        <div class="stat-tile"><div class="label">OpenAI tokens (exact)</div><div class="value">${fmtInt(report.totals.openaiTokens)}</div></div>
        <div class="stat-tile"><div class="label">of context window</div><div class="value">${fmtPct(report.percentOfContextWindow, 2)}</div></div>
        <div class="stat-tile"><div class="label">issues</div><div class="value">${errorCount > 0 ? errorCount + " err" : warnCount > 0 ? warnCount + " warn" : groups.length}</div></div>
        ${savings !== undefined && savings >= 0.00005 ? `<div class="stat-tile"><div class="label">potential savings</div><div class="value good">${fmtUsd(savings)}</div></div>` : ""}
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// treemap
// ---------------------------------------------------------------------------

// Blocks are sized in the analyzed provider's own tokens: exact o200k_base counts for OpenAI, the ≈ estimate for Claude.
function blockTokens(segment: Segment, format: Provider): number {
  return format === "openai" ? segment.openaiTokens : segment.claudeTokensEstimate;
}

function treemapPanel(report: RequestTokenReport, format: Provider): string {
  return `
    <section class="panel">
      <h2>Token usage — treemap <span class="count">colored by category, sized by ${format === "openai" ? "OpenAI tokens (exact)" : "≈ Claude tokens"}</span></h2>
      <div class="treemap" id="treemap" role="group" aria-label="Treemap of token usage by segment: each block opens its segment"></div>
      <div class="legend">
        ${CATEGORY_ORDER.filter((c) => report.byCategory.some((b) => b.category === c))
          .map((c) => `<span class="legend-item"><span class="legend-swatch" style="background:${categoryVar(c)}"></span>${CATEGORY_LABEL[c]}</span>`)
          .join("")}
      </div>
    </section>
  `;
}

function wireTreemap(report: RequestTokenReport, format: Provider): void {
  const container = $("#treemap");
  const approx = format === "openai" ? "" : "≈";
  const items = report.segments
    .filter((s) => blockTokens(s, format) > 0)
    .map((s) => ({ value: blockTokens(s, format), item: s }));
  container.innerHTML = items.map(({ item: segment }) => `<button type="button" class="tm-block" data-segment="${esc(segment.id)}"></button>`).join("");
  const blocks = new Map($all("[data-segment]", container).map((block) => [block.dataset["segment"], block]));
  const layout = (): void => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    for (const { rect: r, item: segment } of squarify(items, { x: 0, y: 0, w, h })) {
      const block = blocks.get(segment.id)!;
      const lines = r.w <= 46 ? 0 : r.h >= 34 ? 2 : r.h >= 20 ? 1 : 0;
      const tokens = `${approx}${fmtInt(blockTokens(segment, format))} tok`;
      block.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${categoryVar(segment.category)};color:var(--cat-${segment.category}-ink)`;
      block.title = `${segment.label} — ${tokens}`;
      block.setAttribute("aria-label", `${segment.label}, ${tokens}`);
      block.innerHTML = lines === 0 ? "" : `<span class="tm-label"><span class="tm-name">${esc(truncate(segment.label, 40))}</span>${lines === 2 ? `<span class="tm-tok">${tokens}</span>` : ""}</span>`;
    }
  };
  layout();
  treemapObserver = new ResizeObserver(layout);
  treemapObserver.observe(container);

  container.addEventListener("click", (e) => {
    const block = (e.target as HTMLElement).closest<HTMLElement>("[data-segment]");
    if (block) openInspector(report.segments.find((s) => s.id === block.dataset["segment"])!);
  });
}

// ---------------------------------------------------------------------------
// segments table
// ---------------------------------------------------------------------------

function segmentsTablePanel(report: RequestTokenReport): string {
  return `
    <section class="panel">
      <h2>Segments <span class="count">${report.segments.length} total — click a row to inspect</span></h2>
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="segments">
          <thead><tr><th>category</th><th>label</th><th>path</th><th>≈ Claude</th><th>OpenAI</th><th>cache</th></tr></thead>
          <tbody id="segments-tbody">
            ${report.segments
              .map(
                (s) => `<tr data-segment="${esc(s.id)}">
                  <td><span class="cat-chip" style="--dot:${categoryVar(s.category)}">${CATEGORY_LABEL[s.category]}</span></td>
                  <td><button class="segment-inspect" type="button" aria-label="Inspect ${esc(s.label)}">${esc(truncate(s.label, 60))}</button></td>
                  <td>${esc(s.path)}</td>
                  <td class="num">${fmtInt(s.claudeTokensEstimate)}</td>
                  <td class="num">${fmtInt(s.openaiTokens)}</td>
                  <td>${s.cacheControl ? `<span class="cache-flag"${s.cacheControl.automatic ? ' title="automatic breakpoint: the request has a top-level cache_control"' : ""}>● ${s.cacheControl.ttl}${s.cacheControl.automatic ? " auto" : ""}</span>` : ""}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function wireSegmentsTable(report: RequestTokenReport): void {
  $("#segments-tbody").addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-segment]");
    if (row) openInspector(report.segments.find((s) => s.id === row.dataset["segment"])!);
  });
}

/** The request with the most tokens, the later one on a tie. */
function largestRequest(result: AnalysisResult): number {
  let best = 0;
  const tokens = (r: RequestTokenReport): number => result.parse.format === "openai" ? r.totals.openaiTokens : r.totals.claudeTokensEstimate;
  result.reports.forEach((report, i) => {
    if (tokens(report) >= tokens(result.reports[best]!)) best = i;
  });
  return best;
}

// ---------------------------------------------------------------------------
// sequence / prefix panel
// ---------------------------------------------------------------------------

function sequencePanel(result: AnalysisResult): string {
  const pairs = result.prefixMatches;
  return `
    <section class="panel">
      <h2>Prompt-cache prefix match <span class="count">${
        result.conversations.count > 1
          ? `${fmtInt(result.conversations.count)} conversations in this file · each request against the request it continues`
          : "longest common prefix between each consecutive pair"
      }</span></h2>
      <div class="prefix-list" id="prefix-list">
        ${pairs
          .map((m, i) => {
            const totalNext = result.parse.requests[m.toIndex]!.segments.length;
            const pct = totalNext > 0 ? m.matchedSegments / totalNext : 0;
            return `<button type="button" aria-pressed="${i === state.selectedPair}" class="prefix-row ${i === state.selectedPair ? "active" : ""}" data-pair="${i}">
              <span class="arrow">req ${m.fromIndex + 1} → req ${m.toIndex + 1}</span>
              <span class="prefix-bar-track"><span class="prefix-bar-fill" style="width:${(pct * 100).toFixed(1)}%"></span></span>
              <span class="prefix-meta">${m.matchedSegments}/${totalNext} segs · ${result.parse.format === "openai" ? fmtInt(m.matchedOpenaiTokens) : `≈${fmtInt(m.matchedClaudeTokensEstimate)}`} tok${m.relation === "new_conversation" ? " · new conversation" : m.relation === "rewrites" ? " · history rewritten" : ""}</span>
            </button>`;
          })
          .join("")}
      </div>
      <div class="diff-view" id="diff-view" tabindex="0" role="group" aria-label="Difference from the request this one continues"></div>
    </section>
  `;
}

function wireSequencePanel(result: AnalysisResult): void {
  const list = $("#prefix-list");
  renderDiff(result);
  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-pair]");
    if (!row) return;
    const pair = Number(row.dataset["pair"]);
    selectRequest(result.prefixMatches[pair]!.toIndex);
    document.querySelector<HTMLElement>(`[data-pair="${pair}"]`)?.focus({ preventScroll: true });
  });
}

function renderDiff(result: AnalysisResult): void {
  const match = result.prefixMatches[state.selectedPair];
  const view = $("#diff-view");
  if (!match) {
    view.textContent = "This request has no earlier request to compare.";
    return;
  }
  view.innerHTML = match.diff.map((line) => `<div class="diff-line ${line.type}">${line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}${esc(line.text)}</div>`).join("");
}

// ---------------------------------------------------------------------------
// cache simulation panel
// ---------------------------------------------------------------------------

function cachePanel(result: AnalysisResult): string {
  const sim = result.cacheSimulation;
  const savings = sim.totalActualCostUsd !== undefined && sim.totalOptimizedCostUsd !== undefined ? sim.totalActualCostUsd - sim.totalOptimizedCostUsd : undefined;
  return `
    <section class="panel">
      <h2>Cache simulation <span class="count">${sim.provider} · ${esc(result.model.displayName)} · ${modelSourceNote(result)}</span></h2>
      <div class="table-scroll" tabindex="0" role="group" aria-label="Table, scrolls sideways">
        <table class="cache">
          <thead><tr><th>request</th><th>read</th><th>write 5m</th><th>write 1h</th><th>uncached</th><th>cost</th></tr></thead>
          <tbody>
            ${sim.actual
              .map(
                (s, i) =>
                  `<tr><td>req ${i + 1}</td><td>${fmtInt(s.readTokens)}</td><td>${fmtInt(s.writeTokens5m)}</td><td>${fmtInt(s.writeTokens1h)}</td><td>${fmtInt(s.uncachedTokens)}</td><td>${fmtUsd(s.costUsd)}</td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="stat-row" style="margin-top:12px">
        <div class="stat-tile"><div class="label">current simulated cost</div><div class="value">${fmtUsd(sim.totalActualCostUsd)}</div></div>
        <div class="stat-tile"><div class="label">optimized simulated cost</div><div class="value">${fmtUsd(sim.totalOptimizedCostUsd)}</div></div>
      </div>
      ${savings !== undefined && savings >= 0.00005 ? `<div class="savings-banner">Fixing these findings${sim.provider === "anthropic" ? ", plus an automatic breakpoint on every request's tail," : ""} would save ${fmtUsd(savings)} (${((savings / sim.totalActualCostUsd!) * 100).toFixed(0)}%) on this sequence — ≈${fmtUsdRounded(savings * 1000)} per 1,000 sessions shaped like this one.</div>` : ""}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// findings panel
// ---------------------------------------------------------------------------

let groupsCache: { result: AnalysisResult; groups: FindingGroup[] } | undefined;

/** groupFindings is loaded with the core module; memoized per analysis since several panels need it. */
function currentGroups(result: AnalysisResult): FindingGroup[] {
  if (groupsCache?.result !== result) groupsCache = { result, groups: loadedCore!.groupFindings(result.findings) };
  return groupsCache.groups;
}

function modelSourceNote(result: AnalysisResult): string {
  const { model } = result;
  if (model.source === "option") return "chosen above";
  if (model.source === "request") return "from the requests";
  if (model.unrecognized) return `"${esc(model.unrecognized)}" isn't in the pricing table`;
  return "default, no model in the requests";
}

// Occurrence buttons shown per group before collapsing the rest into a count.
const MAX_OCCURRENCE_LINKS = 12;

function findingsPanel(result: AnalysisResult): string {
  const groups = currentGroups(result);
  if (groups.length === 0) {
    return `<section class="panel"><h2>Findings</h2><p class="empty-state">No supported cache or duplicate-content issues detected in the parsed requests. This does not verify live cache hits.</p></section>`;
  }
  const recurring = result.findings.length > groups.length ? ` from ${result.findings.length} findings` : "";
  return `
    <section class="panel">
      <h2>Findings <span class="count">${groups.length} issue${groups.length === 1 ? "" : "s"}${recurring}</span></h2>
      <div class="finding-list">
        ${groups
          .map((g, gi) => {
            const where = loadedCore!.describeRequestIndices(g.requestIndices);
            const occurrences =
              g.requestIndices.length > 1
                ? `<div class="foccur">${g.requestIndices
                    .slice(0, MAX_OCCURRENCE_LINKS)
                    .map((r) => `<button type="button" class="occ ${r === state.selectedRequest ? "active" : ""}" data-group="${gi}" data-req="${r}">req ${r + 1}</button>`)
                    .join("")}${g.requestIndices.length > MAX_OCCURRENCE_LINKS ? `<span class="occ-more">+${g.requestIndices.length - MAX_OCCURRENCE_LINKS} more</span>` : ""}</div>`
                : "";
            return `<div class="finding ${g.severity}">
              <button type="button" class="fhead" data-group="${gi}" data-req="${g.requestIndices[0]}"><span class="fsev">${g.severity}</span> ${esc(g.title)} <span class="freq">(${where}${g.requestIndices.length > 1 ? `, ${g.requestIndices.length}×` : ""})</span></button>
              <div class="fdetail">${esc(g.detail)}</div>
              ${occurrences}
            </div>`;
          })
          .join("")}
      </div>
    </section>
  `;
}

function wireFindings(result: AnalysisResult): void {
  const groups = currentGroups(result);
  $all("[data-group]").forEach((el) => {
    el.addEventListener("click", () => {
      const group = groups[Number(el.dataset["group"])];
      const requestIndex = Number(el.dataset["req"]);
      if (!group) return;
      const finding = group.findings.find((f) => f.requestIndex === requestIndex) ?? group.findings[0]!;
      if (finding.requestIndex !== state.selectedRequest) {
        selectRequest(finding.requestIndex);
        const replacement = document.querySelector<HTMLElement>(`[data-group="${el.dataset["group"]}"][data-req="${requestIndex}"].${el.classList.contains("occ") ? "occ" : "fhead"}`);
        replacement?.focus({ preventScroll: true });
      }
      const segId = finding.segmentIds[finding.segmentIds.length - 1];
      if (segId) {
        const seg = result.reports[finding.requestIndex]?.segments.find((s) => s.id === segId);
        if (seg) openInspector(seg);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// duplicates panel
// ---------------------------------------------------------------------------

function duplicatesPanel(result: AnalysisResult): string {
  return `
    <section class="panel">
      <h2>Duplicate content <span class="count">${result.duplicates.length} group${result.duplicates.length === 1 ? "" : "s"}</span></h2>
      <div class="dup-list">
        ${result.duplicates
          .map(
            (g) =>
              `<div class="dup-row"><span>${g.members.length}× "${esc(truncate(g.members[0]!.label, 50))}" <span style="color:var(--text-faint)">(similarity ${(g.similarity * 100).toFixed(0)}%)</span></span><span class="waste">≈${fmtInt(g.estimatedWastedTokens)} wasted tok</span></div>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// calibration panel
// ---------------------------------------------------------------------------

function calibratePanel(result: AnalysisResult): string {
  if (result.parse.format !== "anthropic") return "";
  const c = state.calibration;
  const summary = c
    ? `<p class="calibrate-result" role="status">Using your measured count of <strong>${fmtInt(c.exactTokens)}</strong> input tokens for request ${c.requestIndex + 1} on ${esc(c.model)}. The original estimate was ≈${fmtInt(c.estimatedTokens)}. Every Claude estimate is scaled ×${c.scale.toFixed(3)}. Other requests and individual segments remain estimates. <button class="btn link" id="calibrate-reset" type="button">undo calibration</button></p>`
    : "";
  return `
    <section class="panel">
      <h2>Calibrate Claude estimates <span class="count">optional · local only</span></h2>
      <p class="panel-note" id="calibrate-help">
        Enter the whole-request <code>input_tokens</code> count you measured with <code>count_tokens</code>
        for request ${state.selectedRequest + 1} on ${esc(result.model.displayName)}. This rescales the session's estimates;
        it does not make each segment exact. Use the same request and model. No API key or request is sent from this page.
      </p>
      <form class="calibrate-row" id="calibrate-form" novalidate>
        <label for="calibrate-count">Measured input tokens</label>
        <input type="number" id="calibrate-count" min="1" max="9007199254740991" step="1" inputmode="numeric" placeholder="e.g. 18420" aria-describedby="calibrate-help calibrate-status" />
        <button class="btn primary" id="calibrate-btn" type="submit">apply to request ${state.selectedRequest + 1}</button>
        <span class="calibrate-status" id="calibrate-status" role="alert"></span>
      </form>
      ${summary}
    </section>
  `;
}

function wireCalibrate(result: AnalysisResult): void {
  document.getElementById("calibrate-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pendingLoad) return;
    const input = $("#calibrate-count") as HTMLInputElement;
    try {
      // Re-parse the unscaled input: repeated calibration must never compound rounding.
      const parsed = loadedCore!.parseInput(lastRawInput!, result.parse.format);
      const calibration = loadedCore!.calibrateRequest(parsed.requests[state.selectedRequest]!, result.model.id, input.valueAsNumber);
      runAnalysis(lastRawInput!, { ...state, calibration });
    } catch (err) {
      $("#calibrate-status").textContent = (err as Error).message;
      input.setAttribute("aria-invalid", "true");
      input.focus();
    } finally {
      loadedCore?.clearTokenCache();
    }
  });
  document.getElementById("calibrate-reset")?.addEventListener("click", () => {
    if (lastRawInput !== undefined) runAnalysis(lastRawInput, { ...state, calibration: undefined });
  });
}

// ---------------------------------------------------------------------------
// inspector drawer
// ---------------------------------------------------------------------------

function openInspector(segment: Segment): void {
  $("#drawer-title").textContent = segment.label;
  const rawPretty = typeof segment.raw === "string" ? segment.raw : JSON.stringify(segment.raw, null, 2);
  $("#drawer-body").innerHTML = `
    <dl>
      <dt>category</dt><dd>${CATEGORY_LABEL[segment.category]}</dd>
      <dt>path</dt><dd>${esc(segment.path)}</dd>
      <dt>chars</dt><dd>${fmtInt(segment.charLength)}</dd>
      <dt>≈ Claude tokens</dt><dd>${fmtInt(segment.claudeTokensEstimate)}${state.calibration ? ` <span class="muted">(scaled ×${state.calibration.scale.toFixed(3)})</span>` : ""}</dd>
      <dt>OpenAI tokens</dt><dd>${fmtInt(segment.openaiTokens)}</dd>
      <dt>cache_control</dt><dd>${segment.cacheControl ? `ephemeral, ${segment.cacheControl.ttl}${segment.cacheControl.automatic ? " (automatic: the request's top-level cache_control lands on this block)" : ""}` : "none"}</dd>
    </dl>
    <pre>${esc(rawPretty)}</pre>
  `;
  const drawer = $("#drawer") as HTMLDialogElement;
  if (!drawer.open) {
    drawerOpener = document.activeElement;
    drawer.showModal();
  }
  $("#drawer-close").focus();
}

let drawerOpener: Element | null = null;

function closeDrawer(): void {
  const drawer = $("#drawer") as HTMLDialogElement;
  if (drawer.open) drawer.close();
  $("#drawer-title").textContent = "segment";
  $("#drawer-body").replaceChildren();
  if (drawerOpener instanceof HTMLElement && drawerOpener.isConnected) drawerOpener.focus();
  drawerOpener = null;
}
