# A request body is not always the whole prompt

At baseline `ecc601b`, two Responses requests with identical visible input but
different `previous_response_id` values predicted 5,120 cached tokens on the
second request. Changing a conversation or reusable prompt had the same problem.
Bare SDK input references (`{"id":"..."}`) disappeared entirely, producing zero
tokens for a reference-only request. Explicit references, reasoning items and
encrypted compaction were counted as their JSON transport instead.

The correction preserves these units as unresolved context. Visible text keeps
its local counts, but whole-request totals/context fractions and the entire
sequence's cache partitions and input costs are unavailable. No remote history
or prompt is fetched. Identical reference strings do not establish a token
length, resolved prompt equality or actual cache reuse.

The correction is published in source and the public demo. The
[source receipt](results/publication.json) compares twenty pinned public files.
The [canonical HTTP receipt](results/hosting.json) matches all 42 production files
to the clean build without cache-busting queries. The
[hosted browser receipt](results/hosted-browser.json) checks 44 export workflows,
including earlier media and Claude settings repairs, after disconnecting before
the first import. Source publication, installed-artifact and public-demo evidence
are separate checks. No new npm release was performed.

The [clean-artifact receipt](results/verification.json) pins tested source
`b1f31649bb09a0c6b4bf8c9d5ad9d83882e664b7`: a fresh install, lint,
typecheck, 625 unit checks, production build and 114 browser checks passed.
All 22 reports from the clean build and the separately installed package on
Node 20.0.0/24.21.0 are byte-identical. The actual executable writes matching
JSON/HTML and refuses invalid controls without replacing an existing output.
The receipt compares 117 source inputs, 105 installed files and 42 locally
served production files. These package checks install a locally built tarball;
they do not establish a new registry release.

The [before/after browser receipt](results/browser.json) retains twelve complete
export workflows per phase in Chromium/Firefox at 1440px dark and 375px light.
The first import happens after disconnecting. Original downloads, rejected-import
retention and ordinary-text recovery pass; no page exceptions, accessibility
violations, page overflow or HTTP requests after disconnecting were observed.
CLI HTML on both supported runtimes matches the actual browser HTML downloads
after replacing only their generation timestamp.

## What is unresolved?

| Native request unit | Preserved evidence | Local treatment |
| --- | --- | --- |
| `previous_response_id` | Original ID | Earlier response context is absent |
| `conversation` string or `{id}` | Original reference | Stored conversation items are absent |
| `prompt` | ID, version, variables | Reusable template is unresolved |
| Input `item_reference`, omitted or null `type` with an ID | Original unit | Referenced input item is absent |
| Input `reasoning` | ID, summary/content and any encrypted payload | Provider reasoning-history rendering is not reconstructed |
| Input `compaction` | Original encrypted unit | Opaque compacted history is not tokenized as text |

The `reference` category is an addressable source unit with no treemap area.
Reasoning keeps its existing `thinking` category. Each unresolved segment has
`unmodeledContext`, both token counts `null`, empty analyzed text and its original
`raw`/prefix identity. IDs and ciphertext are compared exactly even in the
optimized scenario; volatile-text normalization cannot turn distinct references
into equality. Structural comparisons describe captured units only.

Reasoning is withheld conservatively even when a summary or visible content is
present. The analyzer does not know how that returned history is rendered or
resolved by the provider. This does not establish that all visible reasoning
text is inherently uncountable. It is an explicit modeling boundary.

Literal JSON inside user text, metadata, tool arguments and schema examples is
ordinary text/data. `store` controls persistence rather than supplying stored
input, and null context controls add no reference. Inline messages with an ID,
role and content are still inline messages. Nonempty reference IDs and the
documented exclusion between `conversation` and `previous_response_id` are
validated; this is targeted validation, not complete API request validation.

OpenAI's [conversation-state guide](https://developers.openai.com/api/docs/guides/conversation-state)
describes durable conversations and previously stored response context. The
[Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses#3-update-multi-turn-conversations)
explains that prior input remains billable when using a previous response.
[The prompt-object migration guide](https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object)
shows the server-side templates present in existing/historical captures; this
analyzer is not recommending that deprecated API for new integrations.
The native SDK contracts and actual request bytes
establish the serialized reference shapes. Checked 2026-10-16.

## Controlled evidence

The [manifest](captures/manifest.json) records 22 application workflows serialized
by the actual OpenAI Python SDK 3.23.0 over a mock HTTP transport. Stored responses
and conversation IDs are seeded through that same mock client; those seed bodies
are deliberately absent from the imported logs. All IDs, replies, encrypted
strings and usage counters are synthetic controls. There are no provider calls,
model inference, stored-object fetches, measured charges or live API acceptance
claims. The previous-response-only defensive case is explicitly labelled as
acceptance-unverified.

| Controlled second request | Baseline local input | Baseline simulated read | Corrected local input/read |
| --- | ---: | ---: | --- |
| Different previous response | 5,201 | 5,120 | Unavailable / unavailable |
| Same previous response | 5,201 | 5,120 | Unavailable / unavailable |
| Different conversation | 5,201 | 5,120 | Unavailable / unavailable |
| Different reusable prompt | 5,201 | 5,120 | Unavailable / unavailable |
| Bare item reference only | 0 | 0 | Unavailable / unavailable |

The [baseline reports](results/before.json) disagree with 19 expected workflow
outcomes; the [corrected reports](results/after.json) have no discrepancies.
Expectations specify source paths that cannot supply their resolved context;
the simulator does not supply expected numerical token values for unknown units.
Three ordinary text/storage/null controls preserve their complete baseline JSON
reports. These controls are not an empirical provider accuracy rate.

The original browser prediction:

![Baseline predicts a 5120-token cache read for a different stored response](../../docs/assets/stored-context/before-cache.png)

The corrected report keeps captured usage separate from an unavailable estimate:

<img src="../../docs/assets/stored-context/reported-phone.png" alt="Phone view shows unavailable local counts and a separately reported 12000 input tokens" width="375">

Paired usage controls retain input `12,000` and reads `0` then `400`, with their
original source paths. Local totals, deltas and hit classifications stay
unavailable. The browser displays reported input separately from local estimates;
it does not substitute that count into a treemap or a modeled context fraction.
Standalone native response objects remain incomplete non-request records;
their echoed tools cannot create another prompt or implicitly join usage.

## Reproduce

```sh
npm ci
node studies/stored-context/replay.mjs /tmp/stored-replay.json dist --verify
node dist/cli/index.js analyze studies/stored-context/captures/reported-usage.jsonl.gz --verbose --json /tmp/stored.json --html /tmp/stored.html
```

Regenerate native captures only when needed:

```sh
uv run --no-project --with openai==3.23.0 studies/stored-context/capture.py
```

Build the app with `npm run build`, serve it with
`npm run preview:web -- --host 127.0.0.1 --port 4341`, and run
`node studies/stored-context/browser.mjs http://127.0.0.1:4341/contextscope/ /tmp/stored-browser --verify`.
The driver disconnects before the first import, compares actual JSON downloads
with CLI/core reports, opens offline HTML, downloads original references, checks
keyboard finding navigation, rejects conflicting controls without losing the
prior report, and recovers to ordinary text in Chromium and Firefox at desktop
and 375px widths.
