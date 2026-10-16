# Keep encoded media out of text token counts

At baseline `6fc3ca1`, the same 1240 by 304 screenshot produced Claude request
totals of 8,095 or 457,130 tokens depending only on PNG compression. A URL to
the original PNG produced 57. The parser was tokenizing base64, URLs and file
references as text, then using those numbers for context percentages, cache
thresholds, costs and comparisons with captured provider usage.

The source correction preserves media blocks and structural identity while
making unsupported token counts explicit. Encoded payloads are excluded from
text tokenization. A missing model-specific media count is `null`, never zero.
This study does not estimate actual image tokens or provider charges.

## A compression counterexample

[`cache-table.png`](captures/cache-table.png) is an owned Contextscope screenshot.
The second PNG changes IDAT compression while preserving the complete inflated
scanline stream and all other PNG chunks. [Pillow 12.2.0 independently decodes](results/media-proof.json)
both to identical RGBA pixels. The public immutable URL was fetched separately
and matched the original bytes. No image reference is fetched by the analyzer.

| Representation | Image bytes | Baseline Claude request total | Corrected total |
| --- | ---: | ---: | --- |
| Original inline PNG | 19,976 | 8,095 | Unavailable |
| Same pixels, uncompressed PNG | 1,131,337 | 457,130 | Unavailable |
| Public URL to the original PNG | Reference only | 57 | Unavailable |
| Synthetic Files API reference | Opaque ID | 25 | Unavailable |

The file ID is a synthetic opaque reference; no file was uploaded or resolved.
For the identical PNGs, the baseline OpenAI text counter also changes from
17,699 to 212,483. Those are transport-text counts, not evidence of visual-token
consumption. The compression change cannot justify the old 45.71% context-window
claim. The corrected request percentage is unavailable.

