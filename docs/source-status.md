# Source, package and demo status

The CLI/library package and the hosted app are separate artifacts. A source
commit or local package test does not establish what the registry or public
site serves. Each study retains its tested revision and its verification scope.
No new npm release was performed for the corrections listed here.

| Current source and demo capability | Retained evidence |
| --- | --- |
| First local import and exports work offline after intake is ready; failed preparation can retry | [Startup and worker recovery](../studies/first-offline/README.md) |
| Refusals and empty history headers remain part of prompt identity | [Native SDK message boundaries](../studies/message-boundaries/README.md) |
| Claude thinking/budget/effort settings isolate cache scopes; empty per-message effort remains inspectable | [Reasoning boundaries](../studies/thinking-settings/README.md) |
| Structured-output formats and citation enablement affect the correct prompt-cache levels; calibration forwards their controls | [Injected prompt settings](../studies/injected-settings/README.md) |
| Encoded media does not become text-token totals or fabricated cache costs; captured usage remains available | [Media accounting and nullable types](../studies/media-accounting/README.md) |
| Stored OpenAI history, prompt templates, input references and opaque reasoning remain unresolved; captured counters stay separate | [Stored-context boundaries](../studies/stored-context/README.md) |
| Anthropic and Responses MCP references, configurations and protocol items retain unknown totals and cache costs; visible text and captured usage remain inspectable | [MCP context boundaries](../studies/mcp-context/README.md) |

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
tested source `6dd0252`. Its
[canonical HTTP receipt](../studies/mcp-context/results/hosting.json)
compares all 42 production files with the clean build, without cache-busting
queries. The [hosted browser receipt](../studies/mcp-context/results/hosted-browser.json)
checks 28 MCP/local-tool imports across Chromium/Firefox and desktop/phone
widths, with 76 JSON, HTML and original-configuration downloads after
disconnecting. Earlier [stored-context workflows](../studies/stored-context/results/hosted-browser.json)
remain separate retained evidence. These controlled SDK workflows
are not measurements of provider token usage or cache behavior.

Source and local package verification remain separate from that public HTTP
check. The [stored-context source receipt](../studies/stored-context/results/publication.json)
pins twenty public raw files; the [media source receipt](../studies/media-accounting/results/publication.json)
retains twenty-four files at its earlier revision. No new npm version was published.
