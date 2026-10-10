# OpenAI cache modes and false discounted reads

The old simulator treated every OpenAI request as legacy automatic caching. A
repeated explicit-only request without markers received a predicted cache hit
even though its configuration disables caching. It also reused entries across
different cache keys and charged modern writes as ordinary input.

`generate-sdk-fixtures.py` captures request bodies serialized by Python OpenAI
2.54.0 through an `httpx.MockTransport`. These are synthetic fixtures, without
provider calls, response usage or measured bills. The generator records hashes
and versions in [sdk-fixtures.json](sdk-fixtures.json). No credentials are read.

## Counterexample

Each pair has 2,401 stable developer tokens and a changing three-token user
message. Pairs use separate cache keys. The retained [before](before.json) is
from `dbd7e15`; [after](after.json) is the corrected simulation.

| Request | Mode | Old read | New read | New write | New uncached | New simulated USD |
|---|---|---:|---:|---:|---:|---:|
| 2 | Explicit, no marker | 2,304 | 0 | 0 | 2,404 | 0.004808 |
| 4 | Implicit, changing final message | 2,304 | 0 | 2,404 | 0 | 0.006010 |
| 6 | Explicit marker after stable text | 2,304 | 2,401 | 0 | 3 | 0.0004862 |

The complete six-request estimate changes from $0.0122592 to $0.0281307.
That is a corrected prediction, not increased observed spend. The implicit
pair writes through changing text; the explicit pair preserves a reusable
endpoint before it. The third fixture verifies partial tool-output reuse and
ensures changing `call_id` prevents a false hit.

[Clean-install, browser and CLI evidence](../../docs/verification-openai-cache-2026-10-09.md)
includes actual screenshots and the packaged artifact hash.

## Rules and scope

For the listed GPT-6 models, lookup follows the incoming boundaries and writes
are resolved after reads. Explicit mode considers the first two and last fifty
markers; implicit mode adds eligible message endings with a twenty-ending
lookback and the initial developer endpoint. Writes select the last four
explicit markers, or three plus the implicit endpoint. Prefixes below 1,024
modeled tokens are ineligible. Markers control caching without becoming prefix
content. These rules were checked against the
[OpenAI caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
on 2026-10-09.

**Source disagreement:** generated
[Responses reference prose](https://developers.openai.com/api/reference/resources/responses/methods/create)
still describes an eighty-marker lookup limit. This implementation follows
the guide's first-two-plus-fifty rule. The boundary tests document that choice;
they do not establish which rule a live server currently enforces.

Ordinary/read/write rates per million tokens are $2/$0.20/$2.50 for
[GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol),
$10/$1/$12.50 for [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra),
and $0.10/$0.01/$0.125 for [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
Their input/cache rates double above 272,000 modeled input tokens. Pricing
assumes Standard processing; service-tier, regional, output and tool charges
are outside this input-only estimate.

GPT-5.1/5.2 retain the legacy approximation, with their own published prices
and context windows. Unknown names still use the explicitly reported default
model assumption. This change does not add the entire model catalog.

Provider framing, hidden prompts, image tokenization, eviction and elapsed TTL
are unavailable. Changed renderer settings conservatively isolate the whole
request, although a provider may reuse a shorter prefix. The optimized scenario
normalizes existing content; it does not invent new OpenAI marker placements.

## Reproduce

From a source checkout with dependencies installed:

```sh
npm run build
node studies/openai-cache/replay.mjs dist /tmp/openai-cache-after.json
node dist/cli/index.js analyze examples/openai-cache-modes.jsonl.gz
```

To regenerate fixtures, install `openai==2.54.0` and `httpx==0.28.1` in a
throwaway virtual environment and run `generate-sdk-fixtures.py`. The committed
fixtures need neither Python nor an SDK installation to analyze.

`replay-legacy.mjs BASELINE_DIST CURRENT_DIST OUTPUT.json` independently checks
the 120 hash-pinned stateless OpenAI trajectories already used by
[the historical study](../real-trajectories/README.md). It reconstructs request
bodies directly from captured histories and checks both simulations, original
usage, token counts and per-row pricing. Raw trajectories remain in ignored
`cache/`; no live calls or private requests are needed.

The [retained replay](legacy-replay.json) checks 2,205 requests in 38.95 seconds
on the 14-vCPU WSL2 machine. Cache partitions and usage comparisons are unchanged;
all input counts still match captured `prompt_tokens`. Simulated reads remain
27,557,632 versus 19,420,544 reported reads. Recognizing historical prices changes
the input-cost prediction from $9.8352884 to $7.55102865; no observed bill is
available. This corpus verifies legacy compatibility, not modern endpoints.
