# Cache accounting and report exports: local verification

Checked source revision `8c8ae8b` on 2026-10-09 (America/Los_Angeles), on
14-logical-CPU WSL2 Linux `6.18.40.1-microsoft-standard-WSL2`. Later changes in
this work record verification only; the runtime implementation is in `5b01adc`
and `48db62e`.

## Defects and retained evidence

- A later Anthropic cache hit used to overlap an earlier billed write. The
  [controlled example](cache-accounting.md) contains 5,939 estimated input
  tokens; the second request previously accounted for 9,575. It now accounts
  for 5,939, with zero writes. Both 5-minute and 1-hour earlier markers are covered.
- Lookup included one extra position. Tests now check 19, 20 and 21 appended
  positions against the documented window, and share the position map with findings.
- An optimized fifth marker could create later hits without being charged on
  its first request. The optimizer now moves the final marker when four slots
  are occupied and respects eligible block types.
- Invalid marker configurations stop analysis before fabricated costs or cache
  state are created. Two older test fixtures were corrected: rolling markers
  must be removed from previous turns, and automatic/explicit TTLs must agree.
- Request-only browser reports had no whole-report download controls. These
  controls are now independent of optional response-usage inspection.

The [study](../studies/cache-accounting/README.md) retains before/after data,
the complete example exports and 240 reconstructed trajectory hashes. All
10,555 historical requests retain the same actual and optimized predictions;
neither version violates token conservation on that corpus. That is regression
evidence, not evidence that the repairs improve prediction accuracy on these
histories. The controlled cases demonstrate the corrected behavior.

## Clean checkout

A detached checkout of `8c8ae8b` had no pre-existing dependencies or build output.
With Node 26.7.0 / npm 12.0.1:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser
```

All passed: 386 tests in 34 files and 70 browser workflows across Chromium and
Firefox. `npm run build` emits the library/CLI to `dist/` and the static site to
`web/dist/`, with base `/contextscope/`. Nothing was deployed.

The same 386 tests also passed under Node 24.21.0. A subsequent fresh `npm ci`,
lint, both TypeScript checks and production build under Node 24.21.0 passed.
The lockfile and checkout remained clean. Browser execution used Playwright
1.63.0 and the existing installed browsers; no browsers were downloaded.

The new browser workflow checks the actual worker's calculation, compares
downloaded JSON with the library, opens exported HTML offline, and checks
recovery after a conflicting-TTL import while preserving the prior analysis.
It also checks accessibility and page overflow at 1440px/dark and 375px/light.
Existing browser coverage continues to check both themes, input cancellation,
network/worker failures, calibration, paging, and CSP behavior.

Offline mode in this new workflow applies to exports. Imports are tested online:
Playwright request routing disables the HTTP cache, so that test setup cannot
use it to load a replacement worker while offline.

## Installed artifact

`npm pack` from the clean checkout produced a local tarball, then `npm install
--ignore-scripts` installed it into a separate empty prefix. The installed CLI,
not repository source imports, ran all six bundled examples and wrote JSON and
HTML for each on Node 20.0.0, 24.21.0 and 26.7.0. All 18 invocations succeeded.
Both simulation scenarios conserve each request's tokens. The corrected example
has the expected 5,939 reads, zero writes and USD 0.0017817 estimated input cost
in the second row. On every Node version an invalid five-marker request exited
1, emitted no normal report and left an existing output file unchanged.

- Tarball: `antonsoloviev-contextscope-0.3.3.tgz`, 86,636 bytes.
- SHA-256: `c6583d1eea30e6958955f25b6ac472ff57569537a43824bfff3dc368731fb02a`.
- [Installed results](../studies/cache-accounting/installed-verification.json).
- [Repeatable installed check](../studies/cache-accounting/verify-installed.mjs).

The tarball retains the repository's existing version metadata. It is a local
build with unreleased changes, not a registry release. The authenticated
`--calibrate` endpoint was not contacted; no model inference calls were made.

## Screenshots and scope

The [terminal output](assets/cache-accounting-terminal.png),
[desktop cache table](assets/cache-accounting-browser.png), and
[phone download controls](assets/cache-accounting-exports-mobile.png) are actual
renders of the controlled example. All were inspected. The new controls fit the
phone viewport; the existing six-column cache table remains horizontally
scrollable. Screenshot bytes were unchanged in the final clean-checkout run.

Claude tokens and costs remain simulated estimates. No live cache expiry,
eviction, concurrent completion, or provider-side prompt rendering was tested.
Mixed-model pricing remains a documented limitation. No push, tag, package
publication or hosted deployment was performed.

Suggested repository description: "Inspect LLM request logs, prompt-cache reuse,
and reported token usage locally."
Topics: `llm`, `prompt-caching`, `anthropic`, `openai`, `tokenizer`,
`developer-tools`, `cli`.
