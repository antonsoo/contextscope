# Mixed-model logs must keep each model's accounting

Contextscope at `aa04dcc` separated cached content by model, but chose the most
frequent model's prices, cache minimum and context window for every request.
Interleaving unrelated model traffic could change the reported cost of an
otherwise identical request. Missing model names also acted as a wildcard,
allowing a nameless request to read one model's cache and populate another's.

This source change resolves each request independently. Its resolution is
available in `reports[i].model`, the browser and both CLI report formats. The
old top-level `model` and `cacheSimulation.model` fields remain representative
summaries for compatibility; they no longer describe every row's pricing.

## Controlled counterexample

`replay.mjs` creates five synthetic requests with an identical short system
prefix: Sonnet 4.5, Sonnet 4.5, Opus 4.5, Opus 4.5, Sonnet 4.5. The local
estimator counts 3,694 tokens in that prefix plus two uncached user tokens.
No response counters or API measurements are invented.

| Request | Captured model | Previous read / write / plain | Corrected read / write / plain | Previous USD | Corrected USD |
| --- | --- | --- | --- | --- | --- |
| 1 | Sonnet 4.5 | 0 / 3694 / 2 | 0 / 3694 / 2 | 0.0138585 | 0.0138585 |
| 2 | Sonnet 4.5 | 3694 / 0 / 2 | 3694 / 0 / 2 | 0.0011142 | 0.0011142 |
| 3 | Opus 4.5 | 0 / 3694 / 2 | 0 / 0 / 3696 | 0.0138585 | 0.0184800 |
| 4 | Opus 4.5 | 3694 / 0 / 2 | 0 / 0 / 3696 | 0.0011142 | 0.0184800 |
| 5 | Sonnet 4.5 | 3694 / 0 / 2 | 3694 / 0 / 2 | 0.0011142 | 0.0011142 |

All writes in this example are five-minute writes. The old total is $0.0310596;
the corrected total is $0.0530469. The independent check is to split the same
requests by model and add the two analyses: this must produce the same rows
and total as the mixed log.

[Anthropic's caching reference](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
specifies the 1,024-token minimum for Sonnet 4.5 and 4,096 for Opus 4.5.
The same page lists their input and cache prices. Checked October 9, 2026.
The numeric oracle in `tests/mixed-models.test.ts` also uses exact controlled
2,000-token blocks to separate billing rules from the heuristic estimator.

```sh
npm ci
node studies/mixed-models/replay.mjs /path/to/aa04dcc/dist studies/mixed-models/before.json
node studies/mixed-models/replay.mjs dist studies/mixed-models/after.json
node dist/cli/index.js analyze examples/anthropic-mixed-models.jsonl.gz
```

The browser's built-in **Model routing** example loads this same compressed
input. Choose an override, then **from each request**, to compare assumptions.

## Historical-body interleaving experiment

`interleave-corpus.mjs` reuses the 240 hash-checked histories reconstructed by
the [cache-accounting study](../cache-accounting/README.md). It creates 40
batches of six histories each, taking one request from each stream in turn.
Every stream keeps its internal order. The experiment changes their ordering
relative to other streams, so it is not a recording of live gateway traffic.

The independent reference uses the **old** analyzer on each model's partition
of a batch. Both old and new analyzers then process the full mixed batch.
Every token bucket and cost in both actual and optimized scenarios is compared
with that reference; metadata must identify the request's own model. These
checks assess isolation and accounting, not agreement with a provider's bill.

The output, `corpus.json`, contains source hashes, implementation hashes,
per-batch counts and totals. The harness checkpoints each batch and refuses
to resume with different compiled code or a different manifest. Only
`complete: true` establishes that all 40 batches ran.

```sh
# Reconstruct sources as described in ../cache-accounting/README.md first.
node studies/mixed-models/interleave-corpus.mjs SCRATCH /path/to/aa04dcc/dist studies/mixed-models/corpus.json 10
# Repeat the same command until complete; the optional 10 bounds each invocation.
```

## Boundaries

- `--model` changes prices, thresholds and context windows for all rows; captured
  names still isolate cache entries. It is a pricing/rules counterfactual, not
  a rewrite of the recorded traffic onto one model.
- Unknown IDs retain the existing explicit provider-default fallback. Each
  affected request is now reported, even when it is a minority of the log.
  Missing names use a separate assumed-model cache group, isolated from named
  models; that assumption is shown in reports.
- Model-switch advice no longer claims that returning to a warm model pays
  full input price. The simulator can read that model's earlier entries.
- Calibration counts the selected/largest request using that request's model.
  Its scale still applies to the whole file; other models and individual
  segments remain estimates. No live counting endpoint was called here.
- OpenAI row prices are now independent too, but its simulator still models
  legacy implicit caching. This work does not implement modern explicit
  breakpoints, write charges or TTL expiry. See the current
  [OpenAI model comparison](https://developers.openai.com/api/docs/guides/prompt-caching#summary-of-model-differences).
- Claude estimates, provider rendering, cache timing and eviction have the
  same limitations as the main README. This experiment does not improve the
  underlying tokenizer or establish live cache hit rates.
