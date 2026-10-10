# Anthropic cache-setting verification, 2026-10-10

Implementation: local commit `8dc5d2b`, based on `4d2183d`. No push, tag,
deployment, or package publication was performed. Version metadata remains
0.3.3; verification below concerns a local npm tarball.

## Observed defect

Three identical synthetic prompts switching `tool_choice` from `auto` to
`any` and back previously predicted full 5,202-token reads on both later
requests. The corrected second request reads only the separately marked
2,778-token tools/system prefix and writes the 2,424-token message prefix.
The third request can reuse the earlier `auto` entry. Adding an explicit
image beyond a previously marked prefix produces the same message-scope
invalidation. The optimized scenario retains those settings.

The [study](../studies/cache-settings/README.md) includes the input generator,
before/after receipts, hashes, scope/default rules, source documentation, and
the replay commands. Costs and token counts are estimates; no API calls were
made to establish the controlled examples.

## Clean build and installed artifact

A fresh local clone at `8dc5d2b` used Node 24.21.0 and the committed lockfile:

| Command | Result |
| --- | --- |
| `npm ci` | Fresh install and core build passed |
| `npm run lint` | Passed |
| `npm run typecheck` | Core and browser TypeScript checks passed |
| `npm test` | 445 tests passed across 37 files |
| `npm run build` | Core output `dist/`; production site `web/dist/` |
| `npm run test:browser` | 84 Chromium/Firefox checks passed |
| `npm pack --pack-destination "$ARTIFACTS"` | Installable tarball built |

The package was installed in another directory using Node **20.0.0**, the
declared runtime floor. Both the installed library replay and the installed
`contextscope analyze` command processed the compressed fixture. Replay output
was byte-identical to source `after.json`; the CLI's complete JSON report also
matched the source CLI report. No source module was imported as a substitute
for the installed package.

The [installed receipt](../studies/cache-settings/installed-verification.json)
records the package/output hashes and four offline checks of the actual
installed CLI's HTML output. Chromium and Firefox at 1440/375 pixels displayed
the corrected second request, the return to the earlier scope, and the finding.
All four had zero external requests, page errors, script elements, and
horizontal page overflow. The production browser checks additionally exercise
worker analysis, compressed-file intake, JSON/HTML downloads, keyboard
inspection, axe accessibility checks and both themes.

```text
d399fd580f4ee3addf8fcdc9f093b5319beb0cf35aea8fcf684ff7c1f968fd1f  antonsoloviev-contextscope-0.3.3.tgz
5925480028840b9c63770100824956fe3a86fa39f9b18992a4e1c1b1da6d6dcd  installed replay JSON (identical to after.json)
```

The [desktop cache table](assets/cache-settings-1440.png) and
[phone finding](assets/cache-settings-finding-375.png) are real production
captures, visually inspected. Counts align with their columns, the explanation
fits at 375 pixels, and request controls remain reachable. The cache table
retains its existing horizontal scroll region on narrow screens.

## Historical corpus

All 240 original public Claude trajectory hashes were rechecked and all
10,555 request bodies were freshly reconstructed with the pinned upstream
mini-SWE-agent sources and LiteLLM 1.104.2. Reconstructed hashes also match
the preceding cache-accounting study's receipt.

The [new comparison receipt](../studies/cache-settings/corpus.json) shows zero
changed actual or optimized simulation rows and zero token-accounting
violations. Hit/no-hit agreement remains 10,431 / 10,555. This demonstrates
preserved behavior on that historical workload, not greater measured provider
accuracy. The controlled counterexamples establish the repaired scope logic.

## Performance check

`node scripts/bench.mjs 9` ran sequentially on the compiled baseline and the
clean build, with one warmup and nine measured runs each. On this 14-logical-CPU
WSL2 Linux host (about 47 GiB RAM), Node 24.21.0 produced:

| Existing workload | Baseline median | Corrected median |
| --- | ---: | ---: |
| 24 requests, 5.7 MB | 228 ms | 216 ms |
| 300 growing requests, 12.1 MB | 1,598 ms | 1,705 ms |

The stress case took about 7% longer in this run. These are single-host
measurements with run-to-run variation, not evidence of a speed improvement.
The unedited benchmark lines are retained in
[`benchmark.json`](../studies/cache-settings/benchmark.json).

## Remaining boundaries

Request-setting coverage is partial: model-specific thinking/effort, speed,
provider-injected feature prompts and opaque document images are not fully
modeled. Cache expiry, eviction, routing and private prompt rendering remain
unobserved. Explicit image presence is detectable; its actual token cost is
not measured here. The parser is not a complete provider-schema validator.

Suggested repository description: "Inspect LLM request context, cache boundaries, and differences from recorded provider usage."
Topics: `llm`, `prompt-caching`, `anthropic`, `observability`, `typescript`,
`cli`, `tokenization`.
