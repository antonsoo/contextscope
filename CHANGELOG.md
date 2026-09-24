# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-09-24

Initial release.

### Added

- Core library (`src/core`): Anthropic Messages and OpenAI Chat Completions
  parsers, exact OpenAI token counts (o200k_base), estimated Claude token
  counts, longest-common-prefix + diff between consecutive requests, prompt
  cache simulation for both providers (actual and optimized scenarios),
  rule-based findings, and shingling-based duplicate-content detection.
- Node CLI (`contextscope analyze`) with a terminal report and an optional
  self-contained HTML report.
- Web app (Vite + TypeScript, no framework): drag/drop/paste/example intake,
  a squarified token-usage treemap, a segment inspector, a prefix-diff
  viewer, a cache-simulation panel, a findings list, a duplicates list, and
  optional in-browser calibration against Anthropic's `count_tokens`
  endpoint. Dark and light themes, responsive to 375px.
- Four synthetic built-in example sessions (Anthropic cache-busting session,
  its fixed counterpart, a duplicate-content session, and an OpenAI
  tools-reordered session).
