import type { AnalysisResult, CalibrationResult, PrefixMatch, RequestTokenReport, SegmentCategory } from "../core/index.js";
import { describeRequestIndices, groupFindings } from "../core/index.js";
import { USAGE_OUTCOME_LABEL, usageDelta, usageNumber, usageSourceLabel } from "../core/usage-labels.js";
import { bar, blue, bold, cyan, dim, fmtPct, fmtTokens, fmtUsd, fmtUsdRounded, green, magenta, red, severityColor, visible, wrapIndented, yellow } from "./ansi.js";

const CATEGORY_LABEL: Record<SegmentCategory, string> = {
  system: "system",
  tools: "tools",
  user: "user text",
  assistant: "assistant text",
  tool_call: "tool calls",
  tool_result: "tool results",
  image: "images",
  thinking: "thinking",
};

const CATEGORY_COLOR: Record<SegmentCategory, (s: string) => string> = {
  system: blue,
  tools: yellow,
  user: green,
  assistant: yellow,
  tool_call: magenta,
  tool_result: (s) => s,
  image: cyan,
  thinking: red,
};

// Above this many requests the cache table is abbreviated to its head and tail unless --verbose.
const CACHE_TABLE_FULL_ROWS = 30;
const CACHE_TABLE_HEAD = 10;
const CACHE_TABLE_TAIL = 5;

export interface TerminalReportOptions {
  /** Every request's breakdown, every prefix pair, and every cache row. */
  verbose?: boolean;
  calibration?: CalibrationResult | undefined;
}

