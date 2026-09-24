import type { AnalysisResult, SegmentCategory } from "../core/index.js";
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

export function renderTerminalReport(result: AnalysisResult): string {
  const lines: string[] = [];
  const { parse, reports, prefixMatches, cacheSimulation, findings, duplicates } = result;

  lines.push(bold(`contextscope — ${parse.format} · ${parse.requests.length} request${parse.requests.length === 1 ? "" : "s"}${parse.autoDetected ? " (auto-detected)" : ""}`));
  lines.push("");

  for (const report of reports) {
    lines.push(bold(`Request ${report.requestIndex + 1}`) + dim(`  ≈${fmtTokens(report.totals.claudeTokensEstimate)} Claude tokens · ${fmtTokens(report.totals.openaiTokens)} OpenAI (o200k_base) tokens${report.percentOfContextWindow !== undefined ? ` · ${fmtPct(report.percentOfContextWindow)} of context window` : ""}`));
    for (const cat of report.byCategory) {
      const label = CATEGORY_LABEL[cat.category].padEnd(15);
      const tokens = fmtTokens(cat.claudeTokensEstimate).padStart(8);
      const fraction = report.totals.claudeTokensEstimate > 0 ? cat.claudeTokensEstimate / report.totals.claudeTokensEstimate : 0;
      const colorFn = CATEGORY_COLOR[cat.category];
      lines.push(`  ${colorFn(bar(fraction, 20))} ${label} ${tokens} ≈tok  ${dim(`(${cat.segmentCount} segment${cat.segmentCount === 1 ? "" : "s"})`)}`);
    }
    lines.push("");
  }

  if (prefixMatches.length > 0) {
    lines.push(bold("Prefix match across the sequence"));
    prefixMatches.forEach((match, i) => {
      const total = parse.requests[i]!.segments.length;
      const pct = total > 0 ? match.matchedSegments / total : 0;
      lines.push(`  req ${i + 1} → req ${i + 2}: ${bar(pct, 20)} ${match.matchedSegments}/${parse.requests[i + 1]!.segments.length} segments matched, ≈${fmtTokens(match.matchedClaudeTokensEstimate)} tokens` + (match.divergedAt ? dim(`  diverges at ${match.divergedAt.toSegmentId ?? "(end)"}`) : dim("  (identical)")));
    });
    lines.push("");
  }

  lines.push(bold(`Cache simulation (${cacheSimulation.provider})`));
  lines.push(dim("  request     read      write(5m)  write(1h)  uncached    cost"));
  cacheSimulation.actual.forEach((step, i) => {
    lines.push(
      `  req ${String(i + 1).padEnd(6)} ${fmtTokens(step.readTokens).padStart(8)}  ${fmtTokens(step.writeTokens5m).padStart(8)}  ${fmtTokens(step.writeTokens1h).padStart(8)}  ${fmtTokens(step.uncachedTokens).padStart(9)}  ${fmtUsd(step.costUsd).padStart(9)}`,
    );
  });
  lines.push(dim(`  total actual cost:    ${fmtUsd(cacheSimulation.totalActualCostUsd)}`));
  const optimizedNote =
    cacheSimulation.provider === "anthropic"
      ? "with volatile content normalized out + an automatic breakpoint on every request's tail"
      : "with volatile content normalized out of the auto-cached prefix";
  lines.push(dim(`  total optimized cost: ${fmtUsd(cacheSimulation.totalOptimizedCostUsd)}  (${optimizedNote})`));
  if (cacheSimulation.totalActualCostUsd !== undefined && cacheSimulation.totalOptimizedCostUsd !== undefined) {
    const savings = cacheSimulation.totalActualCostUsd - cacheSimulation.totalOptimizedCostUsd;
    if (savings > 1e-9) {
      lines.push(green(`  → applying the fixes below (plus that trailing breakpoint) would save ${fmtUsd(savings)} (${((savings / cacheSimulation.totalActualCostUsd) * 100).toFixed(0)}%) on this sequence`));
      lines.push(dim(`    ≈ ${fmtUsdRounded(savings * 1000)} per 1,000 sessions shaped like this one`));
    }
  }
  lines.push("");

  if (findings.length > 0) {
    lines.push(bold(`Findings (${findings.length})`));
    for (const finding of findings) {
      const color = severityColor(finding.severity);
      lines.push(`  ${color(`[${finding.severity}]`)} ${bold(finding.title)} ${dim(`(request ${finding.requestIndex + 1})`)}`);
      lines.push(...wrapIndented(finding.detail, 6));
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

  return lines.join("\n");
}
