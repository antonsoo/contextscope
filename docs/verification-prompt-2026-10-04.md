# Prompt structure, encoding and export verification

Follow-up maintenance on 2026-10-04, starting at `f93a85d`. Implementation tested
at `308bb37`; the final documentation commit follows. This extends the
[previous verification](verification-context-2026-10-04.md). The user subsequently
authorized pushing the ready changes. Package version remains `0.3.3`, with
changes under Unreleased; no registry publication is part of this round.

## Reproduced failures and fixes

| Local Beads ticket | Failure | Fix |
| --- | --- | --- |
| `officina-jj1` | Invalid UTF-8/UTF-16 silently became replacement characters, then received complete coverage | Fatal decoding with explicit re-export instructions, including compressed inputs; valid Unicode and real U+FFFD preserved |
| `officina-rpu` | Category plus counted text erased prompt metadata and message boundaries from cache and conversation identity | Retain prompt block/header/boundary separately; use it consistently for prefix paths, threading and diff; preserve routing IDs and signed/opaque thinking in optimized comparisons |
| `officina-jj6` | Hovered cache-placement badge failed normal-text contrast in light mode | Dedicated readable blue badge text token in explicit and automatic themes |
| `officina-gz0` | Summary JSON omitted full segment text but repeated short prompt values in readable diff previews | Omit prompt identities and textual diffs from summary JSON while retaining numeric matches, source positions, cache steps and findings |

The first counterexample run failed 23 of 29 tests: all 16 initial prompt identity
cases and seven encoding rejection cases. A later short-text JSON export case
also failed before the export fix. The new browser metadata scenario then
exposed the badge contrast failure in both Chromium and Firefox; the full-rule
checks were retained.

Independent before/after observations on the same synthetic request pair:

| Change with identical analyzed text | Before | After |
| --- | --- | --- |
| Anthropic `tool_use_id` destination | 2/2 segments matched; 1,578 simulated read tokens | 1/2 segments matched; zero simulated read tokens |
| Anthropic `is_error` flag | 2/2 segments matched; 1,578 simulated read tokens | 1/2 segments matched; zero simulated read tokens |
| Invalid UTF-8 byte inside JSON string | Accepted as U+FFFD with complete coverage | Rejected before analysis |
| Short private prompt marker in summary JSON | Marker present in diff preview | Marker absent; match boundaries and costs retained |

The token total remains 1,578 for each metadata counterexample; the comparison
fix does not add speculative framing tokens. These are modeled cache results,
not observations from provider requests.

