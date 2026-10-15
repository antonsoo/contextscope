# First local analysis offline

A production page that had displayed its file chooser still needed a lazy
presentation module and tokenizer worker when the first file arrived. Disconnect
before that first import and both browsers failed. Chromium cached the failed
module import: reconnecting and submitting another file still failed until a page
reload. Firefox recovered on retry. The previous README promised offline use
after a first analysis; this change extends that boundary to the ready file
chooser and removes the warm-up requirement.

Baseline: `7782eb5951d10f502fbf63f0daeee8186fc54d90`.

## Behavior and cost

Presentation helpers now ship with the initial app. Startup fetches the existing
self-contained worker, rejects HTTP/MIME/UTF-8 errors and waits for its `ready`
message before retaining its source. It then terminates that validation worker
and revokes its blob URL. No analysis job is submitted. Each actual operation
still gets a fresh disposable worker and releases its tokenizer/request state.

File intake appears after preparation. Loading can be cancelled; failed or
timed-out preparation offers **Retry loading**. Retrying forces a fresh worker
download even when a broken 200 response had long-lived immutable cache headers.
Application code is retained in the open tab, without a service worker or stored
user data. Latin font faces used by results/inspectors are requested early too;
optional font failures do not block analysis.

| Measured production asset | Before | After |
| --- | ---: | ---: |
| Entry JavaScript, uncompressed bytes | 79,983 | 84,429 |
| Separate presentation JavaScript, bytes | 3,792, fetched on first import | Included in entry |
| Tokenizer worker, uncompressed bytes | 2,099,516, fetched on first import | 2,099,546, fetched before intake |
| Unique initial response bodies, bytes | 206,566 | 2,326,336 |
| Initial response files | 7 | 9 |

Initial response totals include HTML, CSS, JavaScript and Latin fonts, counted
once per URL. They exclude HTTP/TLS overhead and compression, and are not a wire
throughput benchmark. All four browser/viewport observations agreed on these
byte totals. `readyMs` is retained as a single local diagnostic per view, not a
speed claim. A slow connection now delays file intake while the existing 2.1 MB
analysis asset loads. Reloading or opening an uncached built-in example can still
need a connection. Other font subsets may use fallback fonts offline.

## Native histories and actual downloads

This reuses four unmodified [OpenAI SDK captures](../message-boundaries/README.md)
from Python 3.12.12 / OpenAI 3.23.0. These are synthetic histories sent through the
actual SDK over a mock HTTP transport, not production traffic, provider token
usage, inference calls or observed cache hits. Compressed and original JSONL
hashes are checked against the existing capture catalogue before replay.

`browser.mjs` serves the original and corrected production builds in fresh
Chromium 153.0.8010.12 and Firefox 155.0 contexts at 1440px dark / 375px light.
It disconnects before the first import. For the corrected build it also stops
the HTTP server before that action. The baseline CLI analyzes the same four
native files to provide the unchanged report oracle.

| Observation | Before | After |
| --- | ---: | ---: |
| Cold first-import failures, four browser/viewport views | 4 | 0 |
| Chromium reconnect-and-retry failures, two views | 2 | 0 |
| Actual JSON reports equal to baseline CLI, four files per view | 16 after warm-up/recovery | 16 without warm-up |
| Actual HTML downloads opened offline | 16 | 16 |
| Original refusal-message downloads equal to native source | 4 | 4 |
| Startup analysis jobs | 0 | 0 |
| Live workers after preparation | 0 | 0 |

The corrected startup audit records one created/terminated worker, one
ready message, zero started messages, zero submitted jobs and one revoked blob
URL. All actual analysis workers and their blob URLs are released too. Corrected
views have no late/failed network requests, external requests, page errors, CSP
violations, axe violations or document overflow. Both served bytes and actual
browser response bodies match their production build files. The baseline's
expected failed lazy-module request is retained rather than suppressed.

[Full receipt](results/receipt.json) retains the original CLI controls and all 32
JSON/HTML export observations plus eight original-message downloads. Repeated
downloads are stored once by SHA-256 under `results/artifacts/`; each observation
references its actual bytes. This isolates loading behavior: the reports retain
the original CLI's analysis, including its limitations, rather than establishing
new provider accuracy.

## Startup fault recovery

