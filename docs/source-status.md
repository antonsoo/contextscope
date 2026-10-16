# Source, package and demo status

The CLI/library package and the hosted app are separate artifacts. A source
commit or local package test does not establish what the registry or public
site serves. Each study retains its tested revision and its verification scope.
No new npm release was performed for the corrections listed here.

The current source also preserves [unresolved OpenAI stored context](../studies/stored-context/README.md).
Its clean build, installed package and offline browser workflows are verified;
the public-demo receipt below predates this additional repair.

| Current source and demo capability | Retained evidence |
| --- | --- |
| First local import and exports work offline after intake is ready; failed preparation can retry | [Startup and worker recovery](../studies/first-offline/README.md) |
| Refusals and empty history headers remain part of prompt identity | [Native SDK message boundaries](../studies/message-boundaries/README.md) |
| Claude thinking/budget/effort settings isolate cache scopes; empty per-message effort remains inspectable | [Reasoning boundaries](../studies/thinking-settings/README.md) |
| Structured-output formats and citation enablement affect the correct prompt-cache levels; calibration forwards their controls | [Injected prompt settings](../studies/injected-settings/README.md) |
| Encoded media does not become text-token totals or fabricated cache costs; captured usage remains available | [Media accounting and nullable types](../studies/media-accounting/README.md) |

The cold-start behavior retains only application code between worker jobs.
Once file intake is available, the first local import and report exports work
offline in that open tab. Reloading the site or opening an example not already
downloaded can still need a connection. Startup downloads and validates the
tokenizer worker; no request content is retained for starting fresh workers.

The registry was checked independently on 2026-10-16: its `latest` tag was
`0.3.3`, published 2026-10-03. The [registry receipt](../studies/media-accounting/results/registry.json)
records the public tarball's SHA-256 and verifies its registry SHA-512 integrity.
Use the [source quickstart](../README.md#quickstart) for the current corrections.

The [public demo](https://antonsoo.github.io/contextscope/) was updated from
tested source `ecc601b2c83cf93b509ad2d4ea61e493201cc508`. Its
[canonical HTTP receipt](../studies/media-accounting/results/hosting.json)
compares all 42 production files with the clean build, without cache-busting
queries. The [hosted browser receipt](../studies/media-accounting/results/hosted-browser.json)
checks 32 complete export workflows across Chromium/Firefox and desktop/phone
widths, including first imports after disconnecting, original downloads,
invalid-setting retention and text recovery. These controlled SDK workflows
are not measurements of provider token usage or cache behavior.

Source and local package verification remain separate from that public HTTP
check. The [source receipt](../studies/media-accounting/results/publication.json)
pins twenty-four public raw files at the published source revision. No new npm
version was published.
