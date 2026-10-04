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
      && Number.isSafeInteger(report.totals?.openaiTokens) && Number.isSafeInteger(report.totals.claudeTokensEstimate));
}

/** Static hosts cannot attach a worker CSP header. A blob module inherits the page policy;
 * its only code imports our bundled asset, so connect-src 'self' also covers computation. */
function localWorker(): Worker {
  const asset = new URL(workerAsset, location.href);
  if (asset.origin !== location.origin) throw new Error("The analysis worker must be served from this site's origin.");
  const url = URL.createObjectURL(new Blob([`import ${JSON.stringify(asset.href)};`], { type: "text/javascript" }));
  try {
    const worker = new Worker(url, { type: "module" });
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => { terminate(); URL.revokeObjectURL(url); };
    return worker;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** One disposable worker per operation. Abort stops CPU work and drops its tokenizer caches. */
export function analyzeInWorker(job: AnalysisJob, signal: AbortSignal, createWorker: () => Worker = localWorker): Promise<Success> {
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
    try {
      worker = createWorker();
      if (signal.aborted || settled) { worker.terminate(); return; }
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
    } catch (err) {
      finish(undefined, new Error(`Could not start local analysis: ${err instanceof Error ? err.message : String(err)}. Try importing the log again.`));
    }
  });
}
