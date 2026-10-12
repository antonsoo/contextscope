# Distinct record IDs must not become a cache hit

At baseline `f8dcdb0d2f3617b046d29aa42f396e7c4ce9721c`, two requests with
different uint64 identifiers in a tool schema were reported as identical
prompts. Parsing rounded both identifiers to the same JavaScript number;
serialization then wrote a third value into both prompt segments. The report
marked the input complete and predicted a 2,104-token cache read on request two.

The production correction is
`16488ec1968a43c2452d1568a31bae5be1e91e62`. This is source and local installed
artifact evidence. Package version 0.3.3, tags and the hosted demo are unchanged.

## Reproduction through an SDK

[capture.py](capture.py) sends synthetic requests through the actual Anthropic
Python SDK 1.13.0 and captures its HTTP request bodies with `httpx2.MockTransport`.
Socket connections are forbidden. These are actual SDK serializations, with
synthetic prompts and responses; no provider acceptance or live cache behavior
is measured. [Provenance](evidence/sdk-provenance.json) records versions and the
hash of the retained [request bodies](evidence/sdk-requests.jsonl).

| Source enum value | Baseline prompt value | Corrected import |
| --- | --- | --- |
| `18446744073709551614` | `18446744073709552000` | Precision error |
| `18446744073709551615` | `18446744073709552000` | Precision error |

[Before](evidence/replay-before.json) and [after](evidence/replay-after.json)
retain 12 library and actual CLI workflows. Nine inputs require unsupported
precision, including OpenAI schemas, metadata, raw arrays, JSONL and JSON-encoded
request envelopes. The corrected CLI exits 1 before writing a JSON report.
The other three inputs distinguish supported integer IDs, distinguish string
IDs, and preserve equality between equivalent decimal spellings.

## What the check guarantees

Before analysis, the existing JSON integrity scanner compares each source
number's mathematical decimal value with the value written by JavaScript
serialization. It strips insignificant zeros and adjusts the exponent without
converting the coefficient digits to floating point. Ordinary `0.1`, `1.0`,
`1e0` and unchanged large numbers remain supported. Overflow and nonzero
underflow retain their existing errors.

This deliberately checks serialization as well as parsing. For example,
`36028797018963968` is exactly representable in binary, but JavaScript serializes
it as `36028797018963970`. That would change prompt content, so it is rejected.
Conversely, this does not require `0.1` to have an exact binary representation.
Its serialized mathematical decimal value remains `0.1`.

Unsupported precision rejects the entire import, including values in metadata.
JSONL does not silently skip the record, and nested string request bodies receive
the same check. This is an explicit analysis limitation, not arbitrary-precision
support or a recommendation to rewrite numeric schema values as strings.

## Independent and compatibility checks

[decimal-oracle.py](decimal-oracle.py) uses Python `Decimal` to compare source
literals with the actual JavaScript serialization returned by [numbers.mjs](numbers.mjs).
The [1,975 retained cases](evidence/numbers.json) combine integer boundaries,
precise decimals, subnormals, exponent variants and seeded generated controls.

| Numeric cases | Baseline | Corrected |
| --- | ---: | ---: |
| Value-preserving cases accepted | 1,065/1,065 | 1,065/1,065 |
| Value-changing cases rejected | 35/910 | 910/910 |
| Outcomes matching Decimal | 1,100/1,975 | 1,975/1,975 |

The [baseline](evidence/decimal-before.json) lists its 875 mismatches; the
[corrected receipt](evidence/decimal-after.json) has none. This is a controlled
precision check, not a prevalence estimate or proof for every possible input.

[compatibility.mjs](compatibility.mjs) verifies the original source hashes and
reconstructed request hashes from the existing
[public-trajectory study](../real-trajectories/README.md). All 10,555 request
records from 240 Anthropic trajectories parse to identical values before and
after. This replay checks parsing of every reconstructed record, not a new
provider prediction benchmark. Full analysis JSON also remains byte-identical
for all 11 repository examples. [Receipt](evidence/compatibility.json).

## Browser and installed behavior

[browser.mjs](browser.mjs) exercises Chromium 153 and Firefox 155 at 1440 and
375 pixels, with the server stopped and the browser offline after loading.
Each context performs 13 candidate uploads (including gzip), 14 actual JSON
report downloads, and a fresh pasted string-envelope import. All ten affected
file imports per context now fail while preserving the previous complete
report. Valid controls still load, and a fresh rejected paste creates no
dashboard. There are no page exceptions or post-shutdown HTTP requests.

The [before](evidence/browser-before.json), [after](evidence/browser-after.json)
and [clean-build](evidence/clean-browser.json) receipts retain these outcomes.
All eight [screenshots](screenshots/) were inspected. The corrected screenshots
show the precision error above the **previous supported analysis**; the dashboard
is not a result for the rejected input. Mobile tables retain their existing
horizontal scrolling.

A clean archive passes locked installation, lint, strict typechecking, 486
unit tests, a production build and 90 existing browser scenarios on Node 24.21.0.
The documented bundled-example CLI command also runs from that archive.
[Verification receipt](evidence/verification.json).

A separate installation of the locally packed npm artifact passes all 12
library/CLI workflows and all 1,975 Decimal cases on Node 20.0.0 and 24.21.0.
Receipts: [Node 20 workflows](evidence/installed-node20.json),
[Node 24 workflows](evidence/installed-node24.json),
[Node 20 Decimal](evidence/decimal-node20.json),
[Node 24 Decimal](evidence/decimal-node24.json).
[Artifact comparison](evidence/artifacts.json) verifies 158 build inputs,
180 build files, all 95 installed package files and all ten served browser
assets. The exercised browser results also match the clean build exactly.

## Reproduce

After `npm ci && npm run build`, from the repository root:

```sh
python3 studies/numeric-integrity/decimal-oracle.py generate /tmp/numbers.json
node studies/numeric-integrity/numbers.mjs dist /tmp/numbers.json /tmp/numbers-result.json
python3 studies/numeric-integrity/decimal-oracle.py verify /tmp/numbers-result.json /tmp/decimal-result.json
node studies/numeric-integrity/replay.mjs dist /tmp/numeric-replay.json
node studies/numeric-integrity/browser.mjs . /tmp/numeric-browser.json
```

To recapture the synthetic SDK requests, install `anthropic==1.13.0` and
`httpx2==2.13.1` in an isolated Python environment, then run
`python studies/numeric-integrity/capture.py /tmp/sdk-capture`.
The browser script uses the installed Playwright engines. For baseline
comparison, build the baseline commit separately, pass its `dist` or repository
path to the scripts, and add `baseline` after the output path.

The compatibility script takes baseline checkout, corrected checkout, the
existing reconstruction directory containing `reconstruction.json` and `bodies/`,
and an output path. It requires the original hash-verified trajectory cache.
`verify-artifacts.py` takes clean checkout, corrected checkout, installed package
directory, tarball and output path. None of these commands calls a model API.
