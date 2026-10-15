import "./fonts/fonts.css";
import "./style.css";
import { initApp } from "./app.js";
import { prepareAnalysisWorker } from "./analysis.js";

const root = document.getElementById("app");
if (!root) throw new Error("contextscope: #app root element not found");

// Results and inspectors use weights that the empty intake may not. Prepare
// their Latin faces too; optional font failures must not block local analysis.
for (const [family, weights] of [["IBM Plex Mono", [400, 500, 600, 700]], ["IBM Plex Sans", [400, 500, 600]]] as const) {
  for (const weight of weights) void document.fonts.load(`${weight} 12px "${family}"`).catch(() => undefined);
}

async function start(root: HTMLElement): Promise<void> {
  root.innerHTML = '<main class="app-startup"><h1>contextscope</h1><p role="status">Preparing local analysis...</p><button class="btn" type="button">Cancel loading</button></main>';
  const operation = new AbortController();
  root.querySelector("button")!.addEventListener("click", () => operation.abort(new DOMException("Loading cancelled.", "AbortError")), { once: true });
  const timeout = setTimeout(() => operation.abort(new Error("Local preparation timed out.")), 30_000);
  const abort = (): void => operation.abort();
  addEventListener("pagehide", abort, { once: true });
  try {
    await prepareAnalysisWorker(operation.signal);
    initApp(root);
  } catch {
    root.innerHTML = '<main class="app-startup"><h1>contextscope</h1><p role="alert"></p><button class="btn" type="button">Retry loading</button></main>';
    root.querySelector("p")!.textContent = operation.signal.reason instanceof DOMException && operation.signal.reason.name === "AbortError"
      ? "Loading cancelled." : "Local analysis could not start. Check your connection and retry.";
    root.querySelector("button")!.addEventListener("click", () => { void start(root); }, { once: true });
  } finally {
    clearTimeout(timeout);
    removeEventListener("pagehide", abort);
  }
}

void start(root);
