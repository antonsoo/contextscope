# ContextScope input integrity and browser verification

Local maintenance, 2026-10-04. Baseline: `3d249da`; verified implementation:
`8c4e5db`. Package version remains `0.3.3`; the changes are recorded under
Unreleased. Nothing was pushed, deployed, tagged or published.

## Problems reproduced and changes

The baseline passed 223 tests. A new 18-case counterexample suite initially
failed 17 cases: silently overwritten JSON fields, nonfinite numbers, excessive
depth, lost prototype-like schema properties, lost wrapped requests, incorrect
provider selection and fabricated complete coverage. Subsequent cases exposed
omitted malformed prompt fields, unsafe calibration totals and nonzero numbers
rounded to zero. These were verified against current code before changing it.

| Local Beads ticket | Implemented behavior | Evidence |
| --- | --- | --- |
| `officina-ymf` | Reject duplicate/escaped-equivalent keys, overflow, nonzero underflow and more than 128 JSON containers; retain `__proto__` schema properties | Input integrity cases; native JSON/depth boundaries; independent packaged consumer on Node 20 |
| `officina-4hw` | Choose one request body per record, retain original record/line/envelope, reject ambiguous or mixed-provider captures, retain malformed prompt content | Mixed raw/object/string wrapper cases; leading blanks/skipped lines; provider override and long-history cases |
| `officina-3ml` | Surface incomplete coverage in API, JSON, HTML, terminal and browser; fail every configured CI gate for incomplete input | Real CLI subprocesses return 2 for all three severity gates with zero findings; browser source-line assertions |
| `officina-e2d` | Move analysis/calibration off the UI thread, terminate cancelled/replaced/reset workers, reject unreadable results and preserve recovery | Worker lifecycle tests; actual production-worker CPU cancellation; startup/script failure; stale import and calibration workflows |
| `officina-d1x` | Bound treemap/table/inspector DOM while keeping complete totals and raw downloads | Independent category/token sums over 4,000 segments; production 1,205-segment paging/filtering; long raw JSON download equality |
| `officina-86z` | Inherit the page CSP through a disposable blob module importing only the same-origin analysis bundle | Injected off-origin worker fetch blocked by `connect-src`; positive browser policy evidence; bootstrap URL cleanup assertions |

The parser uses native JSON syntax validation followed by an iterative lexical
integrity scan before parsed values enter downstream analysis. Integrity failures
are fatal even in JSONL; malformed syntax lines remain visible as skips. It does
not conflate a skipped syntax record with an assigned request index.

Worker processing and ownership follow this sequence:

```text
selected input -> bounded read/decompression -> disposable analysis worker
                                               |
                          parse + tokenize + simulate + local calibration
                                               |
                             validated reply + current-operation check
                                               |
                                  replace browser workspace

cancel / reset / newer selection -> terminate worker + revoke bootstrap URL
startup / input / reply failure  -> preserve prior valid workspace + recovery
```

The established IBM Plex typography, treemap category colors, themes and
workspace structure remain. New segment controls wrap on phone layouts.

## Compatibility and evidence semantics

- `ParseResult.complete`, `sourceRecords` and `skippedRecords` are additive.
  `complete` describes retained source coverage, not API validity or measured
  cache hits. Non-request records remain visible as zero-segment placeholders.
- Parsed requests have source record index, physical JSONL line where applicable,
  and selected envelope field. Exported JSON retains this metadata without
  including request text.
- `ParseWarning.requestIndex` is now optional. A malformed skipped line has
  `sourceLine` instead; consumers must handle that distinction.
- Empty arrays and ambiguous/lossy JSON that previously produced misleading
  reports now fail with actionable errors. Mixed-provider captures require
  separate analyses; an explicit format override warns and marks mismatches
  incomplete.
- All `--fail-on` thresholds return 2 for incomplete coverage, even without
  findings. Ungated partial analysis remains available with warnings.
- The treemap shows at most 128 individual positive-token segments plus residual
  category blocks (at most 136 controls). Table pages contain at most 100 rows;
  every segment remains reachable. Inspector text is capped at 20,000 characters;
  the download contains the full original parsed segment value as JSON.

## Verification

