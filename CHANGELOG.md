# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Compare same-record provider response usage with token estimates and cache
  simulation. Support native Anthropic, OpenAI Chat/Responses, and gateway
  wrappers with original counter paths. Preserve missing fields, reject
  inconsistent counts, and withhold ambiguous historical Claude gateway totals.
- Browser filters, request inspection and 25-row pagination for reported usage;
  full JSON and script-free offline HTML downloads preserve all rows. Terminal
  summaries and `--verbose` show the same evidence. Configured CLI gates fail
  invalid usage or unsafe aggregates without treating missing counters as zero.
- Export `toJsonReport` from the library. Keep existing simulation JSON field
  names for compatibility; human reports now label their costs as simulated.
- Verify 17,425 captured responses from 520 hash-pinned public trajectories and
  2,205 reconstructed OpenAI Chat requests. Surface 712 predicted hits with
  recorded zero reads; retain gateway ambiguities instead of guessing totals.
  See `studies/reported-usage/` and `docs/reported-usage.md`.

Found by scoring contextscope against the usage Anthropic and OpenAI reported for 12,760 requests
of public SWE-bench agent runs; see `studies/real-trajectories/`.

### Fixed

- Simulate modern OpenAI implicit/explicit cache endpoints, four write slots,
  and 30-minute write pricing. Explicit mode without markers no longer invents
  discounted reads. Cache keys and renderer settings isolate entries; multipart
  tool-output markers preserve call routing. Show writes in CLI/browser/HTML,
  diagnose shared text without a reusable boundary, and remove obsolete
  unsupported-mode warnings. Apply GPT-6 long-context input/cache prices above
  272,000 modeled input tokens; retain the documented legacy approximation for
  the newly recognized GPT-5.1/5.2 historical models.

- Resolve prices, cache minimums, context windows and model-specific advice for
  each request in mixed-model logs. Expose the resolution in `reports[i].model`
  and human reports, including minority unknown-model fallbacks. Browser model
  overrides can return to "from each request"; calibration uses the selected
  request's model. Missing model names no longer bridge named models' caches.
  Model-switch advice acknowledges earlier cache entries on the destination
  model instead of claiming every switch pays full input price.

- Resolve all Anthropic cache hits before assigning writes, preventing an earlier
  missed breakpoint from double-billing a later hit. Count the breakpoint itself
  among the 20 lookup positions. Keep the optimized tail within four marker slots
  and skip ineligible thinking/empty text. Reject invalid marker configurations
  before they can produce simulated costs or contaminate later cache state.
  See `docs/cache-accounting.md` for the controlled before/after reproduction.
- Make whole-report JSON and offline HTML downloads available for request-only
  browser analyses as well as captures with response usage.

- A tool result's string content and the same content as one text block are one prompt in
  prefix, diff, cache and conversation identity. The unreleased prompt-identity change had made
  them differ, so a tool-using Claude session whose cache marker moves between requests (as in
  mini-SWE-agent 2.0 through litellm) showed no cache reads and a "lookback window" finding on
  every request, while Anthropic reported reads on 90 to 97% of its input tokens. 0.3.3 is not
  affected.
- Claude token estimates were 15 to 25% low on agent transcripts. The characters-per-token
  anchors move from 4.0 / 2.9 to 3.3 / 2.5, fitted on half of 5,160 measured steps and checked
  on the other half. Estimates for Opus 4.7 and later are not measured and still lower than
  Anthropic's documented tokenizer change implies.
- OpenAI Chat Completions messages with plain-string content count 5 framing tokens each, the
  amount gpt-5.1 and gpt-5.2 reported for 2,205 of 2,205 requests. Other message shapes are
  unchanged.
- Claude Opus 4.5 and Sonnet 4.5 are in the model table with their documented minimum cacheable
  prefix (4,096 and 1,024 tokens) and prices. They were priced as Sonnet 5.5 with a 512-token
  minimum, so Opus 4.5 sessions got cache reads predicted on prefixes the API does not cache.

- Preserve full prompt structure and message boundaries in prefix, diff, cache
  and conversation identity, separately from token-counted content. Mark
  metadata-only changes and preserve tool-routing IDs and signed thinking when
  normalizing volatile text. Following tool calls no longer alter the identity
  of preceding assistant text. Plain-string source paths point to their actual field.