[Claude's vision documentation](https://platform.claude.com/docs/en/build-with-claude/vision#resolution-and-token-cost)
describes resolution-based visual tokens and model-specific resizing.
[OpenAI's image guide](https://developers.openai.com/api/docs/guides/images-vision)
also describes image-specific processing and token accounting. PDFs can add
extracted text and page images ([Claude](https://platform.claude.com/docs/en/build-with-claude/pdf-support),
[OpenAI](https://developers.openai.com/api/docs/guides/file-inputs)). A tokenizer
over their encoded JSON is not a substitute for those transformations. Sources
checked 2026-10-16; no provider formula is implemented by this repair.

## What remains available

| Evidence | Result with unmodeled media |
| --- | --- |
| Original JSON and content identity | Preserved, including exact encoded payloads |
| Countable segments | Their original text counts remain available |
| Affected segment/category and request totals | `null`; human reports display `n/a` |
| Request context-window fraction | Unavailable |
| Structural prefix matches | Preserved; matched token count is null if it includes media |
| Cache partitions and costs | Unavailable for the whole sequence |
| Captured usage and original counter paths | Preserved, including measured zero |
| Comparison requiring an unavailable side | Unavailable; no invented delta or hit/miss agreement |

The whole-sequence cache limit is conservative and deliberate. Unknown lengths
can affect cache thresholds and entries written by earlier requests. Skipping
one media row and then treating the next row's cache as empty would manufacture
a different cache history. This implementation withholds the simulation rather
than attempting a partial cache-state model. Even unaffected text-only rows in
that sequence have unavailable cache partitions; their own token totals remain
available.

Treemaps include only segments with counts. Media remains in the segment table
and original-source inspector, with an explanation that omission is not zero
cost. Mixed text/media blocks are withheld as a unit, so this is not a complete
sum of all text embedded inside media containers. Scalar calibration refuses
an unmodeled media request before a provider call or replacement browser report.
A whole-request measurement cannot recover the missing segment distribution or
cache boundaries. `countTokensBody` still preserves the native request content
for callers who need the counting endpoint's body.

## Scope and controls

The [manifest](captures/manifest.json) retains seventeen controlled workflows
serialized by actual Anthropic 1.15.0 and OpenAI 3.23.0 Python SDKs over mocked
HTTP transports. Native wire bodies are retained as written by the SDK. Paired
log records embed that body beside a controlled SDK reply's usage. All reply
usage values are **synthetic controls**, not provider measurements. No provider
was contacted, and SDK serialization does not prove live-server acceptance.

Fourteen workflows contain media: Anthropic images, PDF references, images in
tool results/custom documents; OpenAI Chat images, files and input audio;
Responses images, file references, function results and computer screenshots.
Three controls quote media-shaped JSON as literal text. These remain fully
countable and their complete reports match the baseline byte for byte.

The parser follows content grammar only. It does not mistake tool inputs,
schema examples, quoted JSON or response citation arrays for supplied media.
Inline text documents remain countable. Unknown server-side context, future
content types and provider rendering are outside this targeted media correction;
this is not complete request validation or multimodal accounting support.

The [baseline](results/before.json) disagrees with fourteen expected workflows;
the [corrected reports](results/after.json) preserve every expected unavailable
state and all three text controls. The synthetic usage controls retain 1,200
input tokens and 400 cache reads per response while withholding the local
comparison. A separate zero-read control ensures a recorded zero remains known.

The separately installed [public registry 0.3.3 tarball](results/registry.json)
also reproduces transport-dependent counts in both native formats. Its
[consumer result](results/registry-behavior.json) gives Claude totals of 6,679
and 377,133 for the identical PNGs. The source baseline above uses a refitted
text estimator, so its numbers differ from the release. This source work does
not publish a new registry version.

## Source library and JSON contract

This changes the unreleased source types. Consumers must check nullable token
fields before arithmetic; replacing null with zero misstates the result.
`Segment.openaiTokens`, `Segment.claudeTokensEstimate`, request/category totals,
prefix token counts, cache token partitions and local usage-comparison counts
now use `number | null`. Costs and context fractions retain their existing
`undefined` unavailable state (omitted from JSON).

`Segment.unmodeledContent` identifies excluded media kinds. Cache steps and the
sequence carry `unavailableReason`. `parse.complete` continues to describe
source-record coverage; a complete JSON log can still have unavailable media
token counts. A user-supplied calibration scale does not turn null into a count.

```ts
const report = result.reports[0]!;
const count = report.totals.openaiTokens;
console.log(count === null ? "Token total unavailable" : `${count} text tokens`);
```

## Reproduce

From a source checkout:

```sh
npm ci
node studies/media-accounting/replay.mjs /tmp/media-replay.json dist --verify
node dist/cli/index.js analyze studies/media-accounting/captures/anthropic-image-transports.jsonl.gz --verbose --json /tmp/media.json --html /tmp/media.html
```

The replay checks input hashes, explicit unknown segment paths, cache partitions,
original captured counters and complete text controls. It accepts a separately
installed package's `dist` directory. Decoder verification and SDK regeneration:

```sh
uv run --no-project --with pillow==12.2.0 studies/media-accounting/verify-media.py --check-url
uv run --no-project --with anthropic==1.15.0 --with openai==3.23.0 studies/media-accounting/capture.py
```

`--check-url` fetches only the immutable public screenshot reference. Omit the
flag for offline decoding checks. Poppler, when installed, also reads the valid
one-page PDF control; its extracted text is retained in the decoder receipt.

The [timing receipt](results/performance.json) records five alternating fresh
Node 24.21.0 processes per implementation on this 14-logical-CPU WSL2 machine.
Median gunzip plus analysis of the four-image transport workflow fell from
2,456.95 ms to 90.63 ms. Median process peak RSS fell from 199,572 to 131,388 KiB.
This excludes module loading, CLI/browser startup and network. It is one
controlled input, not a general throughput claim. Reproduce with:

```sh
node studies/media-accounting/benchmark.mjs BASELINE_DIST CURRENT_DIST /tmp/media-performance.json
```

Browser verification disconnects before the first import, compares full JSON
downloads with the CLI, reopens actual HTML exports, downloads original media,
checks calibration refusal and restores ordinary analysis with a text control.
Chromium and Firefox run at 1440 and 375 pixels with axe and page-width checks:

```sh
npm run build
npm run preview:web -- --host 127.0.0.1 --port 4339 --strictPort
# In another terminal:
node studies/media-accounting/browser.mjs http://127.0.0.1:4339/contextscope/ /tmp/media-browser --verify
```

## Clean build and installed artifact

Tested source: `ecc601b2c83cf93b509ad2d4ea61e493201cc508`. A clean Git archive
with a fresh Node 24.21.0 install passed lint, strict core/web typechecking,
611 unit checks, the production build and all 110 Chromium/Firefox checks.
The [artifact receipt](results/verification.json) compares 116 pinned source/build
inputs, all 103 installed package files and all 42 served production files.
The timing run's compiled analysis modules match this clean build.

A separately installed source tarball reproduces all seventeen workflows
byte for byte on Node 24.21.0 and Node 20.0.0. Its actual `contextscope` executable
works through npm's installed bin link on both runtimes. Three native-format CLI
JSON reports match source. Anthropic and Responses CLI HTML equals the actual
browser downloads after normalizing only the one generation timestamp.
Configured warning gates exit 2; unsupported calibration exits 1 with a media
diagnostic, no stack trace and the existing report file unchanged. An ordinary
text control still exits successfully and matches the complete source report.

The [browser receipt](results/browser.json) retains eight export workflows and
four recovery imports per phase. Final workflows also check media calibration
refusal, original compressed-image JSON downloads and keyboard inspection.
There were no page exceptions, HTTP requests after disconnecting, axe violations
or page-width overflow in those workflows. Actual [image JSON](results/browser-anthropic-image-transports.json),
[image HTML](results/browser-anthropic-image-transports.html),
[synthetic-usage JSON](results/browser-responses-reported-usage.json) and
[synthetic-usage HTML](results/browser-responses-reported-usage.html) are retained.

| View | Screenshot |
| --- | --- |
| Baseline counts compression bytes as context | [Before](../../docs/assets/media-accounting/before.png) |
| Corrected whole-request totals and context use are unavailable | [After](../../docs/assets/media-accounting/after.png) |
| Phone explanation of omitted media | [Finding](../../docs/assets/media-accounting/finding-phone.png) |
| Phone cache partitions remain unavailable | [Cache](../../docs/assets/media-accounting/cache-phone.png) |
| Synthetic captured usage remains known beside unavailable estimates | [Usage](../../docs/assets/media-accounting/usage-phone.png) |

All five retained screenshots were opened and inspected. The established layout
remains readable at both widths; long counter paths wrap on phones. Source
record coverage, captured counters, unavailable model estimates and missing
optional counters remain distinct.

`check-installed.mjs CONSUMER OUT NODE20` exercises the installed binary and
library. `verify-artifacts.py SCRATCH BASE_URL` rechecks the clean source,
package, downloads and served bytes. These receipts establish local artifact
behavior. Source publication and public hosting are separate checks.

## Published source and public demo

Source revision `35612f6579a0858943479c239330922f69632409` was pushed to
`main` with the owner's authorization. The [source receipt](results/publication.json)
compares twenty-four immutable raw-file responses with local bytes. The tested
clean build was separately pushed to `gh-pages` at
`44fcb2be4c61447b6438cf9e059aa279343084e4`.

After the canonical page refreshed, [all 42 production files](results/hosting.json)
matched the clean build byte for byte, without query-string cache busting.
The [hosted browser receipt](results/hosted-browser.json) records 32 passing
export workflows across the media, injected-setting and thinking-setting
studies, in Chromium and Firefox at 1440 and 375 pixels. Actual downloaded JSON
matches the retained source reports; actual HTML exports reopen offline.
Original blocks remain downloadable, invalid-setting imports retain the prior
workspace, and subsequent valid text imports recover. No page exceptions,
HTTP requests after disconnection, axe violations or page-width overflow
occurred in these workflows. The actual [hosted JSON](results/hosted-media.json)
and [hosted HTML](results/hosted-media.html) are retained.

This verifies the public app's behavior on controlled SDK inputs, including
synthetic usage counters. It does not measure provider token/cache behavior or
publish a new registry release. The npm observation remains separate above.
