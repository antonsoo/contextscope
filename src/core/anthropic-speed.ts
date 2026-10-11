import { canonicalJson, isRecord } from "./json-utils.js";
import { normalizeModelId } from "./pricing.js";
import type { ParsedRequest, ResolvedModel } from "./types.js";

// Claude API rules checked 2026-10-10. Request bodies cannot prove the server's
// actual speed or historical pricing; these are current documented scenarios.
// https://platform.claude.com/docs/en/build-with-claude/fast-mode
const FAST_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);

export function anthropicSpeed(request: ParsedRequest): "standard" | "fast" | "unrecognized" {
  const value = isRecord(request.raw) ? request.raw.speed : undefined;
  if (value === undefined || value === "standard") return "standard";
  if (value !== "fast") return "unrecognized";
  // Opus 4.6 currently accepts fast requests but silently uses standard speed.
  return request.model && normalizeModelId(request.model) === "claude-opus-4-6" ? "standard" : "fast";
}

export function anthropicSpeedKey(request: ParsedRequest): string {
  const speed = anthropicSpeed(request);
  return speed === "unrecognized" ? canonicalJson(isRecord(request.raw) ? request.raw.speed : null) : speed;
}

export function anthropicSpeedMultiplier(request: ParsedRequest, pricedModel: ResolvedModel): number | undefined {
  const speed = anthropicSpeed(request);
  if (speed === "standard") return 1;
  // Never borrow the fallback model's standard price for an unknown fast rate.
  return speed === "fast" && !pricedModel.unrecognized && FAST_MODELS.has(pricedModel.id) ? 2 : undefined;
}