- Reject corrupt UTF-8/UTF-16 before replacement decoding changes evidence,
  including compressed input; valid Unicode and literal replacement characters remain.
- Remove request-text diff previews from summary JSON exports while retaining
  counts, boundaries and source provenance. Local detailed inspection is unchanged.
- Improve cache-placement badge contrast on hovered light-theme rows.

- Reject duplicate JSON fields, overflowing/underflowing numbers, excessive nesting and
  ambiguous request envelopes. Preserve prototype-like schema keys when sorting.
- Unwrap mixed gateway formats per record and retain source record/line/envelope
  provenance. Detect strong mixed-provider evidence and keep forced mismatches
  visibly incomplete; long text histories cannot flip provider detection.
- Keep malformed prompt fields and original plain-string content in inspection.
  Refuse calibration scales that would overflow safe token counts.
- Report partial source coverage in terminal, HTML, JSON and the workspace;
  configured CI gates fail incomplete input even with no findings. Empty arrays
  fail with an actionable error. HTML no longer asserts live cache cleanliness.
- Move browser parsing, tokenization, analysis and calibration into disposable
  same-origin workers. Cancel, replacement and reset stop computation; worker
  failures retain the prior report and allow retry.
- Preserve the page's local-only network policy inside workers through an
  inherited-CSP blob bootstrap, with URL cleanup and production privacy probes.
- Bound segment table pages, treemap controls and inspector previews without
  changing totals; filters/pages and complete raw JSON downloads retain access
  to all evidence.
- Imports commit only after successful analysis. A newer import cancels older
  file/example reads; failures preserve the current analysis and overrides.
  Reset cancels pending work and releases request-bearing state, tokenizer
  caches, pasted text, and rendered inspector/panel contents.
- Bound file reads and gzip output before allocating a full expansion: 50 MiB
  in the browser, 500 MiB in the CLI, with actionable errors and recovery.
- Replace the browser calibration form blocked by its own privacy policy with
  a local measured-token count. Show its request/model provenance, validate
  safe positive integers, and preserve estimates and undo behavior.
- Request tabs, finding links, and prefix comparisons stay aligned. Use the
  provider's token counts when choosing the largest request and showing the
  matched prefix. Prefix bars now render their shared fraction.
- Keyboard tabs, comparison buttons, and segment labels; a modal inspector
  with focus containment/return; responsive treemap and mobile header.
- Qualify empty findings and label cache costs as simulations.

### Added

- `studies/real-trajectories/`: the trajectories sampled, the scripts that rebuild their
  request bodies and score contextscope against the reported usage, and the results.

### Tests

- `tests/real-trajectory-fixes.test.ts`: the string / text-block tool result sequence, the
  Claude 4.5 minimums and the Chat framing count, each taken from a case in the study.
- Chromium and Firefox production workflow tests, including accessibility in
  both themes and mobile layouts, import races, cancellation, reset, bounded
  gzip expansion, calibration, keyboard navigation, and built-in assets.

## [0.3.3] - 2026-10-03

### Security

- Text from the requests reached the terminal as it came. A model name holding a terminal
  escape sequence went straight into "priced as ... is not in the pricing table", and the same
  held for finding titles, segment labels and parse warnings, so a crafted log could clear the
  screen, retitle the window or hide part of the report. Each control character in such text
  is now written as a visible escape (`claude-x\x1b]0;title\x07`). `--json` and `--html`
  already escaped them.

## [0.3.2] - 2026-10-02

### Added

- Published to npm as `@antonsoloviev/contextscope`:
  `npx @antonsoloviev/contextscope analyze your-requests.jsonl`. The README
  uses the registry package instead of the GitHub install, which npm 12 blocks
  by default.

### Fixed

- The inspector panel's Close button stayed in the tab order while the panel
  was closed and off-screen: a keyboard stop on a control nobody could see.
  The closed panel is `inert`; opening it moves focus to its Close button, and
  closing it (the button, Escape or the backdrop) returns focus to the segment
  that opened it. Checked in Chromium, Firefox and WebKit.
