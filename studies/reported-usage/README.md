# Reported-usage reconciliation on public trajectories

The earlier [real-trajectory study](../real-trajectories/README.md) compared
provider usage outside the product. This study checks the product's new reader,
coverage accounting, discrepancy labels, source positions and summary export
against the captured response fields themselves.

## Data and method

Use all 520 files pinned in [the existing manifest](../real-trajectories/manifest.json),
from 13 public mini-SWE-agent submissions to SWE-bench. `verify.py` verifies
each SHA-256 before reading it and fails if any file or response is missing.
Sources are neither resampled nor filtered by the analyzer's result. No model
API is called. The manifest's URLs and source/license discussion remain in the
original study; raw trajectories and reconstructed captures stay in ignored
`cache/`, not in this repository.

There are two distinct checks:

1. **Usage normalization:** Python reads the raw response fields directly.
   Node passes the same usage objects through Contextscope's same-record
   response adapter. Python checks input/read/write/output values and the
   original cache-read path. This includes OpenAI Responses captures whose
   full request history cannot be reconstructed. It checks their counters,
   not their token estimates or cache simulation.
2. **Complete request analysis:** Reconstruct all 120 stateless OpenAI Chat
   trajectories, using the same role/content history and response model as
   the Portkey harness. Run each JSONL sequence through `analyze()` and
   `toJsonReport()`. Python independently checks every retained counter,
   simulation-minus-reported arithmetic,
   read outcome, physical line, cohort membership and aggregate. It also
   checks the previously established exact token-count relation on all 2,205
   requests. These are separate Node processes so tokenizer caches do not
   accumulate across trajectories.

The full-analysis phase does not reconstruct Claude requests or stored
Responses history. It does not claim to verify live cache rules. The captured
values come through the original providers' client/gateway stacks, so the
analysis retains those stacks' limitations.

At the time of this study, these older dated OpenAI model IDs used an explicitly
reported pricing fallback. The later [cache-mode work](../openai-cache/README.md)
adds GPT-5.1/5.2 prices and rechecks all 2,205 requests without changing these
input/read comparisons. Neither study reports a measured bill.

## Results

Measured locally on 2026-10-08, on the 14-vCPU WSL2 machine. The initial run took
39.30 seconds. [results.json](results.json) records per-entry counts, each full
trajectory's outcomes, source file hashes and the manifest hash.

| Check | Scope | Disagreements |
|---|---:|---:|
| Original response usage to normalized counters | 17,425 responses, 520 files | 0 |
| Reconstructed requests through analysis and JSON export | 2,205 requests, 120 files | 0 |
| OpenAI input estimate versus reported input | 2,205 requests | 0 |

The reconciliation correctly exposes differences between the simulation and
the captured cache behavior; those differences are not test failures:

| OpenAI Chat read comparison | Requests |
|---|---:|
| Both zero | 120 |
| Both positive, not necessarily equal | 1,373 |
| Simulated hit / reported zero | 712 |
| Reported hit / simulated zero | 0 |
| Unavailable | 0 |

Across these requests, reported input is 29,719,513 tokens. Reported cache reads
are 19,420,544 tokens, versus 27,557,632 simulated reads over the identical
cohort. The new report makes the 8,137,088-token gap and its contributing
requests inspectable. It does not infer why the provider served fewer tokens.

### A gateway ambiguity found during verification

Native Anthropic input is uncached + read + creation. In Chat-shaped Claude
gateway responses, historical `prompt_tokens` fields do not consistently
include creation. In 91 sampled responses, creation alone exceeds the gateway
prompt count, so treating every `prompt_tokens` as total input would reject or
misrepresent real captures.

The product now withholds total input in 10,048 Claude gateway responses with
positive cache creation, while retaining their cache-read/write/output counters
and the original prompt field. It does not try to infer a gateway version from
a model name or filename. The 507 responses with explicitly zero creation have
unambiguous input totals. Both behaviors are checked against the raw source.

## Browser and CLI inspection

`20251211_mini-v1.17.2_gpt-5.2-2025-12-11/django__django-14725.traj.json`
provides a manageable real example: 24 requests, with 15 simulated hits whose
recorded read count is zero. Its reconstructed capture is 1,635,811 bytes.

The production browser workflow was checked in Chromium and Firefox at 1280
pixels/dark and 375 pixels/light. The downloaded JSON matched the CLI export
field for field. Each browser's downloaded HTML opened through `file://` while
offline and retained all 24 counter sections. All six accessibility scans
(four workspace, two offline report) had zero axe violations; page errors and
external requests were zero. [Screenshots and workflow](../../docs/reported-usage.md)
show the actual derived counters, without redistributing prompt text.

The synthetic browser regressions separately cover incomplete JSONL, invalid
and absent counters, request/filter keyboard focus, 54-request pagination,
exports that retain off-page requests, and both themes at 375 and 1440 pixels.
The original request-only workflows remain covered by the existing suite.

## Reproduce

```sh
npm ci
python3 studies/reported-usage/verify.py --fetch
```

`--fetch` downloads only missing files named by the committed manifest and
checks each hash before saving it. It does not resample or rewrite the manifest.
To use an existing download, omit `--fetch` and optionally pass `--source-cache PATH`.
`--node PATH` selects the Node binary. The verifier invokes the compiled core
created by `npm ci`; after source edits run `npm run build:core` first. Missing,
changed or unsupported source records stop verification rather than producing
a partial success report. Re-running replaces only this study's ignored
intermediate files and its results JSON.

To retain the capture used in the screenshots for local inspection:

```sh
python3 studies/reported-usage/verify.py --keep-capture 20251211_mini-v1.17.2_gpt-5.2-2025-12-11/django__django-14725.traj.json
node dist/cli/index.js analyze studies/reported-usage/cache/review-capture.jsonl --json review.json --html review.html
```

Drop the retained JSONL into the locally built browser app to inspect the same
requests. The capture contains source prompt text and stays gitignored.