export function renderTerminalReport(result: AnalysisResult, options: TerminalReportOptions = {}): string {
  const lines: string[] = [];
  const { parse, reports, prefixMatches, cacheSimulation, findings, duplicates, model } = result;
  const verbose = options.verbose === true;
  const n = parse.requests.length;

  const modelNote =
    model.source === "option" ? "set with --model" : model.source === "request" ? "from the requests" : model.unrecognized ? `"${visible(model.unrecognized)}" is not in the pricing table` : "default; no model in the requests";
  const conversationNote = result.conversations.count > 1 ? ` in ${result.conversations.count} conversations` : "";
  lines.push(bold(`contextscope — ${parse.format} · ${n} request${n === 1 ? "" : "s"}${conversationNote}${parse.autoDetected ? " (auto-detected)" : ""}`));
  lines.push(dim(`priced as ${model.displayName} (${modelNote})${parse.envelope ? ` · requests read from each record's "${visible(parse.envelope)}" field` : ""}`));
  if (!parse.complete) lines.push(yellow(`Incomplete input: ${parse.skippedRecords} of ${parse.sourceRecords} source records skipped or not analyzable; check parse warnings. Counts and simulations cover the retained content only.`));
  if (options.calibration) {
    const c = options.calibration;
    const error = (c.estimatedTokens - c.exactTokens) / c.exactTokens;
    lines.push(
      green(
        `calibrated: request ${c.requestIndex + 1} is ${fmtTokens(c.exactTokens)} tokens by count_tokens (${visible(c.model)}); the estimate was ≈${fmtTokens(c.estimatedTokens)} (${error >= 0 ? "+" : ""}${(error * 100).toFixed(1)}%). Claude figures below are scaled ×${c.scale.toFixed(3)}.`,
      ),
    );
  }
  lines.push("");

  lines.push(...reportedUsageSection(result, verbose), "");

  if (verbose) {
    for (const report of reports) lines.push(...breakdown(`Request ${report.requestIndex + 1}`, report), "");
  } else if (reports.length > 0) {
    const largest = reports.reduce((best, r) => (r.totals.claudeTokensEstimate > best.totals.claudeTokensEstimate ? r : best));
    const title = reports.length === 1 ? "Request 1" : `Largest request: ${largest.requestIndex + 1} of ${reports.length}`;
    lines.push(...breakdown(title, largest));
    if (reports.length > 1) lines.push(dim("  (every request's breakdown: --verbose)"));
    lines.push("");
  }

  if (prefixMatches.length > 0) lines.push(...prefixSection(result, verbose), "");

  lines.push(bold(`Cache simulation (${cacheSimulation.provider}, ${model.displayName})`));
  lines.push(dim("  request     read      write(5m)  write(1h)  uncached    cost"));
  const rows = cacheSimulation.actual.map(
    (step, i) =>
      `  req ${String(i + 1).padEnd(6)} ${fmtTokens(step.readTokens).padStart(8)}  ${fmtTokens(step.writeTokens5m).padStart(8)}  ${fmtTokens(step.writeTokens1h).padStart(8)}  ${fmtTokens(step.uncachedTokens).padStart(9)}  ${fmtUsd(step.costUsd).padStart(9)}`,
  );
  if (verbose || rows.length <= CACHE_TABLE_FULL_ROWS) {
    lines.push(...rows);
  } else {
    const hidden = rows.length - CACHE_TABLE_HEAD - CACHE_TABLE_TAIL;
    lines.push(...rows.slice(0, CACHE_TABLE_HEAD), dim(`  ⋯ ${hidden} more requests (--verbose) ⋯`), ...rows.slice(-CACHE_TABLE_TAIL));
  }
  lines.push(dim(`  total simulated cost: ${fmtUsd(cacheSimulation.totalActualCostUsd)}`));
  const optimizedNote =
    cacheSimulation.provider === "anthropic"
      ? "findings fixed, plus a breakpoint on each request's tail"
      : "findings fixed";
  lines.push(dim(`  total optimized cost: ${fmtUsd(cacheSimulation.totalOptimizedCostUsd)}  (${optimizedNote})`));
  if (cacheSimulation.totalActualCostUsd !== undefined && cacheSimulation.totalOptimizedCostUsd !== undefined) {
    const savings = cacheSimulation.totalActualCostUsd - cacheSimulation.totalOptimizedCostUsd;
    // Below half of the last digit shown, the line would read "would save $0.0000 (0%)".
    if (savings >= 0.00005) {
      const how = cacheSimulation.provider === "anthropic" ? "applying the fixes below (plus that trailing breakpoint)" : "applying the fixes below";
      lines.push(green(`  → ${how} would save ${fmtUsd(savings)} (${((savings / cacheSimulation.totalActualCostUsd) * 100).toFixed(0)}%) on this sequence`));
      lines.push(dim(`    ≈ ${fmtUsdRounded(savings * 1000)} per 1,000 sessions shaped like this one`));
    }
  }
  lines.push("");

  const groups = groupFindings(findings);
  if (groups.length > 0) {
    const recurring = findings.length > groups.length ? dim(` from ${findings.length} findings across the sequence`) : "";
    lines.push(bold(`Findings (${groups.length} issue${groups.length === 1 ? "" : "s"})`) + recurring);
    for (const group of groups) {
      const color = severityColor(group.severity);
      const where = describeRequestIndices(group.requestIndices);
      const times = group.requestIndices.length > 1 ? `, ${group.requestIndices.length}×` : "";
      lines.push(`  ${color(`[${group.severity}]`)} ${bold(visible(group.title))} ${dim(`(${where}${times})`)}`);
      lines.push(...wrapIndented(visible(group.detail), 6));
    }
    lines.push("");
  } else {
    lines.push(dim("No supported cache or duplicate-content issues detected. This does not verify live cache hits."));
    lines.push("");
  }

  if (duplicates.length > 0) {
    lines.push(bold(`Duplicate content (${duplicates.length} group${duplicates.length === 1 ? "" : "s"})`));
    for (const group of duplicates) {
      lines.push(`  ${group.members.length}× "${visible(group.members[0]!.label)}" — ≈${fmtTokens(group.estimatedWastedTokens)} wasted tokens`);
    }
    lines.push("");
  }

  if (parse.warnings.length > 0) {
    lines.push(yellow(`${parse.warnings.length} parse warning${parse.warnings.length === 1 ? "" : "s"}:`));
    for (const w of parse.warnings) lines.push(dim(`  ${visible(w.message)}`));
  }

  return lines.join("\n").replace(/\n+$/, "");
}

function reportedUsageSection(result: AnalysisResult, verbose: boolean): string[] {
  const review = result.usageComparison;
  if (review.capturedRequests === 0) return [dim("No paired response usage. Cache reads and costs below are simulations.")];
  const out = [bold("Reported usage vs simulation"), dim("  Each total compares the same covered requests. Delta = estimate/simulation - reported.")];
  out.push(dim("  metric            coverage       reported    estimated/sim.         delta"));
  for (const [label, metric] of [["input tokens", review.input], ["cache reads", review.cacheRead]] as const) {
    out.push(`  ${label.padEnd(15)} ${`${metric.requestIndices.length}/${review.rows.length}`.padStart(8)} ${usageNumber(metric.reportedTokens).padStart(14)} ${usageNumber(metric.simulatedTokens).padStart(17)} ${usageDelta(metric.deltaTokens).padStart(13)}`);
  }
  const misses = review.readOutcomes.simulated_hit_reported_zero;
  const unexpected = review.readOutcomes.reported_hit_simulated_zero;
  out.push(`  ${misses} simulated hit / reported zero; ${unexpected} reported hit / simulated zero.`);
  out.push(dim(`  ${review.readOutcomes.unavailable} read count unavailable; ${review.invalidRequestIndices.length} invalid usage record(s) excluded. n/a is not zero.`));
  out.push(dim("  Counts do not establish a cause: cache routing, eviction, timing and hidden context are not captured."));
  out.push(dim("  request / source          reported read    simulated read  comparison"));
  const rows = verbose || review.rows.length <= CACHE_TABLE_FULL_ROWS ? review.rows : [...review.rows.slice(0, CACHE_TABLE_HEAD), ...review.rows.slice(-CACHE_TABLE_TAIL)];
  for (const row of rows) {
    const request = result.parse.requests[row.requestIndex]!;
    const source = usageSourceLabel(request);
    out.push(`  ${`req ${row.requestIndex + 1} / ${source}`.padEnd(25)} ${usageNumber(row.reportedReadTokens).padStart(12)} ${fmtTokens(row.simulatedReadTokens).padStart(17)}  ${USAGE_OUTCOME_LABEL[row.readOutcome]}`);
    const usage = request.reportedUsage;
    if (verbose && usage) {
      out.push(dim(`    ${usage.schema} · ${usage.status}; total input ${usageNumber(usage.inputTokens)}, cache writes ${usageNumber(usage.cacheWriteTokens)}, output ${usageNumber(usage.outputTokens)}`));
      for (const counter of usage.counters) out.push(dim(`    ${counter.path} = ${counter.status === "reported" ? fmtTokens(counter.value!) : counter.status}`));
      for (const issue of usage.issues) out.push(yellow(`    ${issue}`));
      for (const note of usage.notes) out.push(dim(`    ${note}`));
    }
  }
  if (rows.length < review.rows.length) out.push(dim(`  ${review.rows.length - rows.length} rows omitted. --verbose shows every row and source counter; --json and --html include all rows.`));
  else if (!verbose) out.push(dim("  --verbose shows the original counter paths; --json and --html retain all evidence."));
  if (!verbose) {
    for (const index of review.invalidRequestIndices.slice(0, 5)) out.push(yellow(`  req ${index + 1}: ${result.parse.requests[index]!.reportedUsage!.issues.join(" ")}`));
    if (review.invalidRequestIndices.length > 5) out.push(yellow(`  ${review.invalidRequestIndices.length - 5} more invalid usage records; inspect the full export.`));
  }
  for (const issue of review.issues) out.push(yellow(`  ${issue}`));
  return out;
}

function breakdown(title: string, report: RequestTokenReport): string[] {
  const out = [
    bold(title) +
      dim(
        `  ≈${fmtTokens(report.totals.claudeTokensEstimate)} Claude tokens · ${fmtTokens(report.totals.openaiTokens)} OpenAI (o200k_base) tokens${report.percentOfContextWindow !== undefined ? ` · ${fmtPct(report.percentOfContextWindow)} of context window` : ""}`,
      ),
  ];
  for (const cat of report.byCategory) {
    const label = CATEGORY_LABEL[cat.category].padEnd(15);
    const tokens = fmtTokens(cat.claudeTokensEstimate).padStart(8);
    const fraction = report.totals.claudeTokensEstimate > 0 ? cat.claudeTokensEstimate / report.totals.claudeTokensEstimate : 0;
    out.push(`  ${CATEGORY_COLOR[cat.category](bar(fraction, 20))} ${label} ${tokens} ≈tok  ${dim(`(${cat.segmentCount} segment${cat.segmentCount === 1 ? "" : "s"})`)}`);
  }
  return out;
}

/**
 * A pair is healthy when the later request only appends to the earlier one: everything the earlier
 * request sent is still there, byte for byte. Otherwise it "breaks" at the first segment that
 * changed. Default output lists the breaks grouped by where they happen; --verbose lists every pair.
 */
function prefixSection(result: AnalysisResult, verbose: boolean): string[] {
  const { parse, prefixMatches, conversations } = result;
  const out = [bold("Prefix match across the sequence")];
  if (conversations.count > 1) {
    out.push(dim(`  ${conversations.count} conversations in this file; each request is compared with the request it continues`));
  }
  if (verbose) {
    for (const match of prefixMatches) {
      const total = parse.requests[match.toIndex]!.segments.length;
      const pct = total > 0 ? match.matchedSegments / total : 0;
      out.push(
        `  req ${match.fromIndex + 1} → req ${match.toIndex + 1}: ${bar(pct, 20)} ${match.matchedSegments}/${total} segments matched, ≈${fmtTokens(match.matchedClaudeTokensEstimate)} tokens` +
          (match.relation === "new_conversation"
            ? dim(`  new conversation${match.divergedAt?.fromSegmentId ? `, setup differs at ${visible(match.divergedAt.fromSegmentId)}` : ""}`)
            : match.divergedAt
              ? dim(`  diverges at ${visible(match.divergedAt.toSegmentId ?? "(end)")}`)
              : dim("  (identical)")),
      );
    }
    return out;
  }

  // A pair breaks when something the earlier request sent is not there any more, byte for byte.
  // For a new conversation that means its setup: the rest of the other conversation was never
  // its to re-send.
  const breaks = new Map<string, PrefixMatch[]>();
  let starts = 0;
  let brokenStarts = 0;
  for (const match of prefixMatches) {
    const previous = parse.requests[match.fromIndex]!;
    const startsConversation = match.relation === "new_conversation";
    if (startsConversation) starts++;
    const sent = startsConversation ? setupLength(previous.segments) : previous.segments.length;
    if (match.matchedSegments >= sent) continue;
    if (startsConversation) brokenStarts++;
    const label = previous.segments[match.matchedSegments]!.label;
    breaks.set(label, [...(breaks.get(label) ?? []), match]);
  }
  const total = prefixMatches.length;
  const broken = [...breaks.values()].reduce((sum, pairs) => sum + pairs.length, 0);
  const followUps = total - starts;
  const startsNote =
    starts === 0 ? [] : [dim(`  ${starts} request${starts === 1 ? " starts a new conversation" : "s start a new conversation"} on a setup already sent${brokenStarts > 0 ? ` (${brokenStarts} with a changed setup, above)` : ""}`)];
  if (broken === 0) {
    if (starts === 0) out.push(green(`  all ${total} consecutive pair${total === 1 ? "" : "s"} only append to the previous request`));
    else if (followUps > 0) out.push(green(`  all ${followUps} follow-up request${followUps === 1 ? "" : "s"} only append to the request they continue`));
    out.push(...startsNote);
    return out;
  }
  const pair = (match: PrefixMatch): string => `req ${match.fromIndex + 1} → ${match.toIndex + 1}`;
  for (const [label, pairs] of breaks) {
    const span = pairs.length === 1 ? pair(pairs[0]!) : `${pair(pairs[0]!)} … ${pair(pairs[pairs.length - 1]!)}`;
    out.push(`  ${red(`${pairs.length} of ${total}`)} pair${pairs.length === 1 ? "" : "s"} rewrite content already sent, starting at ${bold(`"${visible(label)}"`)} ${dim(`(${span})`)}`);
  }
  if (starts === 0) out.push(dim(`  ${total - broken} of ${total} only append to the previous request`));
  else {
    if (followUps > 0) out.push(dim(`  ${followUps - (broken - brokenStarts)} of ${followUps} follow-up request${followUps === 1 ? "" : "s"} only append to the request they continue`));
    out.push(...startsNote);
  }
  return out;
}

/** The leading tool definitions and system blocks: what a request sends before its conversation. */
function setupLength(segments: { category: string }[]): number {
  let n = 0;
  while (n < segments.length && (segments[n]!.category === "tools" || segments[n]!.category === "system")) n++;
  return n;
}