- Numbers no longer follow the reader's locale. Findings and the HTML report
  formatted token counts with the system's locale, so on a German system a
  finding read "below Claude Opus 4.6's 4.096-token minimum" (in the terminal
  and in `--json`), beside dollar amounts written with a decimal point. Counts
  are written `4,096` everywhere. CI now runs the tests a second time in a
  comma-decimal locale.
- A log saved by a Windows shell. `... > requests.jsonl` in Windows PowerShell
  writes UTF-16 with a byte-order mark; read as UTF-8 it held no JSON ("No
  valid JSON objects found"), in the CLI and in the web app. The mark decides
  the encoding now, for plain and gzipped files, and the analysis is the same
  as for the UTF-8 file.

### Changed

- The page's fonts are served by the page itself. They came from Google Fonts,
  the one request the page made to another origin; the same font files (every
  subset, as Google serves them to a current browser) are now in
  `web/src/fonts/`, with their SIL Open Font License texts. Nothing looks
  different: screenshots before and after match. The page now loads with
  every other host blocked.

### Security

- The `--html` report carries a Content-Security-Policy too: it is one file
  with no script, and the policy has the browser refuse to run or fetch
  anything, whatever a tool or a message in the log is called.
- The built page carries a Content-Security-Policy. Scripts, styles, fonts and
  workers load from the page's own origin only, and `connect-src 'self'` has
  the browser refuse to send what you give the page to any other host, even
  for a script injected through a bug in how the page renders a file. Inline
  event handlers and `eval` are not allowed. Every control was exercised
  in Chromium and Firefox with a listener for policy violations: none.

### Accessibility

- Checked with axe-core (WCAG 2.1 A and AA, and its best-practice rules) in light and dark,
  at desktop and phone widths, empty and with each example loaded: no
  findings now.
  - In the dark theme the inactive request tabs were unreadable: they had no
    background of their own, so they got the browser's grey button face under
    the muted label (1.7:1).
  - Treemap labels were white on every category colour (2.2:1 to 4.4:1). Each
    category now has a label ink, dark or white, that reaches 4.5:1 on it.
  - Faint text (2.7:1 to 3.1:1), the primary button (white on the category
    blue, 3.6:1 in the dark theme) and, in the light theme, the status colours
    used as text (2.8:1) are above 4.5:1.
  - The dashboard has a `main` landmark and the page an `h1` in both views;
    the treemap is a group of buttons, not an image; the tables and the diff
    that scroll can take keyboard focus; the file input has a name.

## [0.3.1] - 2026-10-02

Checked against request bodies written by the real anthropic and openai
Python SDKs (their HTTP transport replaced by one that records the request),
committed as `tests/fixtures/sdk/` with the script that writes them.

### Fixed

- **Anthropic's automatic caching was read as no caching.** A top-level
  `cache_control` beside `model` puts a breakpoint on the last cacheable
  block of the request and moves it forward as the conversation grows; it is
  the one-line way to turn caching on. contextscope only looked for markers
  on blocks, so an eight-turn agent loop that caches cleanly was reported as
  $0.3134 with "No cache_control breakpoint set" on all eight requests. It is
  now simulated exactly like the same loop with a marker placed by hand on
  each request's last block: $0.0687 and no findings. The block the automatic
  breakpoint lands on is shown as such (`● 5m auto` in the web app,
  `"automatic": true` in `--json`).
- A chain of OpenAI requests using `previous_response_id` produced the same
  parse warning once per request. It is one note naming the requests
  (`Requests 2–6 continue a stored response or conversation ...`), and a
  `conversation` is covered by it too.

### Added

- OpenAI requests that place cache breakpoints by hand (`prompt_cache_options`,
  `prompt_cache_breakpoint`, GPT-5.6 and later) get a note that the simulation
  models automatic prefix caching only; `mode: "explicit"` with no breakpoint
  gets one saying that OpenAI then caches nothing of the request.
- The "No cache_control breakpoint set" finding says how to fix it in one
  line (the top-level `cache_control`).

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

- The package is named `@antonsoloviev/contextscope`, ready for npm (published
  there from 0.3.2). It carries the CLI and the library; the example sessions
  stay in the repository.
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
