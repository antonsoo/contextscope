import type { AnalysisOptions, AnalysisResult } from "@core/types.js";
import type { CalibrationResult } from "@core/calibrate.js";

export interface Measurement {
  requestIndex: number;
  model: string;
  exactTokens: number;
}

export interface AnalysisJob {
  input: string;
  options: AnalysisOptions;
  measurement?: Measurement;
}

export type AnalysisReply =
  | { type: "started" }
  | { type: "success"; result: AnalysisResult; calibration?: CalibrationResult }
  | { type: "error"; message: string };
