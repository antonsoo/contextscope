import { analyze, parseInput } from "@core/analyze.js";
import { calibrateRequest } from "@core/calibrate.js";
import type { AnalysisJob, AnalysisReply } from "./analysis-protocol.js";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisJob>) => void) | null;
  postMessage: (reply: AnalysisReply) => void;
};

scope.onmessage = ({ data: job }) => {
  try {
    scope.postMessage({ type: "started" });
    const measured = job.measurement;
    const calibration = measured
      ? calibrateRequest(parseInput(job.input, job.options.format).requests[measured.requestIndex]!, measured.model, measured.exactTokens)
      : undefined;
    const result = analyze(job.input, { ...job.options, ...(calibration ? { claudeTokenScale: calibration.scale } : {}) });
    scope.postMessage({ type: "success", result, ...(calibration ? { calibration } : {}) });
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
