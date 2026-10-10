# Several cache markers must not bill the same tokens twice

This study reproduces a cache-accounting defect in source commit `7ecec70`, then
replays 240 previously sampled public Claude trajectories as a regression check.
The repairs are local source changes, not a published package update.
The [verification record](../../docs/verification-cache-accounting-2026-10-09.md)
covers clean installs, browser downloads and installed CLI checks on Node 20/24/26.

## Controlled counterexamples

[`replay.mjs`](replay.mjs) generates five synthetic request sequences, including
the [compressed example](../../examples/anthropic-cache-breakpoints.jsonl.gz).
[`before.json`](before.json) was reproduced from a freshly compiled checkout of
`7ecec70`; [`after.json`](after.json) records the corrected calculation.
The CLI's complete [JSON report](example-report.json) and
[offline HTML report](example-report.html) retain the corrected example.

| Case, second request | Before | Corrected |
| --- | ---: | ---: |
| Add an earlier 1h marker beneath an existing hit: excess billed tokens | 3,636 | 0 |
| Add an earlier 5m marker beneath an existing hit: excess billed tokens | 3,636 | 0 |
| Append 19 lookup positions: tokens read | 1,700 | 1,700 |
| Append 20 lookup positions: tokens read | 1,700 | 0 |

The first request in the four-occupied-slots case used to leave its tail
uncached, yet register a hypothetical fifth cache entry for subsequent requests.
The corrected optimizer moves the last existing marker, preserves its TTL,
and consistently accounts for the resulting coverage. Tests also reject invalid
configurations before any simulated state is created.

The oracle is the provider's documented disjoint billing partition and inclusive
lookup window, independently applied to 2,304 transitions between the 48 valid
four-block marker arrangements. The [implementation notes](../../docs/cache-accounting.md)
link the primary specification and describe the rules. None of these controlled
cases was sent to a live API; costs use estimated tokens and the repository's
price table.

```sh
npm ci
node studies/cache-accounting/replay.mjs studies/cache-accounting/after.json
npx vitest run tests/cache-accounting.test.ts tests/cache-configuration.test.ts
```

Pass a compiled older version as the second argument to `replay.mjs` to reproduce
the baseline. The script also recreates the compressed example deterministically.

## Historical corpus: no changed predictions

The six Claude groups in the existing
[real-trajectory manifest](../real-trajectories/manifest.json) contain 240
trajectories and 10,555 reconstructed requests. We checked every original
trajectory's SHA-256 and rebuilt the requests through the recorded mini-SWE-agent
versions and LiteLLM 1.104.2, intercepting the HTTP send. This uses the existing
[reconstruction harness](../real-trajectories/reconstruct_claude.py), not a new
approximation of its request preparation. The rebuilt bodies have their own
hashes in [`corpus.json`](corpus.json).

| Measure | Result |
| --- | ---: |
| Trajectories | 240 |
| Requests | 10,555 |
| Changed actual simulation rows | 0 |
| Changed optimized simulation rows | 0 |
| Token accounting violations, either version | 0 |
| Predicted hit/no-hit agrees with captured outcome, either version | 10,431 / 10,555 |
| Reported cache-read tokens | 205,535,739 |
| Simulated cache-read tokens, either version | 195,982,596 |

This sample does not exercise the repaired edge cases. Its unchanged results
are evidence against regressions in the previously studied agent workflow,
**not evidence of improved prediction accuracy**. Outcome agreement is only a
binary comparison; the token totals still differ. Requests are reconstructed
from public historical trajectories, not captured live by this run. The
[original study](../real-trajectories/README.md) describes the sampling and
reconstruction limits.

The upstream source checkouts used for reconstruction:

| Tag | Commit |
| --- | --- |
| v1.13.3 | 55356a3645b2aa1f92662b21461d4f20122bcea0 |
| v1.16.0 | 1cd08db041bf5093484aefdc1b375df1d00a91ad |
| v2.0.0 | ce91a8c6449bc5a686df8f6b7ee8ca9433d893bc |

To repeat the corpus comparison, obtain the original manifest's source files
using the original study's instructions. Prepare a scratch directory containing
`src/mswe-v1.13.3/`, `src/mswe-v1.16.0/`, `src/mswe-v2.0.0/`, and a `venv/`
with that study's reconstruction dependencies. Then, from the repository root:

```sh
python3 studies/cache-accounting/reconstruct.py "$CACHE_STUDY_SCRATCH"
git worktree add --detach "$CACHE_STUDY_SCRATCH/baseline" 7ecec70
# Install and build that worktree with npm ci; build this checkout with npm run build:core.
node studies/cache-accounting/compare-corpus.mjs "$CACHE_STUDY_SCRATCH" "$CACHE_STUDY_SCRATCH/baseline/dist" studies/cache-accounting/corpus.json
```

The reconstruction driver verifies original hashes, runs each harness with an
isolated configuration environment, rejects incomplete reconstructions, and
records a hash of every reconstructed sequence. The comparison checks those
hashes again, checks both scenarios' token partitions on every request, and
retains all changed rows (none in this replay). Downloaded source and rebuilt
request bodies stay outside the repository; no credentials or model calls are
needed.
