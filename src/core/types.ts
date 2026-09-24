/**
 * Core data model shared by the parsers, the analyzers, the CLI and the web app.
 *
 * A single API request (Anthropic Messages or OpenAI Chat Completions) is
 * normalized into a `ParsedRequest`: a flat, ordered list of `Segment`s in the
 * provider's own serialization order. Every other analysis (token accounting,
 * prefix diffing, cache simulation, duplicate detection, findings) operates on
 * that normalized list, so the parsers are the only place that know about the
 * two wire formats.
 */

export type Provider = "anthropic" | "openai";

/** The eight categories the treemap and legend color by (dataviz categorical slots 1-8, fixed order). */
export type SegmentCategory =
  | "system"
  | "tools"
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "image"
  | "thinking";

export type CacheTtl = "5m" | "1h";

export interface CacheControl {
  type: "ephemeral";
  ttl: CacheTtl;
}

/**
 * One content block, tool definition, or system block, normalized into a
 * single addressable unit. `text` is the deterministic serialization used
 * for tokenizing and hashing - for a text block it's the text verbatim; for
 * an image it's a placeholder plus a content hash; for a tool definition
 * it's the canonicalized (sorted-key) JSON schema.
 */
export interface Segment {
  /** Stable within one request, e.g. "tools[2]", "system[0]", "messages[3].content[1]". */
  id: string;
  category: SegmentCategory;
  /** Short human label for the table/treemap, e.g. "tool: get_weather" or "message 4 (user) text". */
  label: string;
  /** Dot/bracket path into the original request JSON, for the inspector. */
  path: string;
  /** Deterministic textual content used for tokenizing, hashing, and diffing. */
  text: string;
  /** Original block, for the raw-content inspector view. */
  raw: unknown;
  /** Exact token count under OpenAI's o200k_base encoding. */
  openaiTokens: number;
  /** Estimated token count for Claude models - see tokenize/claude-estimate.ts. Always "≈". */
  claudeTokensEstimate: number;
  /** Calibrated Claude token count from the count_tokens endpoint, if the user supplied a key. */
  claudeTokensCalibrated?: number;
  cacheControl?: CacheControl;
  charLength: number;
}

export interface ParsedRequest {
  provider: Provider;
  /** Position in the input sequence (0-based). */
  index: number;
  model: string | undefined;
  /** The original parsed JSON, kept for raw inspection and re-serialization. */
  raw: unknown;
  /** Segments in the provider's own render/serialization order (tools -> system -> messages for Anthropic). */
  segments: Segment[];
}

export interface ParseWarning {
  requestIndex: number;
  message: string;
}

export interface ParseResult {
  format: Provider;
  /** True when the format was inferred rather than explicitly specified. */
  autoDetected: boolean;
  requests: ParsedRequest[];
  warnings: ParseWarning[];
}

export interface TokenTotals {
  openaiTokens: number;
  claudeTokensEstimate: number;
  claudeTokensCalibrated?: number;
}

export interface CategoryBreakdown extends TokenTotals {
  category: SegmentCategory;
  segmentCount: number;
}

/** One rectangle in the treemap / one row in the segment table, for a single request. */
export interface RequestTokenReport {
  requestIndex: number;
  totals: TokenTotals;
  byCategory: CategoryBreakdown[];
  segments: Segment[];
  contextWindow: number | undefined;
  percentOfContextWindow: number | undefined;
}

export type FindingSeverity = "info" | "warning" | "error";

export type FindingKind =
  | "volatile_prefix"
  | "tools_reordered"
  | "tool_schema_key_order"
  | "breakpoint_before_change"
  | "no_cache_control"
  | "below_minimum_cacheable"
  | "duplicate_content"
  | "lookback_window_exceeded"
  | "ttl_ordering";

export interface Finding {
  kind: FindingKind;
  severity: FindingSeverity;
  /** Request index this finding applies to (the later one, for pairwise findings). */
  requestIndex: number;
  title: string;
  detail: string;
  /** Segment ids implicated, for click-through highlighting. */
  segmentIds: string[];
}

/** Longest common prefix between two consecutive requests, in provider serialization order. */
export interface PrefixMatch {
  fromIndex: number;
  toIndex: number;
  /** Number of whole leading segments that are byte-identical (by normalized text). */
  matchedSegments: number;
  /** Token count (OpenAI exact) covered by the matched segments. */
  matchedOpenaiTokens: number;
  matchedClaudeTokensEstimate: number;
  /** The first segment (in `to`) where the prefix diverges, if any. */
  divergedAt: { fromSegmentId: string | undefined; toSegmentId: string | undefined } | undefined;
  /** Unified-diff-style lines describing the divergent region, for display. */
  diff: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

export interface CacheSimStep {
  requestIndex: number;
  /** Tokens read from cache this request (billed at the read discount). */
  readTokens: number;
  /** Tokens newly written to cache this request, split by TTL. */
  writeTokens5m: number;
  writeTokens1h: number;
  /** Tokens that were neither read nor written (no cache_control covers them, or below minimum). */
  uncachedTokens: number;
  /** Estimated cost in USD for the input side of this request, using the resolved pricing. */
  costUsd: number | undefined;
}

export interface CacheSimulation {
  provider: Provider;
  model: string | undefined;
  actual: CacheSimStep[];
  /** What the simulation would look like with volatile (timestamp/UUID/epoch) content normalized out
   * of the prefix comparison, and - Anthropic only - an additional trailing cache_control breakpoint
   * on every request (the "automatic caching on the growing tail" pattern). */
  optimized: CacheSimStep[];
  totalActualCostUsd: number | undefined;
  totalOptimizedCostUsd: number | undefined;
}

export interface DuplicateGroup {
  /** Representative shingle-set signature (for debugging/tests, not displayed). */
  signature: string;
  /** Segments (across all requests) judged near-duplicates of each other. */
  members: { requestIndex: number; segmentId: string; label: string; tokens: number }[];
  similarity: number;
  estimatedWastedTokens: number;
}

export interface AnalysisOptions {
  /** Explicit format override; omit or pass undefined to auto-detect. */
  format?: Provider | undefined;
  /** Model id to use for context-window and pricing lookups when a request doesn't specify one. */
  model?: string | undefined;
  /** Calibrated Claude token counts, keyed by segment id "reqIndex:segmentId", if the user supplied an API key. */
  calibration?: Map<string, number> | undefined;
}

export interface AnalysisResult {
  parse: ParseResult;
  reports: RequestTokenReport[];
  prefixMatches: PrefixMatch[];
  cacheSimulation: CacheSimulation;
  findings: Finding[];
  duplicates: DuplicateGroup[];
}
