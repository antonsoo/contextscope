# MCP references do not establish the model's tool context

The previous analyzer counted an OpenAI MCP declaration or Anthropic MCP
toolset as ordinary JSON text. It ignored Anthropic's server declarations.
Two matching request bodies could therefore claim finite input totals and a
cache hit without the remotely imported tool definitions. Changing only an
Anthropic server URL still produced the same full simulated cache read.

The correction preserves MCP configuration and protocol items as unmodeled
units. Ordinary visible text keeps its counts. Whole-request totals, context
percentages and sequence cache partitions/costs stay unavailable. Captured
usage remains separate, including reported zero reads. Original units remain
inspectable, and scalar calibration cannot invent missing prompt segments.
Provider detection also recognizes MCP declarations in model-less captures.

This is a bounded unsupported-feature result. Pinned tool lists and returned
listings supply more data, but this estimator does not implement their MCP
rendering, configuration merging or deferred loading either. They remain
inspectable rather than becoming a token count of their transport JSON.
Ordinary function definitions and quoted MCP-shaped data keep their existing
behavior. This is not full API request validation.

Standalone Anthropic MCP tool-use/result blocks and Responses MCP call and
approval protocol items receive the same unsupported-context treatment. Their
transport records remain inspectable without being counted as prompt text.

The provider formats and imported-tool behavior are documented in the primary
[Anthropic MCP connector guide](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
and [official OpenAI documentation](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).
Both APIs can introduce tool definitions beyond the server connection settings
in a request. A recorded catalog is data, not a local implementation of the
provider's prompt renderer or proof of a cache hit.

## Native SDK bodies and a real metadata source

[`capture.py`](capture.py) uses actual Anthropic 1.15.0 and OpenAI 3.35.1 SDK
serialization over HTTPX2 2.14.0 MockTransport. Thirteen workflows retain 26
request records: eleven MCP cases and two ordinary local-tool controls.
Anthropic layouts cover current toolsets, server changes, deferred/pinned
configuration, deprecated server configuration and a returned native tool
listing. Responses layouts cover remote declarations, server changes and a
returned native listing. Both have a public-catalog endpoint case.

The replies, IDs, returned listings and paired usage counters in these SDK
captures are **authored mock controls**. No provider or MCP server is contacted
by that capture program. SDK serialization establishes wire shape, not live
API acceptance, model inference, real cache outcomes or measured charges. The
deprecated layout is retained defensively without claiming current acceptance.

Separately, [`catalog.mjs`](catalog.mjs) performs actual read-only `tools/list`
discovery from `https://developers.openai.com/mcp` with MCP SDK 1.31.0. Its
[`ledger`](catalog.json) records one complete page, five tools and a
3,366-byte decoded snapshot on 2026-10-18. It retains names, sizes and hashes;
full decoded metadata stays in the ignored local cache. This is a real catalog
outside the request configuration, not an observed provider import. It is not
inserted into the analyzer, and no model or MCP tool is invoked by discovery.
The two public-endpoint SDK cases still receive authored mock replies.

## Before and after

The baseline is `17bcb353fb596170a448e39cf3c0e69c92a67e06`.
[`replay.mjs`](replay.mjs) checks input hashes, invokes the actual library and
CLI, exports JSON and HTML, and verifies raw source retention and usage
counter paths. SDK mock input counters are 12,000/12,400 for Anthropic and
12,000/12,000 for Responses, with zero/400 reported cache reads. They are not
measurements against which estimator accuracy is claimed.

| Workflow | Previous second-request simulated read | Corrected result |
|---|---|---|
| Anthropic local tools | 19,454 | Entire report unchanged |
| Anthropic server switch or same server | 19,413 | MCP totals and cache unavailable |
| Anthropic public-catalog reference | 19,413 | MCP totals and cache unavailable |
| Anthropic deferred toolset | 19,426 | MCP totals and cache unavailable |
| Anthropic pinned toolset | 19,477 | MCP totals and cache unavailable |
| Anthropic deprecated server layout | 19,394 | MCP totals and cache unavailable |
| Anthropic returned tool listing | 19,514 | MCP totals and cache unavailable |
| Responses local tools | 9,600 | Entire report unchanged |
| Responses same-server or public-catalog reference | 9,600 | MCP totals and cache unavailable |
| Responses server switch | 0, with finite totals and cost | MCP totals and cache unavailable |
| Responses returned tool listing | 9,600 | MCP totals and cache unavailable |

All eleven unsupported finite estimates are withheld; both complete local-tool
reports remain unchanged. The MCP CLI gate changes from 0 to 2 with
`--fail-on warning`; controls stay at 0. The reports retain captured counters
without inventing an estimate-minus-observation comparison. The two APIs'
different input-counter conventions remain distinct.

## Reproduction

```sh
# Optional fresh read-only metadata discovery; supply a pinned MCP SDK install.
node studies/mcp-context/catalog.mjs /path/to/@modelcontextprotocol/sdk/dist/esm
uv run --script studies/mcp-context/capture.py
npm run build:core
node studies/mcp-context/replay.mjs /tmp/mcp-before /path/to/baseline/dist before
node studies/mcp-context/replay.mjs /tmp/mcp-after dist after
node studies/mcp-context/browser.mjs URL /tmp/mcp-browser after
```

The retained catalog ledger allows SDK capture and analysis to run without new
metadata discovery. After refreshing it, run capture again so its ledger hash
matches the manifest. `replay.mjs` also accepts an installed package's `dist`.
Browser selectors `anthropic` and `openai` can run separately. Each checks
actual imports, downloaded JSON against CLI output, reopened standalone HTML,
original raw configuration, phone width and accessibility. Anthropic calibration
must refuse unresolved MCP context. Processing runs offline after a local-tool
control bootstraps the worker and tokenizer.

Receipts under [`results`](results/) establish the before/after behavior of these
retained inputs. Source, packed installs and public delivery require separate
verification. No npm release or tag is implied by a local build.

The retained browser receipts compare the previous public app with the local
corrected build: seven selected workflows in Chromium and Firefox at 1440 and
375 pixels, 28 complete imports per phase. All 56 JSON/HTML downloads in each
phase match CLI output and reopen offline. The corrected phase additionally
checks 20 original-configuration downloads. Accessibility violations, page
errors and HTTP requests after bootstrap are zero. The screenshots were opened
and inspected; the phone cache table keeps its existing horizontal scroller.
