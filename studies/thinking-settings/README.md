# Thinking settings are part of a cache boundary

At baseline `b295f6d`, changing a Claude thinking budget from 2,048 to 4,096
while keeping the prompt identical predicted a read of all 10,151 modeled
tokens. Changing top-level effort had the same problem. A separate parser
omission erased empty system messages containing a per-message effort change.

The source now keeps top-level reasoning settings in separate cache scopes and
retains empty message headers in prompt identity. This is an unreleased local
source correction. There is no npm release or hosted deployment associated
with this study.

## Rules and the conservative assumption

[Claude's thinking/caching documentation](https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-and-prompt-caching)
states that thinking mode, extended-thinking budget and top-level effort
changes invalidate message entries. Whether tool and system entries survive
depends on the model's hidden prompt placement. The documentation recommends
treating these changes as restarting the cache.

Contextscope follows that conservative approach: it isolates tools, system and
messages together across these settings. The new finding names that assumption
and says actual setup reuse and costs may differ. A modeled zero across the
whole prompt is **not a measured provider miss**. Content-prefix matches remain
unchanged; equal text can be useful evidence without being a reusable cache.

Previously cached entries remain available when their configuration returns:

```text
request 1: budget 2048 -> write configuration A
request 2: budget 4096 -> write configuration B; no modeled read from A
request 3: budget 2048 -> read the original configuration A
```

Explicit default thinking modes and effort levels match omission only when the
recorded model has a known documented default. This includes disabled thinking
on Sonnet 4.6, adaptive thinking and medium effort on Opus 5.5, and high effort
on Sonnet 5.5. Model aliases use the existing normalizer. Missing/unknown model
IDs stay unspecified; `--model` changes pricing assumptions, not the original
model's settings identity. Sources: [thinking defaults](https://platform.claude.com/docs/en/build-with-claude/thinking#configuring-thinking)
and [effort defaults](https://platform.claude.com/docs/en/build-with-claude/effort#effort-levels),
checked 2026-10-16. Response thinking display and maximum output length do not
change the reasoning scope. Unrecognized thinking fields remain conservative.
This does not implement complete request validation or prove provider acceptance.

[Per-message effort](https://platform.claude.com/docs/en/build-with-claude/effort#per-message-effort-beta)
can change after the cached prefix on supported models/platforms with the
required beta header. An empty `role: "system"`, `content: []` message carrying
`output_config.effort` now remains an inspectable structural unit. It contributes
no invented text tokens, occupies no content-block lookup position, and cannot
receive an automatic or hypothetical cache marker. Its header affects the
prefix of subsequent content. Appending it preserves earlier cache entries;
editing it blocks reuse past that position. The raw inspector download retains
the complete original message.

## Controlled observations

These are synthetic application requests serialized by the actual Anthropic
Python SDK 1.15.0 over a mock HTTP transport. No provider was contacted. The
fixed mock reply is not a model completion or a token/cache measurement.
[`captures/manifest.json`](captures/manifest.json) records SDK/Python/HTTP
implementation versions and exact compressed/uncompressed hashes. Twelve
workflows cover changed settings, explicit defaults, unchanged histories,
key-order changes, output-limit controls, unknown model defaults and message
effort. The unknown model is a defensive import control, not a supported-model
claim.

| Second request | Baseline modeled reads | Corrected modeled reads | Corrected 5m writes |
| --- | ---: | ---: | ---: |
| Sonnet 4.6 budget 2048 -> 4096 | 10,151 | 0 | 10,151 |
| Sonnet 4.6 thinking off -> enabled | 10,151 | 0 | 10,151 |
| Opus 4.6 effort high -> medium | 10,151 | 0 | 10,151 |
| Opus 5.5 effort-only message high -> low | 10,166 | 10,151 | 15 |
| Opus 5.5 explicit defaults | 10,151 | 10,151 | 0 |
| Appended effort-only message | 10,151 | 10,151 | 17 |

The budget example's simulated second-request input cost changes from
$0.0030453 to $0.03806625 under the conservative scope and this checkout's
Sonnet 4.6 input rates. This is not an observed bill. Both simulation scenarios
conserve the estimated token total and preserve the same setting boundaries.

[`before.json`](results/before.json) and [`after.json`](results/after.json)
retain all reports. Four documented-boundary failures and the conservative
unknown-default control disagreed with expected boundaries before; all twelve
agree after. These controls are not a census or a provider accuracy study.

## Reproduce

From the repository root:

```sh
npm ci
node studies/thinking-settings/replay.mjs /tmp/thinking-replay.json dist --verify
node dist/cli/index.js analyze studies/thinking-settings/captures/budget-change.jsonl.gz --verbose --json /tmp/thinking.json --html /tmp/thinking.html
```

To regenerate only the synthetic SDK body captures:

```sh
uv run --no-project --with anthropic==1.15.0 studies/thinking-settings/capture.py
```

The replay also accepts an installed package's `dist` directory. It checks the
retained input hashes, compares explicit expected prefix boundaries, verifies
token conservation and records compiled implementation hashes. It does not
use the cache simulator itself to compute those expected boundaries.

Browser verification disconnects before the first local import, checks the
actual JSON download against the CLI's complete report, opens the actual HTML
download from disk and inspects the empty message's original JSON. It runs in
Chromium and Firefox at 1440 and 375 pixels, with axe, keyboard and page-width
checks. Start a production preview, then run:

```sh
npm run build
npm run preview:web -- --host 127.0.0.1 --port 4334 --strictPort
# In another terminal:
node studies/thinking-settings/browser.mjs http://127.0.0.1:4334/contextscope/ /tmp/thinking-browser --verify
```

## Limits

The simulator still estimates tokens, assumes requests arrive within the TTL,
and does not reproduce hidden prompt rendering or thinking-block stripping.
Configuration equality is not evidence that an actual cache hit occurred.
The default table is a dated Claude API assumption, not a historical or
cross-platform default guarantee. Unknown fields can cause conservative misses.
The repair does not infer provider feature support, beta headers, historical
prices or actual response settings from a body alone.
