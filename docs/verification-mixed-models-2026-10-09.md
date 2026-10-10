# Mixed-model verification - October 9, 2026

Runtime change: `02e2bcc`. Baseline: `aa04dcc`. Both compiled from source.

The controlled five-request example used to bill the second Opus 4.5 request
at $0.0011142 with 3,694 cache reads. It now bills $0.01848 with all 3,696
estimated input tokens uncached. The prefix is below Opus 4.5's 4,096-token
minimum; Sonnet requests retain their separate 1,024-token minimum and price.

The [replay study](../studies/mixed-models/README.md) retains inputs, before/after
rows and a hash-checked 240-history interleaving experiment. All 10,555 mixed
requests match independent model-separated analysis in both scenarios. The
old analyzer differed in 12,378 of the 21,110 compared rows, including 858
different token partitions. These are synthetic interleavings of reconstructed
historical bodies, not live cache measurements.

## Actual workflows

- Node 26.7.0: lint, both TypeScript projects, 395 tests and production build.
- Chromium and Firefox: 72 browser workflows passed. New coverage imports the
  built-in mixed-model example, overrides and restores model detection,
  calibrates an Opus request with its own model, and downloads JSON and HTML
  while offline. The HTML is opened through `file://` and its rows inspected.
- Desktop 1440px dark and mobile 375px light: inspected real screenshots,
  no Axe violations, no horizontal page overflow. The complete cache table
  scrolls horizontally on mobile; model names remain on one line.
- Detached clean checkout of `02e2bcc`: fresh `npm ci`, lint, both TypeScript
  projects, all 395 tests and production build under Node 24.21.0.
- Packed that clean checkout and installed the tarball in an empty prefix.
  All seven checked-in examples produced token-conserving JSON and offline
  HTML under Node 20.0.0, 24.21.0 and 26.7.0 (21 runs). Invalid Anthropic
  marker input exited 1 and preserved an existing destination report.
- The installed mixed-model checks verify per-request model metadata, the
  $0.01848 Opus row, saved HTML and CLI calibration. A preload replaces fetch
  before CLI imports and asserts the request/model sent to the counting
  adapter. The largest request uses its minority Opus model; an explicit
  override uses the selected model. Six mocked calibration runs made zero
  provider calls.

Tarball: `antonsoloviev-contextscope-0.3.3.tgz`, 87,733 bytes,
SHA-256 `f39c6494b473e0f99eefec7f37a21c7510bef87d7568f0efcdeefe93e10ba756`.
The version number is unchanged; this local tarball is not a registry release.

Reproduction commands:

```sh
node studies/cache-accounting/verify-installed.mjs INSTALL_PREFIX OUTPUT_DIR NODE20 NODE24 NODE26
node studies/mixed-models/verify-installed.mjs INSTALL_PREFIX OUTPUT_DIR NODE20 NODE24 NODE26
```

Machine-readable results are retained in
`studies/mixed-models/installed-verification.json` and
`studies/mixed-models/mixed-installed-verification.json`.

## Limits

No live inference or counting API was called. Claude counts remain heuristic;
calibration still scales the whole file. Unknown model IDs retain explicit
provider-default assumptions. Model aliases share their canonical cache
identity; unnamed requests share a separate assumed-model group. Cache
eviction and elapsed TTL are not modeled. The legacy OpenAI simulation remains
a separate follow-up; this change fixes row selection, not that cache regime.

Publication was checked separately: source `dbd7e15` and the verified Pages
build `11db69b` were pushed on October 9. Chromium opened the live mixed-model
example and verified the $0.0185 Opus row with no page errors. The later
[OpenAI cache change](verification-openai-cache-2026-10-09.md) replaces that
deployment while retaining this behavior. No npm publication or version tag
was created.
