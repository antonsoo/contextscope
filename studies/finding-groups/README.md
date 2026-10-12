# Group findings without changing their meaning

Baseline: `d4c721ce9a26432a406e1df15b27d74ed6e1c235`.

The analysis already distinguished supported fast input pricing, standard-speed
fallback and unavailable pricing. The presentation grouped all three by their
shared `anthropic_speed` kind and empty segment list, keeping the first title,
detail and severity. The result depended on request order.

In the two-request reproduction, JSON contained a pricing warning for request 2.
The terminal and browser instead showed **Fast input pricing (requests 1, 2)**
with informational severity. The browser's issues tile showed `2`, with no
warning indication. In the corrected report it shows `1 warn`, and the two
messages identify their own requests.

| Recorded input in the synthetic fixture | Message that must remain separate |
| --- | --- |
| Opus 5.5, `speed: fast` | Informational fast input pricing |
| Opus 4.6, `speed: fast` | Informational standard-speed fallback |
| Opus 5.5, unrecognized speed value | Warning: speed pricing unavailable |

The supported/fallback distinction follows the current
[Claude fast-mode documentation](https://platform.claude.com/docs/en/build-with-claude/fast-mode),
checked 2026-10-12. These fixtures are **synthetic request bodies**, including a
deliberately unsupported value. No provider requests were made. This change
repairs the display of existing analysis; it does not establish actual billed
costs, response speed, historical prices or provider acceptance of an input.

## Behavior

A group now has one kind, severity, message title and set of implicated segments.
Repeated equivalent findings still collapse into one group. The known
request-pair titles for model changes and tool reordering use their existing
generic title when grouping; individual occurrences retain their original text.
Duplicate-content findings retain their existing per-request scope.

Terminal, interactive web and standalone HTML use the same grouping function.
The browser's occurrence buttons still select the exact request and retain
keyboard focus after rendering it. The raw JSON findings, numerical calculations
and CLI severity gate do not change.

## Reproduction and evidence

The compressed [two-request fixture](fixtures/hidden-warning.jsonl.gz) and
[six-request fixture](fixtures/mixed-speed.jsonl.gz) are ordinary JSONL inputs.
The latter repeats each of the three variants twice to verify both separation
and useful deduplication.

```sh
npm ci
npm run build
node dist/cli/index.js analyze studies/finding-groups/fixtures/hidden-warning.jsonl.gz
node studies/finding-groups/replay.mjs dist /tmp/contextscope-groups \
  /tmp/contextscope-groups.json after
```

`replay.mjs` exercises the real CLI, including JSON/HTML output and a warning
gate. It covers both fixtures and all six orderings of the three variants,
repeated twice. Run it with a separately built baseline's `dist` and `before`
for the comparison. The retained [before](before.json) and [after](after.json)
receipts record all hashes and message memberships:

| Across eight sequences | Before | After |
| --- | ---: | ---: |
| Speed message groups displayed | 8 | 23 |
| Groups with the expected title, severity and exact request membership | 0 | 23 |

The extra groups represent distinct diagnoses, not duplicate messages. All eight
complete JSON reports are byte-identical before/after; all warning gates still
exit 2. The one-function production change affects presentation grouping only.

`browser.mjs` loads the built web app in Chromium and Firefox at 1440px and
375px, then checks request navigation and downloads while offline. It compares
JSON downloads byte-for-byte with CLI output. HTML comparisons exclude only the
generated-at timestamp. It also byte-compares HTTP responses to their build
files and checks page errors, CSP, external requests, overflow and automated
accessibility findings. Automated checks are not proof of accessibility with
every assistive technology.

The [before](browser-before.json) and [after](browser-after.json) browser
receipts each cover eight workflows and ten matched HTTP-served assets. All
five screenshots were inspected, including the
[old merged message](../../docs/assets/finding-groups/before-chromium-1440.png),
[corrected desktop report](../../docs/assets/finding-groups/after-chromium-1440.png)
and [corrected phone report](../../docs/assets/finding-groups/after-chromium-375.png).

Run the browser replay against a locally served build, passing its URL, build
directory, replay receipt, output receipt, screenshot directory and download
directory in that order. All screenshots in `docs/assets/finding-groups` come
from these real browser views. The included `corpus.mjs` compares old and new
grouping over the existing hash-pinned public-trajectory reconstruction; its
result is separate from the synthetic regression evidence.

The [corpus receipt](corpus.json) confirms unchanged grouped output for all
240 reconstructed public trajectories (10,555 requests, 1,068 findings) and all
11 bundled examples. Source bytes and reconstructed request bytes are checked
against the existing manifest. These ordinary inputs do not contain the mixed
message variants in the synthetic counterexample, so this is compatibility
evidence, not a measurement of the defect's prevalence in production.

This correction remains unreleased. Package version 0.3.3 and the hosted demo
are unchanged; no package release or deployment is part of this work.
