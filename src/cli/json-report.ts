import type { AnalysisResult, Segment } from "../core/index.js";

/** A segment as `--json` writes it: where it is, what it is and what it costs, without its content. */
function summarize(segment: Segment): Omit<Segment, "text" | "raw"> {
  return {
    id: segment.id,
    category: segment.category,
    label: segment.label,
    path: segment.path,
    openaiTokens: segment.openaiTokens,
    claudeTokensEstimate: segment.claudeTokensEstimate,
    ...(segment.cacheControl ? { cacheControl: segment.cacheControl } : {}),
    charLength: segment.charLength,
  };
}

/**
 * The analysis as JSON: every count, finding and cache step, and none of the request content it
 * was computed from. The in-memory result holds each request body, each segment's text and each
 * segment's original block, so serializing it whole wrote the input back out about five times
 * over (a 46 MB session became a 252 MB file and took 1.3 GB to build). A segment's `path` says
 * where its content is in its request (a message whose content is a plain string counts as one
 * block, `content[0]`).
 */
export function toJsonReport(result: AnalysisResult): string {
  const report = {
    ...result,
    parse: {
      ...result.parse,
      requests: result.parse.requests.map((request) => ({
        provider: request.provider,
        index: request.index,
        model: request.model,
        segments: request.segments.map(summarize),
      })),
    },
    reports: result.reports.map((r) => ({ ...r, segments: r.segments.map(summarize) })),
  };
  return JSON.stringify(report, null, 2);
}
