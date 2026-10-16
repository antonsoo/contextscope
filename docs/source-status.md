# Source, package and demo status

The CLI/library package and the hosted app are separate artifacts. A source
commit or local package test does not establish what the registry or public
site serves. Each study retains its tested revision and its verification scope.
No new npm release was performed for the corrections listed here.

| Source capability | Retained evidence |
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

The studies' local browser and installed-artifact checks do not establish a
hosted update. Public-demo verification is recorded separately when its served
bytes and browser workflows have been checked.
