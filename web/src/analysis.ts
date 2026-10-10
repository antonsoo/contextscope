import type { AnalysisJob, AnalysisReply } from "./analysis-protocol.js";
import workerAsset from "./analysis-worker.ts?worker&url";

type Success = Extract<AnalysisReply, { type: "success" }>;

function resultContract(result: Success["result"] | undefined): boolean {
  if (!result || typeof result.parse?.complete !== "boolean" || !Array.isArray(result.parse.requests)) return false;
  const n = result.parse.requests.length;
  return n > 0 && Array.isArray(result.reports) && result.reports.length === n
    && typeof result.model?.id === "string" && typeof result.model.displayName === "string"
    && Array.isArray(result.prefixMatches) && Array.isArray(result.findings) && Array.isArray(result.duplicates)
    && Array.isArray(result.conversations?.byRequest) && result.conversations.byRequest.length === n
    && Array.isArray(result.cacheSimulation?.actual) && result.cacheSimulation.actual.length === n
    && Array.isArray(result.cacheSimulation.optimized) && result.cacheSimulation.optimized.length === n
    && result.reports.every((report) => Array.isArray(report?.segments) && Array.isArray(report.byCategory)
      && typeof report.model?.id === "string" && typeof report.model.displayName === "string"
      && Number.isSafeInteger(report.totals?.openaiTokens) && Number.isSafeInteger(report.totals.claudeTokensEstimate));
}

// Only trusted application code is retained between jobs, never a worker or its request data.
let workerSource: string | undefined;

/** Static hosts cannot attach a worker CSP header. A blob module inherits the page policy.
 * Cache the self-contained production bundle so disposable workers also start offline. */
async function localWorker(signal: AbortSignal): Promise<Worker> {
  const asset = new URL(workerAsset, location.href);
  if (asset.origin !== location.origin) throw new Error("The analysis worker must be served from this site's origin.");
  let source: string;
  if (import.meta.env.DEV) {
    // Vite's development module has imports relative to its original URL.
    source = `import ${JSON.stringify(asset.href)};`;
  } else {
    if (workerSource === undefined) {
      const response = await fetch(asset.href, { signal, redirect: "error" });
      if (!response.ok) throw new Error(`Could not load analysis code (HTTP ${response.status}).`);
      if (!/^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
        throw new Error("The analysis code response is not JavaScript.");
      }
      const downloaded = await response.text();
      signal.throwIfAborted();
      source = downloaded;
    } else source = workerSource;
  }
  signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const worker = new Worker(url, { type: "module" });
    if (!import.meta.env.DEV) worker.addEventListener("message", (event: MessageEvent<Partial<AnalysisReply>>) => {
      // A 200 JavaScript response can still be truncated. Retain it only after the
      // worker executes; syntax/startup failures must allow another download.
      if (event.data?.type === "started") workerSource = source;
    }, { once: true });
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => { terminate(); URL.revokeObjectURL(url); };
    return worker;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** One disposable worker per operation. Abort stops CPU work and drops its tokenizer caches. */
export function analyzeInWorker(job: AnalysisJob, signal: AbortSignal, createWorker: (signal: AbortSignal) => Worker | Promise<Worker> = localWorker): Promise<Success> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    const finish = (result?: Success, error?: unknown): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      if (result) resolve(result);
      else reject(error);
    };
    const abort = (): void => finish(undefined, signal.reason ?? new DOMException("Analysis cancelled.", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    const start = (created: Worker): void => {
      if (signal.aborted || settled) { created.terminate(); return; }
      worker = created;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const reply = event.data as Partial<AnalysisReply> | null;
        if (reply?.type === "started") return;
        if (reply?.type === "error" && typeof reply.message === "string") {
          finish(undefined, new Error(reply.message));
        } else if (reply?.type === "success" && resultContract(reply.result)) {
          finish(reply as Success);
        } else {
          finish(undefined, new Error("Analysis worker returned an unreadable result. Try importing the log again."));
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(undefined, new Error(`Analysis worker failed: ${event.message || "could not load or process this log"}. Try importing the log again.`));
      };
      worker.onmessageerror = () => finish(undefined, new Error("Could not receive the analysis result. Try a smaller session."));
      worker.postMessage(job);
    };
    const failedStart = (err: unknown): void => {
      finish(undefined, new Error(`Could not start local analysis: ${err instanceof Error ? err.message : String(err)}. Try importing the log again.`));
    };
    try {
      const created = createWorker(signal);
      if (created instanceof Promise) void created.then(start).catch(failedStart);
      else start(created);
    } catch (err) {
      failedStart(err);
    }
  });
}
