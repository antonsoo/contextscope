import type { AnalysisResult, Provider, RequestTokenReport, Segment } from "@core/types.js";
import { squarify } from "./lib/treemap.js";
import { BUILT_IN_EXAMPLES } from "./lib/examples.js";
import { CATEGORY_LABEL, CATEGORY_ORDER, categoryVar, fmtInt, fmtPct, fmtUsd, fmtUsdRounded, truncate } from "./lib/format.js";
import { $, $all, esc } from "./lib/dom.js";
import { readPossiblyGzippedFile } from "./lib/gunzip.js";

// The core library (and the ~1MB o200k_base tokenizer data it pulls in) is loaded on demand, not
// on page load - the drop-zone screen should be instant. Everything that touches it is async.
type CoreModule = typeof import("@core/index.js");
let corePromise: Promise<CoreModule> | undefined;
function loadCore(): Promise<CoreModule> {
  corePromise ??= import("@core/index.js");
  return corePromise;
}

interface State {
  format: Provider | "auto";
  model: string | undefined;
  analysis: AnalysisResult | undefined;
  selectedRequest: number;
  selectedPair: number;
  calibration: Map<string, number>;
}

const state: State = {
  format: "auto",
  model: undefined,
  analysis: undefined,
  selectedRequest: 0,
  selectedPair: 0,
  calibration: new Map(),
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
      <div class="wordmark"><span class="addr">0x00&nbsp;</span>contextscope<span class="dot">.</span></div>
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

    <main id="intake" class="intake">
      <div class="dropzone" id="dropzone">
        <h1>drop a request, or paste one</h1>
        <p class="lead">A single Anthropic Messages or OpenAI Chat Completions request, a JSON array, or JSONL - one API request per line, the shape an agent loop actually sends. A gzipped <code>.jsonl.gz</code> works too, decompressed right here.</p>
        <div class="intake-actions">
          <button class="btn primary" id="pick-file-btn" type="button">choose file…</button>
          <button class="btn" id="paste-btn" type="button">paste JSON…</button>
          <input type="file" id="file-input" accept=".json,.jsonl,.gz,application/json,application/gzip" class="visually-hidden" />
        </div>
        <textarea id="paste-area" placeholder="paste a request, a JSON array of requests, or JSONL here" spellcheck="false"></textarea>
        <div class="intake-actions" id="paste-run-row" hidden>
          <button class="btn primary" id="run-paste-btn" type="button">analyze</button>
        </div>
        <p class="hint">Nothing leaves your browser. Parsing and token counting run locally.</p>
        <div class="examples-row">
          <p>or load a built-in example (synthetic data, labelled below)</p>
          <div class="example-chip-row" id="example-chips"></div>
        </div>
      </div>
    </main>

    <div id="dashboard" class="dashboard">
      <nav class="request-tabs" id="request-tabs"></nav>
      <div class="content" id="content"></div>
      <footer class="app-footer">
        contextscope is local-first: analysis runs in your browser, nothing is uploaded. Claude token counts are estimates (≈) - see
        <a href="https://github.com/antonsoo/contextscope#accuracy-and-limitations" target="_blank" rel="noopener">accuracy and limitations</a>.
      </footer>
    </div>

    <div class="drawer-backdrop" id="drawer-backdrop"></div>
    <aside class="drawer" id="drawer" aria-hidden="true">
      <div class="drawer-head">
        <h3 id="drawer-title">segment</h3>
        <button class="icon-btn" id="drawer-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="drawer-body" id="drawer-body"></div>
    </aside>
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
    if (file) void readPossiblyGzippedFile(file).then((text) => runAnalysis(text));
  });

  $("#paste-btn").addEventListener("click", () => {
    pasteArea.classList.add("shown");
    pasteRunRow.hidden = false;
    pasteArea.focus();
  });
  $("#run-paste-btn").addEventListener("click", () => {
    if (pasteArea.value.trim().length > 0) runAnalysis(pasteArea.value);
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
    if (file) void readPossiblyGzippedFile(file).then((text) => runAnalysis(text));
  });

  const chipRow = $("#example-chips");
  chipRow.innerHTML = BUILT_IN_EXAMPLES.map(
    (ex) =>
      `<button class="example-chip" type="button" data-example="${ex.id}" title="${esc(ex.description)}">${esc(ex.label)}${ex.approxSizeMb >= 0.2 ? ` <span class="chip-size">(${ex.approxSizeMb.toFixed(2)} MB gz)</span>` : ""}</button>`,
  ).join("");
  chipRow.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-example]");
    if (!target) return;
    const example = BUILT_IN_EXAMPLES.find((ex) => ex.id === target.dataset["example"]);
    if (!example) return;
    state.format = example.format;
    state.model = example.model;
    target.textContent = "loading…";
    void example.load().then((content) => runAnalysis(content));
  });
}

