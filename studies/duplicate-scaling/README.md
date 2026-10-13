# Faster duplicate review for long histories

At baseline `2c52d63`, duplicate review compared each distinct eligible text
with earlier groups even when their word shingles could not meet the 0.85
Jaccard threshold. On the constructed 2,000-block history below, this step alone
took 67.41 seconds on Node 24.21.0. The candidate index reduces it to 2.69 seconds
with identical findings. This is a source improvement; npm remains at 0.3.3.

[cases.mjs](cases.mjs) constructs deterministic **synthetic stress inputs**,
not captured users or representative production traffic. Each sparse block has
50 lines of distinct measurements with shared wording. The mixed case inserts
an exact repeat and three successive configuration edits. The dense control has
250 distinct texts that all match; the exact control repeats one text 2,000
times. Large stress inputs can exceed the selected model's context window;
Contextscope still needs to finish reviewing the file and report that limit.

## Candidate filtering and its limits

Identical text is still pooled first. Below 64 distinct eligible texts, the
direct comparison remains. Larger requests get a temporary index of prefixes
of their **shingle sets**, ordered by increasing frequency within the request,
with lexical ties. These are not character prefixes of the prompt. Only each
cluster's first content is indexed. Candidate IDs are sorted back into creation
order; every member still has to pass the original complete-link comparison.

For a set of size `n`, retain its first `n - floor(0.85*n) + 1` shingles, capped
by the set's length. If two prefixes share nothing, their first shared shingle
must be beyond one prefix. That set then has at most `floor(0.85*n) - 1` shared
elements, too few for Jaccard >= 0.85. Thus the index can exclude the pair without
losing a qualifying match. Using `floor` conservatively retains an extra element
at nonintegral thresholds. A common total order is essential; frequency only
affects selectivity. This uses the general inverted index strategy described by
Bayardo, Ma and Srikant in
[Scaling Up All Pairs Similarity Search (WWW 2007)](https://www.bayardo.org/ps/www2007.pdf),
not all the algorithms in that paper.

The source-order greedy partition remains order-dependent and does not enumerate
every qualifying pair. Similarity does not establish that content is removable.
No token accounting, cache rule, parser, report field, display wording,
dependency or package version changed. Dense candidates still require pairwise
comparisons; there is no general linear-time or universal speedup guarantee.

## Retained measurements

Duplicate review only, including shingling and indexing, excluding parsing and
tokenization. Three repetitions in a fresh process per case/version; version
order alternated between cases. Medians in seconds:

| Constructed history | JSON bytes | Before | After | Groups |
| --- | ---: | ---: | ---: | ---: |
| 100 distinct blocks | 369,468 | 0.108 | 0.061 | 0 |
| 500 distinct blocks | 1,891,068 | 5.153 | 0.376 | 0 |
| 2,000 distinct blocks | 7,697,068 | 67.409 | 2.689 | 0 |
| 2,000 blocks, exact repeat and edit chain | 7,698,198 | 36.446 | 2.243 | 2 |
| 2,000 copies of one text | 7,208,068 | 0.0036 | 0.0028 | 1 |
| 250 mutually similar distinct texts | 1,331,708 | 0.217 | 0.167 | 1 |

[comparison.json](results/comparison.json) and the individual `before-*` /
`after-*` receipts retain all samples, input/output hashes and process peaks.
[host.json](results/host.json) records Node 24.21.0, Ryzen 7 7800X3D,
14 available CPUs and WSL2. Node 26 exploratory timings differed; these numbers
are specific to the retained runtime and workloads.

The index costs memory. On the 2,000-distinct-block case, process peak RSS was
426,952 KiB before and 618,164 KiB after. This includes imports, input, parsing
and all repetitions, with normal garbage collection; it does not isolate live
index memory. Exact repeats already used pooling and remain inexpensive.

## Output preservation

- All six complete duplicate-output hashes match before and after.
- [oracle.mjs](oracle.mjs) independently builds exhaustive complete-link groups
  without an index, hash identity or length filter. All 240 seeded histories
  match in membership/order, exact/near kind, minimum score and review tokens.
  They include frequency ties, varied set sizes, repetition, shuffled edit
  chains and the exact 17/20 boundary. Both implementations agree with the
  reference; these are preservation checks, not newly fixed findings.
- The existing [public trajectory audit](../duplicate-evidence/README.md) was
  rerun against both builds. All **466 groups across 240 terminal snapshots**
  match completely, with zero below-threshold pairs or misstated minima.
  [public-corpus.json](results/public-corpus.json) retains original/reconstructed
  source hashes and each output digest. Both input hashes were checked against
  the existing reconstruction receipt before analysis. This does not reassess
  provider behavior or cache accuracy.
- The actual CLI processes all six inputs and generates JSON and offline HTML.
  [Before](results/cli-before.json) and [after](results/cli-after.json) retain
  complete report hashes: all JSON bytes agree; all HTML bytes agree except the
  single checked generation timestamp. CLI times include startup, tokenization,
  all analyses and both reports, with one observation per case.

## Reproduce

From a built checkout, use these same scripts with each build's `dist` directory:

```sh
node studies/duplicate-scaling/benchmark.mjs dist sparse-2000 /tmp/duplicate-bench.json 3
node studies/duplicate-scaling/oracle.mjs dist /tmp/duplicate-oracle.json
node studies/duplicate-scaling/replay.mjs dist /tmp/duplicate-cli /tmp/duplicate-cli.json
node studies/duplicate-scaling/browser.mjs . /tmp/duplicate-cli /tmp/duplicate-browser.json /tmp/duplicate-screens
```

The browser command needs Playwright browsers and a production web build. It
warms code with a small input, disconnects, then imports the 7.7 MB mixed history.
Package scripts also accept `dist` from a separately installed tarball. The
public corpus uses the pinned manifest and reconstruction instructions in the
existing study:

```sh
node studies/duplicate-evidence/audit-corpus.mjs dist /tmp/reconstructed-corpus . /tmp/duplicate-corpus.json
```
