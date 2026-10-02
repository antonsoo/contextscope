# Changelog

All notable changes to this project are documented in this file.

## [0.3.0] - 2026-10-01

### Fixed

- A log that holds more than one conversation was analyzed as if it were
  one: every request was compared with the line before it. A capture of an
  agent with a small request on another model after every second turn
  turned a session that caches cleanly ($0.4570, no findings) into $1.8699
  and 34 findings, "Model changed mid-conversation" on 23 requests among
  them, none of them real. The same capture now reads $0.4576 (the session
  plus twelve 27-token requests) with no findings. Each request is paired
  with the request it continues: the one whose messages it starts with;
  failing that, a recent one most of whose messages it re-sends (a history
  that was edited); failing that, the earlier request sharing the most of
  its tools and system prompt (a new conversation of the same application).
  In a file that is one conversation the pairs, and every number and
  finding, are what they were: the four bundled examples give identical
  terminal and HTML output, and identical JSON apart from the new fields.
- The cache simulation only let a request read what the request before it
  had cached. Both providers key their caches by content: a prefix cached
  three requests ago, or by another conversation of the same application,
  is read again. Both simulations now work that way, per model.
- Repeated content was looked for in the last request of the file, which in
  a mixed log is whichever conversation ended last. It is looked for in the
  last request of each conversation, and content repeated identically by
  many conversations is reported once.
- "would save $0.0000 (0%)" was printed for a difference below the last
  digit shown.

### Added

- `result.conversations` (how many, and which one each request belongs to),
  and `relation` on each prefix match: `continues`, `rewrites` or
  `new_conversation`. The terminal report says how many conversations a
  file holds and counts conversation starts apart from follow-ups; the web
  app labels them, and opens a file of several conversations on its largest
  request.
- `threadRequests()` is exported for callers that want the pairing alone.

### Changed

- `result.prefixMatches` has one entry per request that has an earlier
  request to be compared with, which is no longer always every request but
  the first: look a request's match up by `toIndex`, not by position.
- Findings that compare two requests name the two they compared ("between
  requests 2 and 4").

## [0.2.2] - 2026-10-01

### Changed

- `--json` writes the analysis and not the requests it came from. The file
  used to be the in-memory result serialized whole, which holds each request
  body, each segment's text and each segment's original block: a 46 MB
  session log produced a 252 MB JSON file and needed 1.3 GB of memory to
  build it, and a log a few times larger could not be written at all. Segments
  now carry their id, label, path, character length and token counts; the
  same log gives a 17 MB file in 430 MB. The top-level shape is unchanged.

### Fixed

- A log over about 512 MB failed with Node's "Cannot create a string longer
  than 0x1fffffe8 characters". The limit is real (the log is loaded as one
  string), and the message now says so and suggests one session per file.

## [0.2.1] - 2026-10-01

### Added

- The package is named `@antonsoloviev/contextscope`, ready for npm, and
  carries the CLI and the library; the example sessions stay in the repository.
  It isn't published yet; until it is, install from GitHub as before.
- `contextscope --version` (`-V`).
- `ContextScopeParseError` is exported from the library, so callers can tell a
  rejected input from a bug.

### Fixed

- A malformed entry in a request log crashed the analysis with a `TypeError`
  ("lineToEncode.match is not a function" in the web app): a `null` message,
  content block, tool or tool call, a number or object where text should be,
  or a non-string block `type`. Such an entry is now kept, in position, as a
  segment holding its own JSON, so the rest of the log is still analyzed and
  the cache-prefix comparison still lines up. A structural fuzz test covers it.

## [0.2.0] - 2026-09-30

### Added

- The model named in the requests picks the pricing and cache rules; `--model`
  overrides it, and an unrecognized id is reported instead of silently priced
  as the default. Dated snapshot, Bedrock and Vertex ids resolve to their alias.
- All eleven current Claude models, with each one's minimum cacheable prefix
  and cache-read price (0.05× on Claude Opus 5.5, 0.025× on Claude Fable 5.1).
  Claude Sonnet 5.5 is the default.
- A `model_switch` finding, and model switches count as cache misses.
- OpenAI Responses API bodies; Anthropic Message Batches and OpenAI Batch API
  files; gateway logs that wrap each body in `request` / `request_body`.
- Warnings for records that aren't request bodies and for Responses requests
  that continue a stored response (`previous_response_id`).
- CLI: `--fail-on <error|warning|info>` (exit 2) for CI gates, `--calibrate`
  (reads `ANTHROPIC_API_KEY`), `-v/--verbose`; unknown options and bad values
  are rejected with a message.
- `npm run bench` times `analyze()` on the flagship example and a generated
  300-request session.

### Changed

- Findings that recur on every request are grouped ("requests 2–24, 23×") in
  the CLI, the HTML report and the web app. The CLI shows the largest
  request's breakdown and abbreviates cache tables over 30 rows unless
  `--verbose`; the HTML report and the web app lead with findings.
- Calibration counts one whole request with `count_tokens` and scales every
  Claude estimate to it, instead of one call per segment whose results only
  appeared in the inspector.
- The optimized scenario fixes everything the findings flag: JSON keys and the
  tool list are put in a deterministic order, in addition to removing volatile
  values. The OpenAI tools-reordered example now shows the saving its finding
  implies.
- "Tools reordered" names only the positions that moved. The timestamp fix
  suggests a mid-conversation `system` message only for models that accept one.
- Web: OpenAI sessions are sized by exact OpenAI tokens in the treemap, and
  treemap labels no longer overflow small blocks.

### Fixed

- A tool schema whose key order drifted still counted as a cache hit, which
  contradicted the key-order finding. Blocks are now compared exactly as sent.
- A `cache_control` marker was part of a block's content, so a rolling
  breakpoint on a `tool_use` block broke the prefix when it moved on.
- The canonical minimal Anthropic request (`{model, max_tokens, messages}` with
  string content) was detected as OpenAI, and so was any Anthropic request
  with a mid-conversation `system` message.
- Web: after an example, a new file or paste inherited that example's format
  and model (an OpenAI paste after an Anthropic example was parsed as
  Anthropic); example buttons stayed on "loading…"; errors used `alert()`.
- Server-side and MCP tool blocks were counted as user or assistant text.
- A timestamp in a mid-conversation `system` message was reported as being in
  "the system prompt"; the finding now names the message.

### Performance

- The segment diff uses Myers' O((N+M)·D) algorithm instead of a full LCS
  table, each distinct segment text is tokenized once per analysis, and the
  optimized comparison normalizes each segment once. Measured back to back on a
  14-vCPU WSL2 machine, `analyze()` went from 902 ms to 138 ms on the flagship
  session and from 2,770 ms to 361 ms on the 300-request session (medians of
  five).

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
- Four synthetic built-in example sessions, generated by `scripts/generate-examples.mjs`:
  a realistic 24-turn, ~79K-token Anthropic cache-busting session and its
  fixed counterpart, a duplicate-content session, and an OpenAI
  tools-reordered session.
- Transparent gzip support: the CLI (`node:zlib`) and the web app (native
  `DecompressionStream`) both accept `.jsonl.gz` input, detected by extension
  or gzip magic bytes. The two large flagship examples are committed gzipped
  (~5.7 MB each, compressed to ~0.48 MB) to stay under the repo's per-file
  size limit; the web app serves them as static assets via a committed
  symlink (`web/public/examples` -> `../../examples`), not bundled into JS.