function wireTopbar(): void {
  $("#new-analysis-btn").addEventListener("click", () => {
    state.analysis = undefined;
    $("#dashboard").classList.remove("shown");
    $("#topbar-controls").hidden = true;
    $("#intake").style.display = "grid";
  });

  const formatSelect = $("#format-select") as HTMLSelectElement;
  formatSelect.addEventListener("change", () => {
    state.format = formatSelect.value as Provider | "auto";
    if (lastRawInput !== undefined) runAnalysis(lastRawInput);
  });

  const modelSelect = $("#model-select") as HTMLSelectElement;
  modelSelect.addEventListener("change", () => {
    state.model = modelSelect.value;
    if (lastRawInput !== undefined) runAnalysis(lastRawInput);
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
  $("#drawer-backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
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

function runAnalysis(input: string): void {
  void runAnalysisAsync(input);
}

async function runAnalysisAsync(input: string): Promise<void> {
  lastRawInput = input;
  state.calibration = new Map();
  setLoading(true);
  try {
    const core = await loadCore();
    const result = core.analyze(input, {
      format: state.format === "auto" ? undefined : state.format,
      model: state.model,
    });
    state.analysis = result;
    // Default to the LAST request: that's where the context is biggest and most interesting
    // (a growing agent-loop transcript), not the smallest, near-empty first turn.
    state.selectedRequest = result.reports.length - 1;
    state.selectedPair = Math.max(0, result.prefixMatches.length - 1);
    if (state.model === undefined) state.model = result.cacheSimulation.model ?? defaultModelFor(result.parse.format);
    showDashboard(core);
  } catch (err) {
    alert(`Could not analyze this input: ${(err as Error).message}`);
  } finally {
    setLoading(false);
  }
}

function setLoading(loading: boolean): void {
  const btns = [$("#run-paste-btn"), $("#pick-file-btn")] as HTMLButtonElement[];
  for (const btn of btns) btn.disabled = loading;
  document.getElementById("dropzone")?.setAttribute("aria-busy", String(loading));
}

function defaultModelFor(format: Provider): string {
  return format === "anthropic" ? "claude-sonnet-5" : "gpt-6-sol";
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

function showDashboard(core: CoreModule): void {
  const result = state.analysis;
  if (!result) return;

  ($("#intake") as HTMLElement).style.display = "none";
  $("#dashboard").classList.add("shown");
  $("#topbar-controls").hidden = false;

  const formatSelect = $("#format-select") as HTMLSelectElement;
  formatSelect.value = state.format;

  const modelSelect = $("#model-select") as HTMLSelectElement;
  const models = result.parse.format === "anthropic" ? core.ANTHROPIC_MODELS : core.OPENAI_MODELS;
  modelSelect.innerHTML = models.map((m) => `<option value="${m.id}">${esc(m.displayName)}</option>`).join("");
  modelSelect.value = state.model ?? models[0]!.id;

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
        `<button class="request-tab ${i === state.selectedRequest ? "active" : ""}" data-req="${i}" type="button">req ${i + 1}<span class="pct">${fmtPct(r.percentOfContextWindow, 2)}</span></button>`,
    )
    .join("");

  // Bring the active tab into view - important now that the default is the LAST request, which
  // is usually scrolled off the right edge of this horizontally-scrolling strip.
  tabs.querySelector(".request-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });

  // Wired once against the container (a fixture of the static shell), not per render - `tabs`
  // itself is never replaced, only its innerHTML, so re-adding a listener here on every render
  // would stack N duplicate handlers after N tab switches.
  if (!requestTabsWired) {
    requestTabsWired = true;
    tabs.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-req]");
      if (!btn) return;
      state.selectedRequest = Number(btn.dataset["req"]);
      renderRequestTabs();
      renderContent();
    });
  }
}

function renderContent(): void {
  const result = state.analysis!;
  const content = $("#content");
  const report = result.reports[state.selectedRequest]!;

  content.innerHTML = `
    ${statTilesPanel(report, result)}
    ${treemapPanel(report)}
    ${segmentsTablePanel(report)}
    ${result.parse.requests.length > 1 ? sequencePanel(result) : ""}
    ${cachePanel(result)}
    ${findingsPanel(result)}
    ${result.duplicates.length > 0 ? duplicatesPanel(result) : ""}
    ${calibratePanel(result)}
  `;

  wireTreemap(report);
  wireSegmentsTable(report);
  if (result.parse.requests.length > 1) wireSequencePanel(result);
  wireFindings(result);
  wireCalibrate(result);
}

// ---------------------------------------------------------------------------
// stat tiles
// ---------------------------------------------------------------------------

function statTilesPanel(report: RequestTokenReport, result: AnalysisResult): string {
  const errorCount = result.findings.filter((f) => f.severity === "error").length;
  const warnCount = result.findings.filter((f) => f.severity === "warning").length;
  const savings =
    result.cacheSimulation.totalActualCostUsd !== undefined && result.cacheSimulation.totalOptimizedCostUsd !== undefined
      ? result.cacheSimulation.totalActualCostUsd - result.cacheSimulation.totalOptimizedCostUsd
      : undefined;
  return `
    <section class="panel">
      <h2>Request ${state.selectedRequest + 1} of ${result.reports.length}</h2>
      <div class="stat-row">
        <div class="stat-tile"><div class="label">≈ Claude tokens</div><div class="value">${fmtInt(report.totals.claudeTokensEstimate)}</div></div>
        <div class="stat-tile"><div class="label">OpenAI tokens (exact)</div><div class="value">${fmtInt(report.totals.openaiTokens)}</div></div>
        <div class="stat-tile"><div class="label">of context window</div><div class="value">${fmtPct(report.percentOfContextWindow, 2)}</div></div>
        <div class="stat-tile"><div class="label">findings</div><div class="value">${errorCount > 0 ? errorCount + " err" : warnCount > 0 ? warnCount + " warn" : "0"}</div></div>
        ${savings !== undefined && savings > 1e-9 ? `<div class="stat-tile"><div class="label">potential savings</div><div class="value good">${fmtUsd(savings)}</div></div>` : ""}
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// treemap
// ---------------------------------------------------------------------------

function treemapPanel(report: RequestTokenReport): string {
  return `
    <section class="panel">
      <h2>Token usage — treemap <span class="count">colored by category, sized by ≈ Claude tokens</span></h2>
      <div class="treemap" id="treemap" role="img" aria-label="Treemap of token usage by segment"></div>
      <div class="legend">
        ${CATEGORY_ORDER.filter((c) => report.byCategory.some((b) => b.category === c))
          .map((c) => `<span class="legend-item"><span class="legend-swatch" style="background:${categoryVar(c)}"></span>${CATEGORY_LABEL[c]}</span>`)
          .join("")}
      </div>
    </section>
  `;
}

function wireTreemap(report: RequestTokenReport): void {
  const container = $("#treemap");
  const rect = container.getBoundingClientRect();
  const w = rect.width || 800;
  const h = rect.height || 340;
  const items = report.segments
    .filter((s) => s.claudeTokensEstimate > 0)
    .map((s) => ({ value: s.claudeTokensEstimate, item: s }));
  const laid = squarify(items, { x: 0, y: 0, w, h });

  container.innerHTML = laid
    .map(({ rect: r, item: s }) => {
      const showLabel = r.w > 46 && r.h > 24;
      return `<div class="tm-block" tabindex="0" role="button" data-segment="${esc(s.id)}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${categoryVar(s.category)}" title="${esc(s.label)} — ≈${s.claudeTokensEstimate} tokens">${
        showLabel ? `<div class="tm-label">${esc(truncate(s.label, 40))}<span class="tm-tok">≈${fmtInt(s.claudeTokensEstimate)} tok</span></div>` : ""
      }</div>`;
    })
    .join("");

  container.addEventListener("click", (e) => {
    const block = (e.target as HTMLElement).closest<HTMLElement>("[data-segment]");
    if (block) openInspector(report.segments.find((s) => s.id === block.dataset["segment"])!);
  });
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const block = (e.target as HTMLElement).closest<HTMLElement>("[data-segment]");
    if (block) {
      e.preventDefault();
      openInspector(report.segments.find((s) => s.id === block.dataset["segment"])!);
    }
  });
}

// ---------------------------------------------------------------------------
// segments table
// ---------------------------------------------------------------------------

function segmentsTablePanel(report: RequestTokenReport): string {
  return `
    <section class="panel">
      <h2>Segments <span class="count">${report.segments.length} total — click a row to inspect</span></h2>
      <div class="table-scroll">
        <table class="segments">
          <thead><tr><th>category</th><th>label</th><th>path</th><th>≈ Claude</th><th>OpenAI</th><th>cache</th></tr></thead>
          <tbody id="segments-tbody">
            ${report.segments
              .map(
                (s) => `<tr data-segment="${esc(s.id)}">
                  <td><span class="cat-chip" style="--dot:${categoryVar(s.category)}">${CATEGORY_LABEL[s.category]}</span></td>
                  <td>${esc(truncate(s.label, 60))}</td>
                  <td>${esc(s.path)}</td>
                  <td class="num">${fmtInt(s.claudeTokensEstimate)}</td>
                  <td class="num">${fmtInt(s.openaiTokens)}</td>
                  <td>${s.cacheControl ? `<span class="cache-flag">● ${s.cacheControl.ttl}</span>` : ""}</td>
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

// ---------------------------------------------------------------------------
// sequence / prefix panel
// ---------------------------------------------------------------------------

function sequencePanel(result: AnalysisResult): string {
  const pairs = result.prefixMatches;
  return `
    <section class="panel">
      <h2>Prompt-cache prefix match <span class="count">longest common prefix between each consecutive pair</span></h2>
      <div class="prefix-list" id="prefix-list">
        ${pairs
          .map((m, i) => {
            const totalNext = result.parse.requests[m.toIndex]!.segments.length;
            const pct = totalNext > 0 ? m.matchedSegments / totalNext : 0;
            return `<div class="prefix-row ${i === state.selectedPair ? "active" : ""}" data-pair="${i}">
              <span class="arrow">req ${m.fromIndex + 1} → req ${m.toIndex + 1}</span>
              <span class="prefix-bar-track"><span class="prefix-bar-fill" style="width:${(pct * 100).toFixed(1)}%"></span></span>
              <span class="prefix-meta">${m.matchedSegments}/${totalNext} segs · ≈${fmtInt(m.matchedClaudeTokensEstimate)} tok</span>
            </div>`;
          })
          .join("")}
      </div>
      <div class="diff-view" id="diff-view"></div>
    </section>
  `;
}

function wireSequencePanel(result: AnalysisResult): void {
  const list = $("#prefix-list");
  renderDiff(result);
  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-pair]");
    if (!row) return;
    state.selectedPair = Number(row.dataset["pair"]);
    $all(".prefix-row", list).forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    renderDiff(result);
  });
}

function renderDiff(result: AnalysisResult): void {
  const match = result.prefixMatches[state.selectedPair];
  const view = $("#diff-view");
  if (!match) {
    view.innerHTML = "";
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
      <h2>Cache simulation <span class="count">${sim.provider}${state.model ? ` · ${state.model}` : ""}</span></h2>
      <div class="table-scroll">
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
        <div class="stat-tile"><div class="label">total actual cost</div><div class="value">${fmtUsd(sim.totalActualCostUsd)}</div></div>
        <div class="stat-tile"><div class="label">total optimized cost</div><div class="value">${fmtUsd(sim.totalOptimizedCostUsd)}</div></div>
      </div>
      ${savings !== undefined && savings > 1e-9 ? `<div class="savings-banner">Fixing the findings below${sim.provider === "anthropic" ? ", plus an automatic breakpoint on every request's tail," : ""} would save ${fmtUsd(savings)} (${((savings / sim.totalActualCostUsd!) * 100).toFixed(0)}%) on this sequence — ≈${fmtUsdRounded(savings * 1000)} per 1,000 sessions shaped like this one.</div>` : ""}
    </section>
  `;
}

// ---------------------------------------------------------------------------
// findings panel
// ---------------------------------------------------------------------------

function findingsPanel(result: AnalysisResult): string {
  if (result.findings.length === 0) {
    return `<section class="panel"><h2>Findings</h2><p class="empty-state">✓ No findings — this sequence caches cleanly.</p></section>`;
  }
  return `
    <section class="panel">
      <h2>Findings <span class="count">${result.findings.length}</span></h2>
      <div class="finding-list">
        ${result.findings
          .map(
            (f, i) => `<div class="finding ${f.severity}" data-finding="${i}">
              <div class="fhead"><span class="fsev">${f.severity}</span> ${esc(f.title)} <span class="freq">(request ${f.requestIndex + 1})</span></div>
              <div class="fdetail">${esc(f.detail)}</div>
            </div>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

function wireFindings(result: AnalysisResult): void {
  const panel = $all(".finding");
  panel.forEach((el) => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset["finding"]);
      const finding = result.findings[idx];
      if (!finding) return;
      if (finding.requestIndex !== state.selectedRequest) {
        state.selectedRequest = finding.requestIndex;
        renderRequestTabs();
        renderContent();
      }
      const segId = finding.segmentIds[0];
      if (segId) {
        const report = result.reports[finding.requestIndex];
        const seg = report?.segments.find((s) => s.id === segId);
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
  return `
    <section class="panel">
      <h2>Calibrate Claude estimates <span class="count">optional</span></h2>
      <p style="color:var(--text-muted); font-size:12px; margin:0 0 10px">
        Paste an Anthropic API key to replace the ≈ estimates for the selected request with exact counts from
        <code>count_tokens</code>. The key stays in this tab's memory only - never stored, never sent anywhere but api.anthropic.com.
      </p>
      <div class="calibrate-row">
        <input type="password" id="calibrate-key" placeholder="sk-ant-…" autocomplete="off" />
        <button class="btn primary" id="calibrate-btn" type="button">calibrate this request</button>
        <span class="calibrate-status" id="calibrate-status"></span>
      </div>
    </section>
  `;
}

function wireCalibrate(result: AnalysisResult): void {
  const btn = document.getElementById("calibrate-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    void runCalibration(result);
  });
}

async function runCalibration(result: AnalysisResult): Promise<void> {
  const keyInput = $("#calibrate-key") as HTMLInputElement;
  const status = $("#calibrate-status");
  const key = keyInput.value.trim();
  if (!key) {
    status.textContent = "enter an API key first";
    return;
  }
  const report = result.reports[state.selectedRequest]!;
  const model = state.model ?? "claude-sonnet-5";
  status.textContent = `calibrating ${report.segments.length} segments…`;
  try {
    const core = await loadCore();
    const results = await core.calibrateSegments(
      key,
      model,
      report.segments.map((s) => ({ segmentKey: s.id, text: s.text })),
    );
    for (const r of results) state.calibration.set(r.segmentKey, r.tokens);
    status.textContent = `done — ${results.length} segments calibrated`;
    renderContent();
  } catch (err) {
    status.textContent = `calibration failed: ${(err as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// inspector drawer
// ---------------------------------------------------------------------------

function openInspector(segment: Segment): void {
  $("#drawer-title").textContent = segment.label;
  const calibrated = state.calibration.get(segment.id);
  const rawPretty = typeof segment.raw === "string" ? segment.raw : JSON.stringify(segment.raw, null, 2);
  $("#drawer-body").innerHTML = `
    <dl>
      <dt>category</dt><dd>${CATEGORY_LABEL[segment.category]}</dd>
      <dt>path</dt><dd>${esc(segment.path)}</dd>
      <dt>chars</dt><dd>${fmtInt(segment.charLength)}</dd>
      <dt>≈ Claude tokens</dt><dd>${fmtInt(segment.claudeTokensEstimate)}${calibrated !== undefined ? ` <span style="color:var(--status-good)">→ ${fmtInt(calibrated)} (calibrated)</span>` : ""}</dd>
      <dt>OpenAI tokens</dt><dd>${fmtInt(segment.openaiTokens)}</dd>
      <dt>cache_control</dt><dd>${segment.cacheControl ? `ephemeral, ${segment.cacheControl.ttl}` : "none"}</dd>
    </dl>
    <pre>${esc(rawPretty)}</pre>
  `;
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#drawer-backdrop").classList.add("open");
}

function closeDrawer(): void {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#drawer-backdrop").classList.remove("open");
}
