# Literal tokenizer spellings in captured prompts

Baseline `71f3a1a02d6975f395b38a499b9a3881a6123a1b` could not analyze a valid
request containing the literal text `<|endoftext|>`: its `gpt-tokenizer` call
used the default special-token rejection policy. A single occurrence in a
message, instruction, tool description or tool result aborted the entire log.
Claude requests were also affected because parsing computes both token counts.

This is normal content in programming conversations about tokenizers. The
retained public files from OpenAI's tiktoken and Hugging Face Transformers both
contain those spellings. The study wraps that code in constructed requests;
it is not a capture of actual provider traffic or an observed production incident.

The source change passes an empty `disallowedSpecial` set to the existing
encoder. No special tokens are enabled. The original text is tokenized as
ordinary BPE pieces, preserving its characters and JSON representation.

| Text | Ordinary o200k_base count |
| --- | ---: |
| `<|endoftext|>` | 7 |
| `<|fim_suffix|>` | 6 |
| `<|endofprompt|>` | 7 |
| 256 adjacent `<|endoftext|>` spellings | 1,537 |

Enabling special tokens would be a different operation. This application
analyzes logged strings, not an already serialized model control-token stream.
The native reference is OpenAI tiktoken 0.12.0's
[`encode_ordinary`](https://github.com/openai/tiktoken/blob/0.12.0/tiktoken/core.py),
which also provides an independent Rust implementation of the BPE encoder.
The integration option is documented by
[`gpt-tokenizer`](https://github.com/niieani/gpt-tokenizer#custom-disallowed-sets).

## Evidence

`cases.mjs` constructs 62 valid workflows plus two rejected controls. Twelve
placements cover Chat Completions, Responses and Anthropic user/system text,
tool definitions and tool results. They carry literal-marker text, multilingual
text, two pinned public code files and ordinary text. Additional cases cover
a batch envelope and a repeated-prefix cache simulation. Invalid JSON and a
rounded uint64 retain their prior rejection.

| Workflow | Baseline | Corrected |
| --- | ---: | ---: |
| Valid library/CLI workflows accepted | 12/62 | 62/62 |
| Invalid controls rejected | 2/2 | 2/2 |

Every accepted CLI flow writes JSON and standalone HTML. Its JSON report must
match the library report. `replay.mjs` checks 54 direct token probes and all
120 extracted text segments against native tiktoken. Ordinary text counts agree
exactly. Segment totals separately retain the existing five-token adjustment
for plain-string Chat Completions messages; that adjustment is not part of the
native text oracle. The long literal prefix therefore has 1,542 modeled segment
tokens, and the second request reads 1,536 tokens in the existing legacy cache
simulation. Those are simulated counts, not observed provider cache hits.

The original public files, repository commits, URLs and SHA-256 hashes are in
[`public/manifest.json`](public/manifest.json). Their MIT and Apache-2.0 license
texts are retained alongside them. The native oracle's result hashes are in
[`evidence/after.json`](evidence/after.json), with the failed baseline in
[`evidence/before.json`](evidence/before.json).

```sh
uv venv --python 3.12 /tmp/token-oracle
uv pip install --python /tmp/token-oracle/bin/python tiktoken==0.12.0
npm ci
node studies/token-literals/replay.mjs . /tmp/literals-after.json verify /tmp/token-oracle/bin/python
node studies/token-literals/replay.mjs /path/to/baseline /tmp/literals-before.json baseline /tmp/token-oracle/bin/python
```

The native oracle may download the standard o200k_base vocabulary on first
use; no request bodies are sent to a model provider. For an installed npm
package, pass its package directory as the first argument to `replay.mjs`.

## Existing logs

`compatibility.mjs` compares complete JSON reports, including token totals,
findings and both cache scenarios. It runs the actual old and new tokenizers;
there is no counter bypass. All **240 reconstructed public trajectories,
10,555 requests**, and all 11 bundled example reports remain byte-identical. The underlying source files and
reconstructed request bodies are hash-checked against the existing
[real-trajectory study](../real-trajectories/README.md). These are historical
bodies reconstructed with the pinned harness, not new provider calls.

```sh
node studies/token-literals/compatibility.mjs /path/to/baseline . /path/to/reconstructed-corpus /tmp/literal-compatibility.json
```

[`evidence/compatibility.json`](evidence/compatibility.json) retains per-trajectory
report hashes and the existing example-report comparisons. Absence of changes
in that corpus establishes regression compatibility, not delimiter prevalence
or provider billing accuracy.

## Browser

The browser driver imports the real files after shutting down its local server
and switching offline, after loading the app, worker and declared font faces. It covers all twelve placements, a public-code tool
result, the repeated-prefix case, gzip, both invalid controls and a fresh paste,
in Chromium and Firefox at 375 and 1440 pixels. All 64 valid file imports and
fresh pastes succeed, up from zero; all eight invalid-control imports remain
rejected. Each run verifies 72 actual report downloads. The final runs make no
requests after going offline. It compares actual JSON
downloads against native library reports and checks that rejected imports
preserve the prior report. Run after `npm run build:web`:

```sh
node studies/token-literals/browser.mjs . /tmp/literal-browser.json verify /tmp/literal-screens
```

## Limits

This repairs recognition of literal text and keeps ordinary o200k_base counts
exact for that encoding. It does not introduce model-specific tokenizers,
measure unmodeled message/tool/image framing, or establish API billing totals.
Claude counts remain labeled estimates. The cache result is still a simulation
with its existing stated assumptions. Source work does not release a new npm
package or update the hosted demo.
