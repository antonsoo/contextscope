# contextscope

See what's actually in your LLM context window, and why your prompt cache keeps missing.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/live%20demo-antonsoo.github.io%2Fcontextscope-1baf7a)](https://antonsoo.github.io/contextscope/)

<p align="center">
  <img src="docs/assets/web-dashboard-dark.png" alt="contextscope web app on a synthetic 24-turn coding-agent session: headline numbers, two grouped findings (a timestamp in the system prompt breaks the cache on requests 2 to 24), and a token-usage treemap of the 78,715-token last request" width="880">
</p>

Agentic apps send huge, fast-growing prompts, and it's genuinely hard to see which
part is eating the budget: the tool definitions, the system prompt, a 400-token
tool result, an image. Anthropic's and OpenAI's prompt caches also break
**silently** whenever anything in the prefix changes (a timestamp interpolated
into the system prompt, a tool list rebuilt from an unordered map, a model
switch mid-conversation), and the only symptom is a cost and latency regression
nobody notices until the bill arrives. contextscope is a local-first analyzer for
the raw JSON requests these agents actually send: it shows where the tokens go,
simulates each provider's cache rules turn by turn, and points at the specific
block that broke the cache.

Everything runs in your browser or on your machine. Nothing is uploaded.

## Contents

- [Quickstart](#quickstart)
- [Features](#features)
- [Usage](#usage)
- [How it works](#how-it-works)
- [Accuracy and limitations](#accuracy-and-limitations)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Quickstart

Run it against your own request log:

```sh
npx --allow-git=root github:antonsoo/contextscope analyze your-requests.jsonl
```

That installs straight from GitHub: the npm package, `@antonsoloviev/contextscope`,
isn't published yet (npm 12 needs `--allow-git=root` for a git-hosted package). To try the bundled
examples, clone the repository:

```sh
git clone https://github.com/antonsoo/contextscope && cd contextscope
npm install
node dist/cli/index.js analyze examples/anthropic-agent-cache-bust.jsonl.gz
```

`npm install` runs the package's `prepare` script, which compiles the CLI and
library with `tsc`.

Or skip the CLI and open **[antonsoo.github.io/contextscope](https://antonsoo.github.io/contextscope/)**:
drop a request file, paste one, or click a built-in example.

## Features

- **Token usage treemap.** Every request in a session, broken into segments
  (system, tool definitions, user/assistant text, tool calls, tool results,
  images, thinking), colored by category and sized by tokens. Click a segment to
  see its raw content, path, and cache status.
- **Prompt-cache simulation across a sequence.** For each request and the
  request it continues, contextscope finds the longest common prefix in the provider's own
  serialization order, shows a readable diff of exactly what changed, and
  simulates cache reads, writes and misses under that provider's rules:
  Anthropic's `cache_control` breakpoints, per-model minimum cacheable length,
  20-position lookback window and 5-minute/1-hour write pricing; OpenAI's
  automatic prefix caching. It reports actual cost against an optimized
  scenario, and projects the difference to 1,000 sessions shaped like yours (a
  straight multiplication, not a separate estimate).
- **Logs of more than one conversation.** A proxy capture of an agent holds
  its main loop and, between the turns, side requests on another model; a
  gateway's log holds every user's conversation, interleaved. Each request is
  matched to the request it continues, wherever in the file that is, and the
  cache is simulated as the providers keep it: by content, per model. A
  session reads the same whether it is alone in the file or not.
- **Priced as the model you actually used.** The model named in the requests
  picks the pricing and cache rules (dated snapshots and Bedrock/Vertex ids
  included); `--model` overrides it, and an id with no pricing entry is reported
  instead of silently priced as something else. All eleven current Claude
  models are covered, including the ones whose minimum cacheable prefix or
  cache-read price differs from the usual.
- **Findings with concrete fixes**, grouped so a problem that recurs on every
  request is reported once: *"System prompt contains a value that changes every
  request (requests 2–24, 23×)"*, *"Tools reordered between requests 2 and 3:
  positions 2–3: [read_file, grep_search] → [grep_search, read_file]"*, *"tool
  schema key order differs"*, *"Model changed mid-conversation"*, *"prefix below
  Claude Opus 4.6's 4,096-token minimum"*, *"No cache breakpoint on the
  conversation tail"* (often the single highest-value fix for a real agent loop).
- **Duplicate content detection** (5-word shingling + Jaccard similarity): the
  same file or tool output fetched more than once in one conversation.
- **Reads the files you already have.** Anthropic Messages bodies, OpenAI Chat
  Completions and Responses API bodies, as a single request, a JSON array, or
  JSONL, optionally gzipped. The parsers are tested on request bodies written
  by the real Python SDKs (`tests/fixtures/sdk/`), not only on hand-made ones. Anthropic Message Batches and OpenAI Batch API
  files, and gateway logs that wrap each body in `request`/`request_body`, are
  unwrapped automatically. The format is auto-detected.
- **Exact OpenAI token counts** (o200k_base, via `gpt-tokenizer`) and
  **estimated Claude token counts**, always labelled `≈`, with optional
  calibration against Anthropic's real `count_tokens` endpoint (one call, in the
  CLI or the browser).
- **A Node CLI** that works as a CI gate (`--fail-on warning` exits 2) and
  writes HTML or JSON reports, and **a Vite + TypeScript web app** for
  interactive exploration, sharing one core library.

## Usage

### CLI

```text
contextscope analyze <file> [options]

Options:
  --format <anthropic|openai>     Override auto-detected format
  --model <id>                    Price as this model (default: the model named in the requests)
  --calibrate                     Anthropic only: count the largest request exactly with the
                                  count_tokens endpoint (reads ANTHROPIC_API_KEY) and scale
                                  every Claude estimate to match
  --fail-on <error|warning|info>  Exit with status 2 if any finding is at least this severe
  --html <out.html>               Also write a self-contained HTML report
  --json <out.json>               Also write the analysis as JSON: counts, findings and cache
                                  steps for every request and segment, without the request text
  -v, --verbose                   Show every request's breakdown and every prefix/cache row
```

Exit status is 0 on success, 1 on bad arguments or unreadable input, and 2
when `--fail-on` is set and a finding meets it. Gzipped input is detected by
extension or, failing that, by gzip magic bytes.

Real output on `examples/anthropic-agent-cache-bust.jsonl.gz`, a synthetic
24-turn, ~79,000-token coding-agent session where a timestamp inside the system
prompt busts the cache on every turn:

<p align="center">
  <img src="docs/assets/cli-cache-bust.png" alt="Terminal output of contextscope analyze: the largest request's token breakdown, all 23 request pairs rewriting the system block, zero cache reads across 24 requests, $2.8460 actual vs $0.4570 optimized (84% lower), and two grouped findings pinpointing the timestamp" width="880">
</p>

The paired example, `examples/anthropic-agent-cache-fixed.jsonl.gz`, is the
same session with two changes: the timestamp is gone from the system prompt,
and a second `cache_control` breakpoint rolls forward onto the latest turn of
every request, next to the first breakpoint on the static system prompt. That
is the "one breakpoint on the stable prefix, one rolling on the growing tail"
pattern Anthropic recommends for agent loops. Fixing only the timestamp and
stopping there is a common half-fix: the system-prompt breakpoint finally reads,
but every turn still resends the whole conversation history uncached, because
nothing marks where that history ends. contextscope has a finding for that gap
(`missing_tail_breakpoint`), so it never reports "no findings" while still
showing a large potential saving. On the fixed example, actual cost is $0.4570,
identical to the optimized figure, with zero findings. The timestamp fix alone
would have saved 13.3%; both fixes together save 84%.

### Web app

```sh
npm run build:web      # outputs web/dist/
npm run preview:web    # serve the built app locally
```

Drop a file (plain or gzipped), paste JSON/JSONL, or pick one of four built-in
synthetic examples, labelled as such: the 24-turn cache-busting session above
(a ~5.7 MB session, shipped gzipped at ~0.48 MB and fetched only when you pick
it), its fixed counterpart, a session with a file re-read three times, and an
OpenAI session with tools reordered mid-conversation. The view opens on the
*last* request, where a growing conversation is biggest. Findings come first,
each with links to every request it fired on; below them are the treemap, the
segment table, the line-level diff between each request and the one it
continues, and the cache table. A file of several conversations opens on its
largest request. The format and model pickers in the top bar override detection for the
current input only.

<p align="center">
  <img src="docs/assets/web-inspector.png" alt="Segment inspector drawer open on the grep_search tool definition, showing its raw JSON schema and token counts" width="420">
  <img src="docs/assets/web-openai-light.png" alt="The same app in light mode on an OpenAI session, with one finding naming the two tools that swapped places" width="420">
</p>

### As a library

```ts
import { analyze, groupFindings } from "@antonsoloviev/contextscope";

const result = analyze(rawRequestJsonOrJsonl); // or { model: "claude-opus-5-5" } to override
// result.model            — the model priced with, and whether it came from the requests
// result.reports          — per-request token totals and category breakdown
// result.prefixMatches    — longest common prefix + diff between each request and the one it continues
// result.conversations    — how many conversations the input holds, and which one each request is in
// result.cacheSimulation  — simulated reads/writes/cost, actual vs. optimized
// result.findings         — concrete, located issues (groupFindings() collapses repeats)
// result.duplicates       — near-duplicate content groups
```

## How it works

**Parsing.** Each request is normalized into a flat, ordered list of
`Segment`s in the *provider's own serialization order*: `tools → system →
messages` for Anthropic, and `tools → messages` for OpenAI (whose system or
developer message is `messages[0]`, or `instructions` in the Responses API).
Every other analysis operates on this list, so the wire formats are understood
once, in `src/core/parse-*.ts`. Record envelopes are recognized only when every
record in the file has the same one, so a request body is never mistaken for a
wrapper.

**Token counts.** OpenAI counts are exact: `gpt-tokenizer`'s pure-JS o200k_base
encoder, the BPE vocabulary GPT-4o and newer OpenAI models use. Claude counts
are a documented heuristic (`src/core/tokenize-claude.ts`), because Anthropic
does not publish Claude's tokenizer, and they are labelled `≈` everywhere. The
method: characters per token scaled by how symbol-dense the text is (about 4.0
chars/token for prose and 2.9 for JSON/code, interpolated by the fraction of
non-alphanumeric characters), since BPE tokenizers split more often on
punctuation. An agent loop re-sends its whole history on every request, so each
distinct segment text is tokenized once per analysis: the flagship session has
1,259 segments but only 109 distinct ones.

**Calibration.** `POST /v1/messages/count_tokens` returns the real input-token
count for a whole request body (tools, system, messages and the framing around
them) and is free to call. contextscope sends the largest request (CLI) or the
selected one (web), divides the exact count by its own estimate, and rescales
every Claude estimate by that ratio, so the cost figures rest on a measured
count. The web app calls the endpoint directly from the page with Anthropic's
`anthropic-dangerous-direct-browser-access` CORS opt-in; the key stays in that
tab's memory and goes nowhere else.

**Conversations.** A request log is rarely one conversation, and the line
before a request is then some other conversation's. `src/core/threads.ts` pairs
each request with the earlier request it continues: the one whose messages it
starts with, all of them and in order (the previous turn of an agent loop);
failing that, a recent request at least half of whose messages it re-sends (the
same conversation with its history edited: a sliding window, a trimmed tool
result); failing that, the earlier request that shares the most of its tools
and system prompt once volatile values and ordering are normalized away (a new
conversation of the same application, compared only as far as that shared
setup). A request that matches nothing starts a conversation with nothing to
compare it to. Prefixes are interned in a trie, so analyzing 3,000 requests of
150 interleaved conversations takes about half a second. In a file that is one
conversation, every request is paired with the one before it, as before.

Real output for the fixed example session with a 27-token request on another
model after every second turn (36 requests; alone, the session costs $0.4570
and has no findings):

```
contextscope — anthropic · 36 requests in 13 conversations (auto-detected)
priced as Claude Sonnet 5 (from the requests)
...
Prefix match across the sequence
  13 conversations in this file; each request is compared with the request it continues
  all 23 follow-up requests only append to the request they continue
  11 requests start a new conversation on a setup already sent
...
  total actual cost:    $0.4576
  total optimized cost: $0.4576  (findings fixed, plus a breakpoint on each request's tail)

No findings — this sequence caches cleanly.
```

**Prefix matching and diffing.** `src/core/prefix.ts` finds the longest common
prefix between the segment lists of a request and the one it continues, then diffs the *whole*
lists, not just the tail, so a single reordered tool or one edited system block
shows up as a small, localized change instead of "everything after position 3
differs." The diff is Myers' O((N+M)·D) algorithm (E. W. Myers, "An O(ND)
Difference Algorithm and Its Variations", *Algorithmica* 1, 1986): consecutive
agent requests differ by a few edits, so D is small even when N and M are in
the thousands. A randomized test checks that the unchanged lines always form a
longest common subsequence.

**Cache simulation.** `src/core/cache-anthropic.ts` and `cache-openai.ts`
implement each provider's documented rules:

- **Anthropic**: up to 4 `cache_control` breakpoints per request. A top-level
  `cache_control`, beside `model` (automatic caching), is a breakpoint on the
  last cacheable block of the request, the last block that is not thinking or
  empty text; it is simulated like a marker placed there by hand, and takes
  one of the four. Breakpoints are read against
  the entries earlier requests wrote at theirs: an entry is read if its prefix
  is byte-identical to this request's up to that point, whichever earlier
  request wrote it, and the position distance is within the 20-block lookback window (a
  run of consecutive `tool_use` or `tool_result` blocks counts as one position,
  per Anthropic's documented rule). Writes cost 1.25× (5-minute TTL) or 2×
  (1-hour TTL) the input price. Reads cost 0.1× on most models, but 0.05× on
  Claude Opus 5.5 and 0.025× on Claude Fable 5.1. A breakpoint below the
  model's minimum cacheable length silently never caches, and that minimum is
  not monotonic across generations: 512 tokens on the newest models, 1,024 on
  Opus 4.8 and Sonnet 5, 2,048 on Opus 4.7, 4,096 on Opus 4.6 and Haiku 4.5.
  Figures are from Anthropic's pricing and prompt-caching documentation as of
  2026-09-25.
- **OpenAI**: automatic (implicit) prefix caching, with no marker needed, for
  prompts of at least 1,024 tokens, with the cached portion (the longest prefix
  any earlier request sent) rounded down to the
  nearest 128 tokens and no separate write charge. Rules and pricing are from
  `developers.openai.com/api/docs/guides/prompt-caching` and
  `developers.openai.com/api/docs/pricing` as of 2026-09-24. OpenAI's newer
  explicit-breakpoint, 30-minute-TTL caching mode (GPT-5.6 and later) is **not**
  simulated: a file that uses it (`prompt_cache_options`,
  `prompt_cache_breakpoint`) gets a note saying so, and one saying that
  `mode: "explicit"` with no breakpoint caches nothing.
- **Both**: a cached prefix is the model's own attention state, so a request
  reads only what earlier requests on its own model cached, however much of the
  prefix another model was sent.

The **"optimized"** scenario re-runs the same simulation with the findings
fixed: ISO-8601 timestamps, UUIDs and epoch-looking integers are normalized out
of the prefix comparison (the "timestamp in the system prompt" fix), JSON keys
and the tool list are put in a deterministic order, and, for Anthropic, every
request gets a trailing `cache_control` breakpoint (the "automatic caching on
the growing tail" pattern). The actual scenario compares blocks exactly as sent,
key order included, so a schema whose keys drift is a miss there and a saving
here. A `cache_control` marker itself is never part of the comparison: a
rolling breakpoint moves every turn without changing the cached content. The
dollar difference is the "potential savings" figure.

**Duplicate detection.** 5-word shingles hashed with FNV-1a, grouped by Jaccard
similarity ≥ 0.85 (union-find), scoped to the *last* request of each
conversation. In an agent loop every later request resends the whole
conversation, so comparing across requests would flag every earlier turn as a
duplicate of itself. The last request already contains the full accumulated
context, so scanning it alone still catches the real case: the same file or
tool output fetched more than once in one conversation.

**Findings.** A fixed set of rule-based checks over the parsed sequence, the
prefix diffs and the duplicate groups (`src/core/findings.ts`), not an LLM
judgment, so the same input always produces the same findings. Most are
structural (a reordered tool, a changed schema, a model switch). One,
`missing_tail_breakpoint`, is derived from the Anthropic simulation's own
actual-vs-optimized cost gap, so the findings and the "potential savings"
figure can't contradict each other: whenever fixing the findings would lower
the cost by 10% or more, at least one finding says so. "No findings" is a
factual claim: the simulated optimized cost is (within rounding) the actual
cost already. Advice is model-aware; for example, a mid-conversation `system`
message is suggested only for models that accept one.

**Categorical palette.** The eight segment categories use a colorblind-safe
palette (worst-case simulated CVD ΔE ≥ 8.4 OKLab, worst-case normal-vision ΔE
≥ 19.3, both checked against the actual dark and light surface colors) in a
fixed hue order, so a color always means the same category.

**Treemap.** A hand-rolled squarified treemap (Bruls, Huizing & van Wijk,
2000), about 40 lines in `web/src/lib/treemap.ts`.

## Accuracy and limitations

- **Claude token counts are estimates** unless calibrated. There is no public
  Claude tokenizer, and Claude's tokenizers differ between generations
  (Anthropic documents that the tokenizer introduced with Opus 4.7 uses up to
  about 1.35× as many tokens as Opus 4.6's for the same text), so no single
  heuristic can be accurate for every model. The heuristic is only checked for
  the qualitative behavior described above. Calibration fixes the total for the
  counted request; segments denser or sparser than that request's average keep
  some error.
- **OpenAI token counts are exact** for the o200k_base encoding, cross-checked
  in `tests/tokenize-openai.test.ts` against `js-tiktoken`, an independently
  maintained pure-JS tokenizer, on 9 varied samples (prose, code, JSON,
  non-English text, emoji, repeated text); all match exactly. A model that uses
  a different encoding still gets the o200k_base count. Per-message framing
  tokens are not counted.
- **The cache simulation is a documented model, not a measurement.** Request
  bodies carry no timestamps, so it assumes every request arrives within the
  TTL (the steady agent loop this tool targets) and never models an entry
  expiring between requests minutes apart. Matching is at segment granularity:
  OpenAI caches at token granularity, so a change near the end of a long
  segment earns partial credit there that this simulation doesn't give, which
  errs toward fewer cached tokens, never more. A sequence is priced as a single
  model (the one named most often); a model switch is treated as a cache miss,
  not re-priced. Exotic breakpoint placements (for example deliberately
  non-monotonic TTLs across many blocks) are simplified.
- **Server-side state is invisible.** A Responses API request that continues a
  stored response (`previous_response_id`) carries only its new input; the tool
  warns and analyzes what is in the file.
- **Duplicate detection is scoped to the last request of each conversation**,
  so it won't flag the same content appearing in two different conversations.
- **Conversations are told apart by their content.** Two conversations that
  send exactly the same messages are one as far as the analysis can see, which
  is also how the cache sees them. A conversation whose history is replaced
  wholesale (a summary in place of every earlier message) is read as a new
  conversation, not as a rewrite of the old one.
- **The web app's exact-tokenizer chunk is large.** The o200k_base vocabulary
  is about 1 MB gzipped. It is fetched on first analysis, not on page load; the
  drop-zone screen is about 14 KB gzipped. The flagship example is a separate
  ~0.48 MB static asset, decompressed in the browser with `DecompressionStream`.
- **Performance.** `npm run bench` times `analyze()` on the flagship session
  (24 requests, 5.7 MB) and on a generated 300-request conversation (12.1 MB,
  93,900 segments in total). Measured back to back on a 14-vCPU WSL2 machine,
  v0.2.0 took a median 138 ms and 361 ms against 902 ms and 2,770 ms for
  v0.1.0. Pairing requests into conversations (v0.3.0) costs nothing
  measurable: run alternately four times, v0.2.2 took 111-166 ms and
  423-558 ms, and v0.3.0 120-131 ms and 476-570 ms. That machine was shared
  with other jobs, so run the script for numbers on yours.
- Synthetic example data is labelled synthetic, in both the CLI filenames and
  the web app's example picker.

## Development

```sh
npm install          # installs deps and builds dist/ via the `prepare` script
npm run lint         # eslint
npm run typecheck    # tsc --noEmit, core + cli and the web app
npm test             # vitest, 174 tests
npm run build        # core + cli (dist/) and the web app (web/dist/)
npm run bench        # analyze() timings on the flagship and a 300-request session
npm run dev:web      # Vite dev server for the web app
```

`src/cli/index.ts` calls `main()` unconditionally rather than comparing
`import.meta.url` with `argv[1]`, so it also runs through the symlink that `npx`
and `npm install -g` create.

Regenerating the example sessions:

```sh
node scripts/generate-examples.mjs
```

This writes the small examples as plain `examples/*.jsonl` and the flagship
pair as gzipped `examples/*.jsonl.gz`. `web/public/examples` is a committed
symlink to `../../examples`, so the web app picks up whatever the generator
writes. The flagship pair is built from `scripts/lib/`: a long, internally
consistent "enterprise coding agent" system prompt, a 16-tool surface, and a
library of synthetic file contents, diffs and test/lint/CI output for a
fictional `ledger-core` billing repository, assembled into a 24-turn
transcript. Nothing in it is copied from a real project; it exists so the
treemap and the dollar figures reflect a session at real agent-loop scale.

Project layout:

```
src/core/     shared library: parsers, tokenizers, prefix/diff, cache
              simulation, findings, duplicates, calibration (no I/O, no DOM)
src/cli/      Node CLI: argument parsing, terminal and HTML report renderers
web/          Vite + TypeScript web app (imports src/core directly, no framework)
tests/        vitest suite for src/core and the CLI
scripts/      example generator and benchmark (not part of the shipped package)
examples/     synthetic example sessions, shared by the CLI and the web app
docs/assets/  README screenshots
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Anton Soloviev

---

<sub>Part of [Officina](https://antonsoo.github.io/officina/), a set of small open-source tools by [Anton Soloviev](https://github.com/antonsoo).</sub>