The final implementation was checked in a detached worktree with a fresh
`npm ci`, Node `24.21.0` and npm `11.19.0`. The existing lockfile was used.
The source checkout also built with Node `26.7.0` and npm `12.0.1`.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser -- --workers=1
git diff --check
```

| Check | Result |
| --- | --- |
| Clean dependency install | Passed; zero audit vulnerabilities reported |
| ESLint and both strict TypeScript checks | Passed |
| Core/CLI/worker/preview suite | 275 tests passed in 29 files; 223 existing plus 52 added |
| Production build | Passed; core JS/declarations and static browser assets generated |
| Full production Chromium/Firefox suite | 56 workflows passed (28 per browser), 5.3 minutes; 52 full-rule axe scans with zero violations |
| Source/clean production artifact comparison | All 35 files have identical SHA-256 hashes |
| Separate installed package consumer on Node 20.0.0 | Passed; only package and runtime dependency installed |
| Whitespace/diff check | Passed |

The original independent `js-tiktoken` tokenizer comparisons and 700 seeded
invariant/fuzz iterations remain enabled. New preview tests independently sum
all input segments and categories rather than asserting only the aggregation
implementation's own result. CLI tests invoke the built executable and inspect
actual exit status and exported files.

Production workflows exercise desktop/375 px, both themes, keyboard tabs,
focus containment/restoration, built-in compressed examples, malformed and
oversized imports, cancellation/replacement/reset, local calibration, recoverable
worker failure, source ownership, bounded views and complete raw downloads.
The worker CPU cancellation tests wait for an actual `started` reply from a
15 MB job, then assert termination and bootstrap URL revocation before recovery.
Browser-context routing rejects unexpected off-origin requests. Each workflow
also checks page errors, unhandled rejections and unexpected page CSP violations.

The worker privacy probe modifies the served analysis asset in the test only.
It attempts a synthetic off-origin fetch with no request contents. Chromium
reports the worker `securitypolicyviolation` event; Firefox emits the positive
`Content-Security-Policy` / `connect-src` block in its console without dispatching
that event inside the blob module. Both checks require positive CSP evidence:
a failed fetch alone could merely mean DNS or route failure. The diagnostic
buffers incoming jobs during its top-level await and replays them after the real
worker handler is installed. Normal app operation does not contain this probe.
This follows the documented [worker CSP inheritance rule](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy).

Early browser runs hit timeouts on this shared machine; the final run uses one
worker, 60-second workflow/15-second assertion timeouts and 120 seconds for each
large built-in example's four full-rule accessibility scans. No accessibility
rules or checks were removed. The initial Firefox privacy failure was traced
to the diagnostic's message timing and missing event delivery; its console and
traffic were inspected before selecting the browser-specific policy evidence.

### Local package consumer

```sh
npm pack --json --pack-destination <temporary-consumer>/artifacts
# In a fresh consumer with the packed file as its sole direct dependency:
npm install --omit=dev --ignore-scripts
# Run using the oldest supported Node binary:
node consumer.mjs
```

The temporary consumer imports the installed package, not workspace source.
It verifies partial JSONL source lines 2 and 5 and skipped line 4; mixed raw/body/
string wrappers; rejection of empty/duplicate/overflow/underflow/mixed-provider
input; exact `Number.MIN_VALUE`/`Number.MAX_VALUE` acceptance and zero with extreme
exponents; distinct prefix evidence for `__proto__` schema changes; and a real
`--fail-on error` CLI exit of 2. Node 20.0.0 passed. The tarball contains 71 entries,
72,023 compressed bytes and 231,035 unpacked bytes, including JS/declarations,
README, changelog and license. It contains no web build, test fixtures or secrets.

### Existing synthetic examples and timing

```sh
node dist/cli/index.js analyze examples/anthropic-agent-cache-bust.jsonl.gz --json <temporary>/flagship.json
node dist/cli/index.js analyze examples/openai-agent-tools-reordered.jsonl --json <temporary>/openai.json
npm run bench
```

| Synthetic fixture | Requests | Complete | Findings | Simulated current USD | Simulated optimized USD |
| --- | ---: | --- | ---: | ---: | ---: |
| Anthropic cache bust | 24 | true | 46 (2 grouped findings) | 2.845968 | 0.4570421 |
| OpenAI tools reordered | 4 | true | 1 | 0.030186 | 0.018666 |

These are simulation outputs, not API bills or observed savings. The default
nine-run benchmark after warm-up measured medians of 700 ms for the 24-request
5.7 MB flagship and 3,933 ms for the generated 300-request 12.1 MB stress session.
This is one observation on the shared 14-vCPU WSL2 Linux / 48 GB machine under
substantial concurrent CPU load (load average reached about 51), not a controlled
comparison or a general performance promise. The benchmark script's stale 2.9 MB
comment was corrected to match its measured 12.1 MB stress input.

### Inspected screenshots

All four are real production-browser captures of synthetic fixtures, manually
opened and inspected. No page errors, unexpected network traffic or document
horizontal overflow occurred. Phone tables retain their own scrolling for
columns/rows; the page itself fits 375 px.

| Screenshot | Evidence |
| --- | --- |
| [Dark source coverage, 1440 px](assets/source-coverage-dark-1440.png) | Skipped line 4, selected original record 3/line 5, incomplete banner above findings |
| [Light source coverage, 1440 px](assets/source-coverage-light-1440.png) | Same source evidence and readable light theme |
| [Dark segment review, 375 px](assets/segment-review-dark-375.png) | Last page of 1,205 segments, wrapped filters/navigation, preserved table scrolling |
| [Light segment review, 375 px](assets/segment-review-light-375.png) | Same phone layout and focus styling in light theme |

The capture harness measured 130 treemap controls and five last-page rows for
the 1,205-segment fixture. The automated workflow separately opens its last
segment and compares treemap token sums with the displayed request total.

### Reproducible build fingerprints

All 35 production files matched between Node 24's clean checkout and Node 26's
source checkout. Representative SHA-256 values:

```text
index.html
43ab34f3eed056d833e123c4f84c6a0bfaf2ae911ddfe25b50f23aa75839e439
assets/analysis-worker-MyXDbnCy.js
15d2de241f892b0b389fd174a9d508fd5b068b9ce18d8dabb00a26795867d6f4
assets/index-BmkwCrTV.js
ce44e72dfcbc5fb4d2e10519a46bf2153486f2f9e9ea3f730186cd955c98331a
assets/index-GH1dGCKJ.css
c923d61d967ec2af4c4b94a0f53a43ec8a1480574c9ff76c9b0f21799324f2e0
assets/presentation-ydxuDuto.js
8e2fcf3848b8d43e6977182adb55726c11d9f9230a18ba382393970c33a9c57f
```

The page JavaScript is 38.09 kB (12.80 kB gzip); presentation helpers 3.85 kB
(1.14 kB gzip); CSS 28.38 kB (4.97 kB gzip). The lazy worker is 2,078.45 kB,
including the exact tokenizer vocabulary. Moving it off the UI thread does not
make that vocabulary smaller.

## Remaining limits and release state

No real provider request, live token calibration, Safari, physical mobile device
or hosted release was tested. Provider selection remains a heuristic, and
completeness is not an API schema validator. Normal finite JavaScript number
rounding remains; the new guards specifically reject overflow and nonzero
underflow. Native JSON allocation precedes the depth scan. Accepted 50 MiB
browser / 500 MiB CLI inputs can still consume substantial memory and time, and
worker results transfer a full retained object graph. Request navigation,
findings and sequence tables remain proportional to their respective data.
Explicit download serialization still runs on the main thread. Raw downloads
preserve parsed segment values, not the original file's whitespace/bytes.
Offline analysis requires the worker asset to have loaded/cached; this is not a
service-worker offline-install guarantee.

This round keeps the existing project direction and improves its evidence and
recovery contracts. It creates no repository and changes no registry version.
The six local Beads tickets were closed/exported after all acceptance checks
passed. The 98-record local export was parsed independently to verify all six
ticket states are `closed`. Only the ContextScope repository is committed; the shared Beads export is
intentionally ignored. Temporary browsers, preview servers and worktree are
removed after verification.

Suggested GitHub description: `Inspect LLM request context, token usage and prompt-cache misses locally, with traceable input evidence.`

Suggested topics: `llm`, `prompt-caching`, `tokenizer`, `developer-tools`,
`cli`, `local-first`, `anthropic`, `openai`.

Implementation history (`git log --oneline 3d249da..8c4e5db`):

```text
8c4e5db test: verify Firefox worker privacy through CSP console evidence
198b7ef test: preserve worker jobs while probing inherited privacy policy
294be3f fix: validate worker result contracts before replacing context state
fd46db5 fix: reject JSON number underflow before losing evidence
4dedddd fix: preserve browser privacy policy inside analysis workers
6576950 docs: explain context source coverage and bounded inspection
a8401e1 test: cover context import integrity and worker recovery
2e48f28 feat: make context analysis cancellable and bound evidence previews
8f51882 fix: preserve request evidence and expose incomplete analyses
```
