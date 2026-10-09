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
  /**
   * Set when the block has no marker of its own: the request carries a top-level
   * `cache_control` (Anthropic's automatic caching), which puts a breakpoint on the last
   * cacheable block of the request, and this is that block.
   */
  automatic?: true;
}

/**
 * One content block, tool definition, or system block, normalized into a
 * single addressable unit. `text` is the analyzed content used for token counts
 * and duplicate detection. Prompt structure is kept separately for prefix
 * comparison; a tool result's destination or a message boundary can change
 * while its analyzed text remains identical.
 */
export interface Segment {
  /** Stable within one request, e.g. "tools[2]", "system[0]", "messages[3].content[1]". */
  id: string;
  category: SegmentCategory;
  /** Short human label for the table/treemap, e.g. "tool: get_weather" or "message 4 (user) text". */
  label: string;
  /** Dot/bracket path into the original request JSON, for the inspector. */
  path: string;
  /** Analyzed textual content used for tokenizing and duplicate detection. */
  text: string;
  /** Full prompt block and its message header/boundary, separate from counted text.
   * Optional for callers constructing segments directly; parsed segments include it. */
  prefix?: { content: unknown; context?: unknown };
  /** Original block, for the raw-content inspector view. */
  raw: unknown;
  /** Exact token count under OpenAI's o200k_base encoding. */
  openaiTokens: number;
  /** Estimated token count for Claude models - see tokenize-claude.ts. Always "≈", even when scaled by calibration. */
  claudeTokensEstimate: number;
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
  /** Original record position and, for JSONL, its physical line before any skips. */
  source?: { recordIndex: number; line?: number; envelope?: string };
  /** Response usage paired with this request in the same source record; never inferred. */
  reportedUsage?: ReportedUsage;
  /** Segments in the provider's own render/serialization order (tools -> system -> messages for Anthropic). */
  segments: Segment[];
}

export interface ParseWarning {
  requestIndex?: number;
  sourceLine?: number;
  message: string;
}

export interface ParseResult {
  format: Provider;
  /** False when malformed lines, non-request records or a mismatched override leave gaps. */
  complete: boolean;
  /** Nonblank source records, including malformed JSONL lines. */
  sourceRecords: number;
  /** Malformed JSONL lines and records with no analyzable segments. */
  skippedRecords: number;
  /** True when the format was inferred rather than explicitly specified. */
  autoDetected: boolean;
  /**
   * Set when the request bodies were unwrapped from a record field: `params`
   * (Anthropic Message Batches), `body` (OpenAI Batch API), or `request` /
   * `request_body` (common proxy and gateway log shapes).
   */
  envelope?: string | undefined;
  requests: ParsedRequest[];
  warnings: ParseWarning[];
}

export interface TokenTotals {
  openaiTokens: number;
  claudeTokensEstimate: number;
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
  | "ttl_ordering"
  | "missing_tail_breakpoint"
  | "model_switch";

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

/**
 * How a request relates to the earlier request it is compared with (see threads.ts):
 * the next turn of the same conversation, the same conversation with its history
 * edited, or a new conversation on a setup (tools and system prompt) sent before.
 */
export type PrefixRelation = "continues" | "rewrites" | "new_conversation";

/**
 * Longest common prefix between a request and the earlier request it is compared
 * with, in provider serialization order. In a file that holds one conversation
 * that is the request before it; in general it is the request it continues.
 */
export interface PrefixMatch {
  fromIndex: number;
  toIndex: number;
  relation: PrefixRelation;
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

/** Where the model used for pricing came from. */
export type ModelSource = "option" | "request" | "default";

export interface ResolvedModel {
  /** Canonical id of the pricing entry actually used. */
  id: string;
  displayName: string;
  source: ModelSource;
  /** The id as given (by option or request) when it had no pricing entry and the default was used instead. */
  unrecognized?: string;
}

export interface CacheSimulation {
  provider: Provider;
  /** Canonical id of the model the simulation was priced with (see AnalysisResult.model for its source). */
  model: string;
  /** Simulation of requests as captured; these are not provider-reported measurements. */
  actual: CacheSimStep[];
  /** The same sequence with the findings fixed: volatile values (timestamps, UUIDs, epochs)
   * normalized out of the prefix comparison, JSON keys and the tool list in a deterministic order,
   * and - Anthropic only - an additional trailing cache_control breakpoint on every request (the
   * "automatic caching on the growing tail" pattern). */
  optimized: CacheSimStep[];
  totalActualCostUsd: number | undefined;
  totalOptimizedCostUsd: number | undefined;
}

export interface UsageCounter {
  /** Path in the source record, including its response/usage envelope. */
  path: string;
  status: "reported" | "missing" | "invalid";
  /** Only valid, nonnegative safe integers are retained. No arbitrary response content. */
  value?: number;
}

export interface ReportedUsage {
  sources: string[];
  schema: "openai-chat" | "openai-responses" | "anthropic" | "unknown";
  /** Valid does not mean complete: each absent counter stays null. Invalid records are excluded. */
  status: "valid" | "unavailable" | "invalid";
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  counters: UsageCounter[];
  issues: string[];
  /** Reasons a valid capture still cannot support a particular normalized measurement. */
  notes: string[];
}

export type UsageReadOutcome = "both_zero" | "both_positive" | "simulated_hit_reported_zero" | "reported_hit_simulated_zero" | "unavailable";

export interface UsageComparisonRow {
  requestIndex: number;
  estimatedInputTokens: number;
  simulatedReadTokens: number;
  reportedInputTokens: number | null;
  reportedReadTokens: number | null;
  reportedWriteTokens: number | null;
  /** Estimate/simulation minus reported, over this request only. */
  inputDeltaTokens: number | null;
  readDeltaTokens: number | null;
  readOutcome: UsageReadOutcome;
}

export interface UsageMetricComparison {
  /** Both sides of this comparison contain exactly these requests. */
  requestIndices: number[];
  /** Null when there is no coverage or the aggregate exceeds the safe integer range. */
  reportedTokens: number | null;
  simulatedTokens: number | null;
  deltaTokens: number | null;
}

export interface UsageComparison {
  /** Only requests with analyzable segments; skipped source records are tracked by ParseResult. */
  rows: UsageComparisonRow[];
  capturedRequests: number;
  invalidRequestIndices: number[];
  input: UsageMetricComparison;
  cacheRead: UsageMetricComparison;
  readOutcomes: Record<UsageReadOutcome, number>;
  issues: string[];
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
  /** Model id for context-window and pricing lookups. Overrides the model named in the requests. */
  model?: string | undefined;
  /**
   * Multiplier applied to every Claude token estimate before analysis - the
   * ratio of an exact `count_tokens` result to the heuristic estimate for the
   * same request (see calibrate.ts). Omit (or pass 1) for raw estimates.
   */
  claudeTokenScale?: number | undefined;
}

export interface AnalysisResult {
  parse: ParseResult;
  /** The model the whole sequence was priced with, and where that choice came from. */
  model: ResolvedModel;
  /** The claudeTokenScale actually applied (1 when uncalibrated). */
  claudeTokenScale: number;
  reports: RequestTokenReport[];
  /** One entry for each request that has an earlier request to be compared with, in request order. */
  prefixMatches: PrefixMatch[];
  /** The conversations found in the input: for each request, the number of its conversation, counted from 0. */
  conversations: { count: number; byRequest: number[] };
  cacheSimulation: CacheSimulation;
  usageComparison: UsageComparison;
  findings: Finding[];
  duplicates: DuplicateGroup[];
}
