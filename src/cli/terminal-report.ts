import type { AnalysisResult, CalibrationResult, RequestTokenReport, SegmentCategory } from "../core/index.js";
import { describeRequestIndices, groupFindings } from "../core/index.js";
import { bar, blue, bold, cyan, dim, fmtPct, fmtTokens, fmtUsd, fmtUsdRounded, green, magenta, red, severityColor, wrapIndented, yellow } from "./ansi.js";

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
    model.source === "option" ? "set with --model" : model.source === "request" ? "from the requests" : model.unrecognized ? `"${model.unrecognized}" is not in the pricing table` : "default; no model in the requests";
  lines.push(bold(`contextscope — ${parse.format} · ${n} request${n === 1 ? "" : "s"}${parse.autoDetected ? " (auto-detected)" : ""}`));
  lines.push(dim(`priced as ${model.displayName} (${modelNote})${parse.envelope ? ` · requests read from each record's "${parse.envelope}" field` : ""}`));
  if (options.calibration) {
    const c = options.calibration;
    const error = (c.estimatedTokens - c.exactTokens) / c.exactTokens;
    lines.push(
      green(
        `calibrated: request ${c.requestIndex + 1} is ${fmtTokens(c.exactTokens)} tokens by count_tokens (${c.model}); the estimate was ≈${fmtTokens(c.estimatedTokens)} (${error >= 0 ? "+" : ""}${(error * 100).toFixed(1)}%). Claude figures below are scaled ×${c.scale.toFixed(3)}.`,
      ),
    );
  }
  lines.push("");

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
  lines.push(dim(`  total actual cost:    ${fmtUsd(cacheSimulation.totalActualCostUsd)}`));
  const optimizedNote =
    cacheSimulation.provider === "anthropic"
      ? "findings fixed, plus a breakpoint on each request's tail"
      : "findings fixed";
  lines.push(dim(`  total optimized cost: ${fmtUsd(cacheSimulation.totalOptimizedCostUsd)}  (${optimizedNote})`));
  if (cacheSimulation.totalActualCostUsd !== undefined && cacheSimulation.totalOptimizedCostUsd !== undefined) {
    const savings = cacheSimulation.totalActualCostUsd - cacheSimulation.totalOptimizedCostUsd;
    if (savings > 1e-9) {
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
      lines.push(`  ${color(`[${group.severity}]`)} ${bold(group.title)} ${dim(`(${where}${times})`)}`);
      lines.push(...wrapIndented(group.detail, 6));
    }
    lines.push("");
  } else {
    lines.push(green("No findings — this sequence caches cleanly."));
    lines.push("");
  }

  if (duplicates.length > 0) {
    lines.push(bold(`Duplicate content (${duplicates.length} group${duplicates.length === 1 ? "" : "s"})`));
    for (const group of duplicates) {
      lines.push(`  ${group.members.length}× "${group.members[0]!.label}" — ≈${fmtTokens(group.estimatedWastedTokens)} wasted tokens`);
    }
    lines.push("");
  }

  if (parse.warnings.length > 0) {
    lines.push(yellow(`${parse.warnings.length} parse warning${parse.warnings.length === 1 ? "" : "s"}:`));
    for (const w of parse.warnings) lines.push(dim(`  ${w.message}`));
  }

  return lines.join("\n").replace(/\n+$/, "");
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
  const { parse, prefixMatches } = result;
  const out = [bold("Prefix match across the sequence")];
  if (verbose) {
    prefixMatches.forEach((match, i) => {
      const total = parse.requests[i + 1]!.segments.length;
      const pct = total > 0 ? match.matchedSegments / total : 0;
      out.push(
        `  req ${i + 1} → req ${i + 2}: ${bar(pct, 20)} ${match.matchedSegments}/${total} segments matched, ≈${fmtTokens(match.matchedClaudeTokensEstimate)} tokens` +
          (match.divergedAt ? dim(`  diverges at ${match.divergedAt.toSegmentId ?? "(end)"}`) : dim("  (identical)")),
      );
    });
    return out;
  }

  const breaks = new Map<string, number[]>();
  prefixMatches.forEach((match, i) => {
    const previous = parse.requests[i]!;
    if (match.matchedSegments >= previous.segments.length) return;
    const segment = previous.segments[match.matchedSegments]!;
    const key = segment.label;
    breaks.set(key, [...(breaks.get(key) ?? []), i]);
  });
  const total = prefixMatches.length;
  const broken = [...breaks.values()].reduce((sum, pairs) => sum + pairs.length, 0);
  if (broken === 0) {
    out.push(green(`  all ${total} consecutive pair${total === 1 ? "" : "s"} only append to the previous request`));
    return out;
  }
  for (const [label, pairs] of breaks) {
    const first = pairs[0]!;
    const last = pairs[pairs.length - 1]!;
    const span = pairs.length === 1 ? `req ${first + 1} → ${first + 2}` : `req ${first + 1} → ${first + 2} … req ${last + 1} → ${last + 2}`;
    out.push(`  ${red(`${pairs.length} of ${total}`)} pair${pairs.length === 1 ? "" : "s"} rewrite content already sent, starting at ${bold(`"${label}"`)} ${dim(`(${span})`)}`);
  }
  out.push(dim(`  ${total - broken} of ${total} only append to the previous request`));
  return out;
}