Tool-result routing and error flags are substantive request fields in the
[Claude tool-call documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).
OpenAI message names and tool-call destinations appear in its
[Chat API schema](https://developers.openai.com/api/reference/cli/resources/chat).
No real provider requests or live calibrations were made.

```text
bytes -> strict BOM-aware decoder -> parsed request
                                      |
                   +------------------+--------------------+
                   |                                       |
              analyzed text                         prompt structure
                   |                              block + header + boundary
          counts / duplicates                              |
                                              prefix / cache / thread / diff
                                                           |
                                 local text inspection     |     summary JSON
                                 detailed diff retained    |     text omitted
```

Message start markers preserve boundaries without anchoring content to absolute
message indices, so sliding-window rewrites can still match earlier messages.
String shorthand is comparable with a single text block. Cache-placement
markers remain outside prompt identity. Subsequent assistant tool calls are
separate units rather than part of preceding text. Pure reorder diffs are not
mislabelled as metadata changes. Plain-string paths now point to
`messages[n].content`, while the existing segment ID remains stable.

## Verification

Fresh detached checkout, Node `24.21.0` / npm `11.19.0`, existing lockfile:

```sh
npm ci
npm run lint
npm run typecheck
npm test
LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 npm test
npm run build
npm run test:browser -- --workers=1
npm run bench
git diff --check
```

| Check | Result |
| --- | --- |
| Fresh install | Passed; zero audit vulnerabilities reported |
| ESLint and strict core/web TypeScript | Passed |
| Core, parser, CLI, worker and input tests | 310 passed across 30 files, in both default and comma-decimal locale |
| New tests this round | 35, added to the previous 275 |
| Production Chromium/Firefox workflows | 60 passed (30 per browser), 3.6 minutes; 62 full-rule axe scans with zero violations |
| Independent Node 24/26 build comparison | All 35 production files byte-identical |
| Separate installed tarball consumer, Node 20.0.0 | Passed |
| Actual synthetic CLI fixtures | Passed; original complete coverage and costs retained |

The independent tokenizer comparisons and existing 700 seeded fuzz/invariant
iterations remain enabled. Actual CLI subprocesses verify invalid-byte exit 1
and a JSON export without private prompt previews. The in-memory result is
checked for nonmutation and still retains detailed diffs.

The two added production workflows verify failed plain/gzip/UTF-16 replacements
retain a valid workspace and later Unicode import succeeds, and a valid
tool-result error-flag change matches only 2/3 segments, appears in the diff,
and preserves the original `is_error` value in inspection. The latter runs
full-rule axe in both themes at 1440 and 375 px. Existing CPU cancellation,
worker privacy, import recovery, bounded previews, focus and downloads remain
covered. No accessibility rules were suppressed.

For the cache badge, independently calculated WCAG contrast against the hovered
light row improved from 4.061:1 to 5.386:1. The new blue reaches 6.256:1 against
the ordinary light row; existing dark blue reaches 4.932:1 and 5.107:1 against
the dark raised/inset surfaces respectively.

### Package and example checks

```sh
npm pack --ignore-scripts --json --pack-destination <temporary-consumer>/artifacts
# A separate consumer installs the tarball as its sole direct dependency:
npm install --omit=dev --ignore-scripts
# The consumer harness runs under Node 20.0.0:
node consumer.mjs
node dist/cli/index.js analyze examples/anthropic-agent-cache-bust.jsonl.gz --json <temporary>/flagship.json
node dist/cli/index.js analyze examples/openai-agent-tools-reordered.jsonl --json <temporary>/openai.json
```

The packed implementation contains 73 entries, 74,447 compressed bytes and
239,404 unpacked bytes, including the new prompt-identity JS/declaration files.
It contains no web build or test fixtures. Only the package and its tokenizer
runtime dependency are installed in the consumer. Its resolved import points
inside its own `node_modules`, and checks confirm metadata cache misses,
UUID-shaped routing IDs, unchanged token totals, corrupt-byte CLI rejection and
private-preview-free real JSON export. Packing skips scripts only after the
clean core build has passed; `npm ci` also exercised the package prepare hook.

The synthetic Anthropic fixture retains 24 requests, 46 findings (two grouped),
complete coverage, simulated current USD 2.845968 and optimized USD 0.4570421.
The OpenAI fixture retains four requests, one finding, complete coverage, current
USD 0.030186 and optimized USD 0.018666. Neither exported file contains prompt
identities or textual diffs.

The default nine-run benchmark after warm-up measured medians of 247 ms for the
24-request 5.7 MB flagship and 1,437 ms for the 300-request 12.1 MB stress input.
The shared machine reports 14 CPUs and approximately 48 GB RAM under WSL2 Linux.
Browser checks and other work were running concurrently; these numbers are one
observation, not a controlled comparison with the earlier round or a speed claim.

### Inspected production screenshots

All were opened and inspected. Captures reported no page errors, unexpected
off-origin traffic or document horizontal overflow. Phone tables and the diff
retain their own scrolling.

| Capture | Evidence |
| --- | --- |
| [Dark, 1440 px](assets/prompt-structure-dark-1440.png) | Actual string source path, cache badge, annotated metadata-only diff, zero reads in both scenarios |
| [Light, 1440 px](assets/prompt-structure-light-1440.png) | Same information and readable light-theme badge |
| [Dark, 375 px](assets/prompt-structure-dark-375.png) | Wrapped sequence control and metadata annotation within phone layout |
| [Light, 375 px](assets/prompt-structure-light-375.png) | Matching phone layout with readable light colors |

### Build and release verification

Build command: `npm run build`; CLI/library output: `dist/`; static demo output:
`web/dist/`. Representative SHA-256 hashes, identical in the clean Node 24 and
source Node 26 builds:

```text
index.html
00dcdd05cdf601dd5b8a238b31ab61809275cecfdcd02043966c79e8e6cc6a22
assets/index-6Jf5PZeX.js
436e0b58b1084b73ac84820972f1f50d557a35ec3c26800156dff17ec081a886
assets/analysis-worker-Dlj-TioO.js
78f1fb22f20803cfcd01541c96d6feb31beb543a368dc8100b942f2d8a4c1ce7
assets/index-9rHIamEi.css
a3f72ebaa60cc4d185d3d3cdfc1949eeccc278557af1ca3c4cd7e80e07786a5a
assets/presentation-ydxuDuto.js
8e2fcf3848b8d43e6977182adb55726c11d9f9230a18ba382393970c33a9c57f
```

The source push includes the previous ten verified maintenance commits and
this round's changes. Publication uses ordinary fast-forward pushes to `main`
and the existing `gh-pages` branch, without deleting history or changing Pages
settings. Remote commit equality, hosted file hashes and live browser workflows
are checked after publication; the final response records their outcome.

## Boundaries

`Segment.prefix` is additive/optional for constructed segments. Parsed segments
retain the prompt unit and header; token counts and raw original inspection do
not change. Summary JSON no longer has `prefixMatches[].diff`; consumers needing
text inspection should use the in-memory result or local terminal/HTML output.
Operational names, paths and finding explanations remain in summary exports and
can identify an application, so the export is not a universal secrets scrubber.

Prompt identity is a conservative model of the captured structure, not the
provider's private renderer. Completeness still describes source coverage, not
API validity. Finite numeric rounding, unobserved server history, unknown cache
state/expiry, and potentially expensive large retained result graphs remain
limitations. Safari and physical devices are untested. No npm release or new
repository is created.

Suggested GitHub description: `Inspect LLM context, prompt-cache misses and source evidence locally, with cancellable browser analysis.`

Suggested topics: `llm`, `prompt-caching`, `tokenizer`, `developer-tools`, `cli`,
`local-first`, `anthropic`, `openai`.

Implementation history (`git log --oneline f93a85d..308bb37`):

```text
308bb37 fix: keep cache placement readable across browser recovery states
99a13da fix: preserve prompt structure and redact summary diff previews
8f8e0eb fix: reject corrupt encodings before rewriting request evidence
```