`startup.mjs` uses an actual HTTP server and real module workers, with no routed
fetch mocks. It serves the first worker request as one of six controlled faults:
HTTP 503, HTML 200, truncated JavaScript 200, invalid UTF-8 200, a held download,
or valid JavaScript that never announces readiness. Fault bodies use
`Cache-Control: public, max-age=31536000, immutable` where a body is sent.

All **24** combinations (six faults, both browsers, both widths) recovered.
Intake remained unavailable during the fault, preparation sent no analysis jobs,
cancelled or failed workers terminated, and Retry loading obtained corrected
bytes at the same URL. The held-download and silent-worker cases exercise manual
cancellation. Each recovered page then disconnected, stopped its server and
completed its first native gzip import; its actual JSON download equalled the
baseline CLI. The automatic 30-second timeout is not separately timed by this
study. [Fault receipt](results/startup/receipt.json) retains headers, controlled
bodies, request counts and worker audits.

## Reproduction

Build a clean archive of the baseline separately with its committed lockfile.
From the corrected checkout, after `npm ci` and `npm run build`:

```sh
node studies/first-offline/browser.mjs /path/to/baseline/web/dist web/dist studies/first-offline/results
node studies/first-offline/startup.mjs web/dist studies/first-offline/results/startup
python3 studies/first-offline/verify.py
```

`browser.mjs` needs the baseline's built `dist/cli/index.js` alongside its web
build. Use the repository's Playwright browsers. The driver creates fresh
contexts, runs the real tokenizer and opens actual downloaded reports. The
verifier checks retained download/fixture hashes and cross-links, not a mocked
implementation of loading.

All **141** generated CLI/library runtime, declaration and source-map files
remain byte-identical to the baseline ([manifest](results/core-unchanged.json)).
This is a browser change; it adds no package or CLI capability. A clean 588-file
archive of source `43bafcd98e912b171d2a564c3925f892907d1d88` passed `npm ci`, lint,
typecheck, all 556 unit checks in default and German locales, the production build,
all 98 browser checks and the retained-evidence verifier on Node 24.21.0. Archive
files stayed unchanged. Its web build is byte-identical to the Node 26.7.0 build
served in this study. [Commands, full logs and file manifests](results/verification/receipt.json)
record those checks.

The local packed artifact's 97 files match the clean build and a separate
installation. Its 94 shipped runtime/declaration files match the original
unchanged CLI/library; an actual installed Node 20.0.0 analysis of the native
refusal history equals the baseline report. [Package receipt](results/verification/package.json)
retains hashes and sizes. No registry release or hosted deployment accompanies
this source record.

Source `e73f00794caf2fb9dba69f41a99f6cb3331d70ec` is public on `main`. An
independent remote-head read and pinned raw downloads verified all **77** files
changed since the baseline, byte for byte against the committed local files.
The [public-source receipt](results/public-source.json) records those hashes and
URLs. A chunked Git HTTP transfer preserved the original commits without a force
push or temporary remote branch; the server confirmed unpack and ref update.
This verifies source publication, not a registry release or hosted build.

## Screenshots

All twelve real screenshots were opened and inspected. The existing mono-led
dark desktop and light mobile layout remains readable, with no document
overflow; startup uses the same palette and controls with one clear retry action.

| View | Chromium | Firefox |
| --- | --- | --- |
| Original first import, desktop | [Failure](../../docs/assets/first-offline/before-chromium-1440.png) | [Failure](../../docs/assets/first-offline/before-firefox-1440.png) |
| Corrected first import, desktop | [Report](../../docs/assets/first-offline/after-chromium-1440.png) | [Report](../../docs/assets/first-offline/after-firefox-1440.png) |
| Original first import, mobile | [Failure](../../docs/assets/first-offline/before-chromium-375.png) | [Failure](../../docs/assets/first-offline/before-firefox-375.png) |
| Corrected first import, mobile | [Report](../../docs/assets/first-offline/after-chromium-375.png) | [Report](../../docs/assets/first-offline/after-firefox-375.png) |
| Startup retry, desktop | [Recovery](../../docs/assets/first-offline/startup-chromium-1440.png) | [Recovery](../../docs/assets/first-offline/startup-firefox-1440.png) |
| Startup retry, mobile | [Recovery](../../docs/assets/first-offline/startup-chromium-375.png) | [Recovery](../../docs/assets/first-offline/startup-firefox-375.png) |
