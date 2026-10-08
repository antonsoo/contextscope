# contextscope against what Anthropic and OpenAI reported, on 360 agent runs

contextscope makes two claims about a request it has only read: how many tokens
it holds, and whether the provider's prompt cache will serve its prefix. Until
now both were checked against requests the tool's own author wrote and the
request bodies its SDK tests produce. Neither was ever compared with what a
provider counted or cached.

Every API response carries its own account of the request it answered:
Anthropic's `input_tokens`, `cache_read_input_tokens` and
`cache_creation_input_tokens`, OpenAI's `prompt_tokens` and
`prompt_tokens_details.cached_tokens`. The SWE-bench team publishes
mini-SWE-agent runs in which each model call is stored with that account. This
study rebuilds the request bodies of 360 of those runs, runs contextscope on
them and compares.

**What came out**

- **The Claude estimate was 15 to 25% low.** Against the input tokens Anthropic
  reported for 10,555 requests (Sonnet 4.5, Opus 4.5, Haiku 4.5, Opus 4.6),
  released 0.3.3 undercounted by a mean of 14.9 to 25.4% per model, with 95% of
  requests off by up to 26 to 38%. Code and command output tokenize denser than
  the 4.0 and 2.9 characters per token it assumed. Refitted on half of the
  trajectories, the mean error on the other half is +1.6 to +3.3% for sessions
  without tools and −6.5 to −11.3% for sessions with them. The remaining gap is
  consistent with the tool-use system prompt Anthropic adds, about 500 tokens,
  which is not modelled.
- **OpenAI's count is exact, plus 5 tokens per message.** In 2,205 of 2,205
  gpt-5.1 and gpt-5.2 requests, `prompt_tokens` was the o200k_base count of the
  message contents plus exactly 5 per message, with no remainder. 0.3.3 left
  the 5 out and was 0.8 to 1.1% low, which moved the cached-token boundary the
  cache simulation computes: it matched OpenAI's `cached_tokens` exactly on 22%
  of gpt-5.1 steps, and on 69% with the 5 added.
- **This checkout, not the release, had broken the cache simulation for
  tool-using Claude sessions.** The unreleased change to prompt identity read a
  tool result sent as a string in one request and as a one-element list of text
  blocks in the next as different content. It happens when a framework moves
  its cache marker onto the newest tool result, as mini-SWE-agent 2.0 does
  through litellm. On those four sets of sessions agreement with Anthropic on
  whether a request read the cache fell from 88 to 100% (0.3.3) to 6.5 to 23%,
  and 5,715 requests that did read the cache were told their breakpoint was
  outside the lookback window. Fixed in this checkout.
- **After the fixes it agrees with Anthropic on 96.2 to 100% of requests** about
  whether the cache was read, and its predicted share of input tokens read is
  within 0.0 to 1.6 points of the reported share (90.2 to 96.8%). The
  disagreements that remain are requests whose size sits at the model's minimum
  cacheable prefix, where a token estimate off by a few percent decides.
- **For OpenAI the simulation is an upper bound, not a prediction.** On 2,085
  steps where the prefix was identical to the previous request and long enough,
  OpenAI's `cached_tokens` matched the prediction exactly on 27%, was zero on
  34% and lower but non-zero on 38%. gpt-5.1 cached 88% of the predicted
  tokens, gpt-5.2 56 to 57%.
- **mini-SWE-agent's own cache use is sound, with one exception.** Across 10,315
  steps and 213.7 million input tokens, 0.07% of input tokens were not read from
  cache although the previous request was above the model's minimum: four
  steps, three of them one cause (an error message appended to a tool result
  made the API start a new user turn, and all three lost the whole cache).
  0.65% were not read because the prefix was below the minimum, which no
  framework can avoid. contextscope does not see the three; the other faults
  found were its own.

## The data

Public trajectories of mini-SWE-agent on SWE-bench Verified, from the
`swe-bench-submissions` bucket that the
[SWE-bench/experiments](https://github.com/SWE-bench/experiments) repository
points to (`assets.trajs` in each entry's `metadata.yaml`; the repository was at
commit `40f164d` when read). Each entry holds 500 trajectories, one file per
task, and each assistant message stores the raw response, `usage` included, in
`extra.response`.

13 entries were sampled, 40 of 500 trajectories each, drawn with a fixed seed
(`fetch.py`, `manifest.json` lists every file with its size, ETag and SHA-256).
360 of the 520 sampled files are used:

| Entry | Harness | Client stack | Model | Trajectories | Requests |
|---|---|---|---|---:|---:|
| `20250929_mini-v1.13.3_sonnet-4-5` | mini-SWE-agent 1.13.3 | litellm, text actions | claude-sonnet-4-5 | 40 | 2,108 |
| `20251124_mini-v1.16.0_claude-opus-4-5` | 1.16.0 | litellm, text actions | claude-opus-4-5 | 40 | 1,592 |
| `20260217_mini-v2.0.0_claude-4-5-haiku-high` | 2.0.0 | litellm, tool calls, thinking | claude-haiku-4-5 | 40 | 2,710 |
| `20260217_mini-v2.0.0_claude-4-5-opus-high` | 2.0.0 | same | claude-opus-4-5 | 40 | 1,344 |
| `20260217_mini-v2.0.0_claude-4-5-sonnet-high` | 2.0.0 | same | claude-sonnet-4-5 | 40 | 1,926 |
| `20260217_mini-v2.0.0_claude-4-6-opus` | 2.0.0 | same | claude-opus-4-6 | 40 | 875 |
| `20251120_mini-v1.15.0_gpt-5.1` | 1.15.0 | Portkey, Chat Completions | gpt-5.1 | 40 | 771 |
| `20251211_mini-v1.17.2_gpt-5.2` | 1.17.2 | Portkey, Chat Completions | gpt-5.2 | 40 | 635 |
| `20251211_mini-v1.17.2_gpt-5.2-high` | 1.17.2 | Portkey, Chat Completions | gpt-5.2 (high effort) | 40 | 799 |

The other four sampled entries (`gpt-5.1-codex` on mini-SWE-agent 1.16.0,
`gpt-5-2-high`, `gpt-5-mini` and `gpt-5-2-codex` on 2.0.0) are left out: the first
continues a stored response with `previous_response_id`, and the other three send
reasoning items by id with no content, so the body that was sent cannot be
rebuilt from the file. No API was called for this study.

This is one agent framework through three client stacks, on one benchmark.
Other public trajectories were looked at and not used. The OpenHands entry I
opened (`verified/20251127_openhands_claude-opus-4-5`) stores only the message
list, and its `logs/` folder holds the evaluation outputs, no model responses.
The older bash-only entries (mini-SWE-agent 1.0 and 1.7) have no `extra.response`.
I did not open SWE-agent `.traj` files or Hugging Face datasets. The models that
other mini-SWE-agent entries report through OpenRouter or litellm (Gemini, Kimi,
GLM, DeepSeek, Devstral) are not ones contextscope has a tokenizer for.

### Licences

mini-SWE-agent is MIT (`LICENSE.md` in its repository). The SWE-bench/experiments
repository has no licence file (the GitHub API reports none) and the bucket states
none, so no trajectory is copied into this repository: it holds `manifest.json`
(keys, sizes, hashes) and derived numbers only. `cache/` is gitignored.

## Rebuilding the request bodies

A trajectory is the agent's message list, not the request. What each framework
added between the two had to be read from its source at the version that ran,
which is why the tags below are pinned.

- **Claude, mini-SWE-agent 1.13.3 and 1.16.0.** The agent passes its messages
  to litellm (`models/litellm_model.py`, `models/anthropic.py`). Before each
  call `set_cache_control` rewrites them: 1.13.3 puts an ephemeral marker on the
  last two `user` messages, 1.16.0 on the last message only. I ran the pinned
  `set_cache_control` on each prefix of the history, then litellm's own
  Anthropic request builder with its HTTP layer replaced by a function that
  records the JSON body and raises. Nothing is sent.
- **Claude, mini-SWE-agent 2.0.0.** `_prepare_messages_for_api` (drops `extra`,
  reorders thinking blocks, sets the one tail marker) and a single `bash` tool,
  then litellm as above, with the entry's `model_kwargs` (adaptive thinking,
  the interleaved-thinking beta header).
- **OpenAI, mini-SWE-agent 1.15.0 and 1.17.2.** The message list goes to the
  Portkey client unchanged, with no tools and no markers
  (`models/portkey_model.py`). The body is `{model, messages}` with each
  message reduced to role and content.

What could not be checked:

- The litellm version the SWE-bench team ran is not recorded in the files. The
  rebuild used litellm 1.104.2. The two things it decides here are whether a
  tool result is sent as a string or a text-block list, and where the marker
  lands; both showed up in the data below as matches or as findings, but the
  bytes sent are not known.
- Portkey might rewrite a body before forwarding it. I assume it does not.
- 3 trajectories (2 Haiku, 1 Sonnet) recorded fewer assistant messages than
  `model_stats.api_calls`; calls whose reply failed to parse are not stored, but
  they can have written cache entries. They are kept.
- Evidence that the rebuild is right: for the two Claude sets that sum usage as
  Anthropic documents it, the input of request *k* minus the cache read of
  request *k+1* is exactly 4 tokens in 2,068 of 2,068 steps (1.13.3), which is
  what a breakpoint on the last two messages predicts. OpenAI's counts land on
  an exact integer relation (below). Neither proves the body.

**Reading the usage fields.** Anthropic's `input_tokens` counts only the
tokens after the last breakpoint; total input is
`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
fetched 2026-10-08). The harness records litellm's `prompt_tokens`, and litellm's
sum differs by version: in the 1.13.3 and 1.16.0 runs it is
`input + cache_read` (creation is added to get the total), in the 2.0.0 runs it
already includes creation. Each set was assigned by checking the invariant above.

## The measures

**Tokens.** The reported total input of a request against contextscope's count
for the rebuilt body: `≈` Claude estimate for Anthropic, the o200k_base count
for OpenAI. Signed mean error and mean absolute error per set, and the 95th
percentile of the absolute error. Trajectories are split in two by the SHA-256
of the instance id; the estimator was fitted on side 0 and the tables report
side 1 separately ("held out"). By content type: the change in reported input
between consecutive requests is regressed on the change in estimated tokens of
each category the step added (assistant text, tool call, tool result,
thinking), plus a constant per step. A factor of 1.0 means the estimate is
right for that content.

**Cache.** For every request: did the provider read the cache
(`cache_read_input_tokens > 0`), and did contextscope's simulation predict a
read. Also the share of input tokens read, reported and predicted. Findings are
scored against the same fact: "below the minimum cacheable length" is right if
the provider cached nothing, "outside the lookback window" is right if the
provider did not read.

## Results: token counts

Mean error of contextscope's count against the reported total input, 0.3.3
against this checkout; "held out" is side 1 only.

| Set | Requests | 0.3.3 mean | 0.3.3 p95 abs | Now mean | Now p95 abs | Held out: mean / p95 abs |
|---|---:|---:|---:|---:|---:|---:|
| Sonnet 4.5, text actions | 2,108 | −16.9% | 26.1% | +0.5% | 13.7% | +1.6% / 11.2% |
| Opus 4.5, text actions | 1,592 | −14.9% | 27.5% | +3.0% | 14.9% | +3.3% / 14.9% |
| Haiku 4.5, tools | 2,710 | −23.4% | 33.9% | −7.5% | 20.0% | −7.4% / 19.7% |
| Opus 4.5, tools | 1,344 | −24.3% | 34.3% | −8.5% | 20.5% | −7.8% / 19.6% |
| Sonnet 4.5, tools | 1,926 | −25.4% | 35.6% | −9.9% | 22.6% | −11.3% / 21.9% |
| Opus 4.6, tools | 875 | −24.3% | 37.8% | −8.6% | 25.1% | −6.5% / 12.9% |
| gpt-5.1 | 771 | −0.8% | 1.1% | 0.0% | 0.0% | 0.0% / 0.0% |
| gpt-5.2 | 635 | −1.1% | 1.6% | 0.0% | 0.0% | 0.0% / 0.0% |
| gpt-5.2, high effort | 799 | −1.1% | 1.7% | 0.0% | 0.0% | 0.0% / 0.0% |

By content type, on side 1 (5,155 steps). Factor = reported tokens over
estimated tokens; 1.0 is right.

| Content | 0.3.3 (4.0 / 2.9 chars per token) | Now (3.3 / 2.5) |
|---|---:|---:|
| user message (command output in the text-action runs) | 1.157 | 0.956 |
| assistant text | 1.166 | 0.967 |
| tool call (the JSON arguments) | 1.115 | 0.924 |
| tool result (command output) | 1.204 | 0.995 |
| thinking | 1.443 | 1.190 |
| constant per step | 30.7 tokens | 31.8 tokens |

Summed over the whole held-out half, reported over estimated input growth was
1.252 and is now 1.038. Command output was undercounted by 20%.

The `tokenize-claude.ts` header gave 3.8 to 4.2 characters per token for prose
and 2.7 to 3.3 for code and JSON. On this content both were too high. The
README stated no numeric error band for the Claude estimate, only that it was
a heuristic checked "for the qualitative behavior"; it now states the band
above.

What the remaining error is. A request that sends tools carries Anthropic's
tool-use system prompt, which the
[pricing page](https://platform.claude.com/docs/en/about-claude/pricing)
(fetched 2026-10-08) lists at 496 tokens for Opus 4.5, Sonnet 4.5 and Haiku 4.5
and 497 for Opus 4.6. With the new estimator the first request of each
tool-using session is still short of the reported count by a mean of 384 to 430
tokens on the three 4.5 models and 228 on Opus 4.6 (`results.json`,
`claude_first_request_reported_minus_estimate_tokens_now`); the text-action
sets, which send no tools, are over by 254 to 306. That is the right order for
the documented figure, partly offset by the prose overestimate. It is not added: the model table
would need the figure per model and the overhead has no segment to belong to. A
per-step constant of about 30 tokens is the framing around each message and
block. Thinking is still 1.19 times under; I have not established why (the
signature carried with each block is one candidate, not tested). Context
awareness text that Anthropic documents for Sonnet 4.5 and Haiku 4.5 is another
invisible addition on those two.

## Results: the Anthropic cache

Did the request read the cache? Rows are the provider, columns the simulation
(requests), then agreement.

| Set | 0.3.3: read/read, none/none, miss, false read | Agree | This checkout before the fix | Agree | Now | Agree |
|---|---|---:|---|---:|---|---:|
| Sonnet 4.5, text | 2,068 / 39 / 1 / 0 | 100.0% | same | 100.0% | same | 100.0% |
| Opus 4.5, text | 1,410 / 40 / 0 / 142 | 91.1% | same | 91.1% | 1,405 / 171 / 5 / 11 | 99.0% |
| Haiku 4.5, tools | 2,434 / 174 / 100 / 2 | 96.2% | 1 / 176 / 2,533 / 0 | 6.5% | 2,486 / 174 / 48 / 2 | 98.2% |
| Opus 4.5, tools | 1,238 / 40 / 0 / 66 | 95.1% | 139 / 40 / 1,099 / 66 | 13.3% | 1,215 / 106 / 23 / 0 | 98.3% |
| Sonnet 4.5, tools | 1,885 / 40 / 0 / 1 | 100.0% | 236 / 41 / 1,649 / 0 | 14.4% | 1,885 / 40 / 0 / 1 | 100.0% |
| Opus 4.6, tools | 572 / 202 / 101 / 0 | 88.5% | 0 / 202 / 673 / 0 | 23.1% | 641 / 201 / 32 / 1 | 96.2% |

"Miss" is a request that read the cache where the simulation predicted none;
"false read" the opposite.

Share of input tokens read from cache, reported against predicted (now):
Sonnet 4.5 96.8 / 96.8, Opus 4.5 (text) 94.8 / 94.9, Haiku 4.5 96.7 / 96.6,
Opus 4.5 (tools) 95.6 / 95.5, Sonnet 4.5 (tools) 96.3 / 96.4, Opus 4.6
90.2 / 88.6.

### Who was right where they disagreed

- **The 142 false reads on Opus 4.5 (text) and 66 on Opus 4.5 (tools)** were the
  model table. Opus 4.5 was not in it, so it was priced as Sonnet 5.5 with a
  512-token minimum, while Anthropic documents 4,096 for it. In all 208 the
  provider cached nothing (`cache_creation_input_tokens` was 0 too). The two 4.5
  models are now in the table.
- **The 48, 23 and 32 misses now (100, 0 and 101 on 0.3.3) on Haiku 4.5,
  Opus 4.5 and Opus 4.6, and 5 more on Opus 4.5 with text actions,** are
  requests the provider cached that the estimate put under the 4,096-token
  minimum. All 108 carry a `below_minimum_cacheable` finding that is wrong.
  Of the 602 such findings now, 494 are right (the provider cached nothing) and
  108 wrong; on 0.3.3 the figures were 298 and 206. Of the 506 requests where
  the provider cached nothing, 494 carry the finding now.
- **The 15 false reads that remain.** 11 are Opus 4.5 requests (text actions)
  sitting at the 4,096 minimum: the estimate put the prefix over it, the
  provider's total for the request was 3,887 to 6,144 and it read nothing. 4 are
  on 2.0.0 runs: the three full misses described below and one request of 4,520
  reported tokens.
- **The unreleased regression** is the string versus text-block tool result
  described above. The proof it is the tool and not the API: the same
  requests, with that one change, move agreement from 6.5 to 23% to 96 to
  100%, and the provider read the cache on 90 to 97% of tokens throughout.
  Whether Anthropic's cache treats the two serializations as one prompt is not
  shown here; the data fit it (reads continued across the change in every
  step) but the rebuild may differ from what was sent. The change treats them
  as equal on the existing principle that a string is shorthand for one text
  block, which the tool already applied to system prompts and message content.

### What the frameworks did

mini-SWE-agent 1.13.3 put two breakpoints on the last two user messages and
2.0.0 one on the last message. Both worked: the provider read 90 to 97% of
all input tokens, and across 10,315 consecutive steps (213.7 million input
tokens) the previous request's prefix was read except for:

| | Tokens |
|---|---:|
| not read because the previous request was under the model's minimum (4,096 on Opus 4.5, Opus 4.6 and Haiku 4.5) | 1,399,259 (0.65%) |
| not read although the previous request was over the minimum | 151,723 (0.07%), in 4 steps, 147,623 of it in 3 |

Three of the four are one cause, and it is in the framework's behaviour. When
a model reply contains no tool call, mini-SWE-agent 2.0 answers with an error
message, and litellm puts that text into the same user message as the last tool
result. The API sees a tool result followed by a text block: a new user turn.
In all three steps (Haiku 4.5 twice, Sonnet 4.5 once; every step of that shape
in the sample, `steps_with_text_after_tool_result` in `results.json`) the whole
cache was written again (`cache_read_input_tokens` 0, 36,027 to 58,501 tokens
created) and the reported input was 1.2 to 5.6 thousand tokens smaller than the
request before, although the request had grown. Anthropic documents that on
models through Haiku 4.5 and Sonnet 4.5 the API drops earlier thinking blocks
when a new user turn arrives
([context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows));
that fits the shrinking input and the full miss, but I have not tested the
mechanism, and the sample has no such step on an Opus model, which keeps
thinking. The fourth step is a request of 4,100 reported tokens, borderline for
the 4,096 minimum, not a miss. Nothing in a request body shows any of this to
contextscope: it sees an identical prefix and predicts a read. The gaps between
consecutive calls were 4 seconds at the median, 143 at most, so the 5-minute
lifetime never applied; this data cannot test the simulation's TTL assumption in
either direction.

On the question of what real frameworks do wrong: for caching, in this one
framework, one thing, three times in 10,315 steps, at a cost of 147,623
uncached input tokens (0.07% of the total). What costs most is the minimum
prefix on the three 4,096-token models, and contextscope names that
(`below_minimum_cacheable`, correct in 494 of 602 cases).

## Results: the OpenAI cache

Steps after the first request of each session, 2,085 in all, where the prefix
repeated the previous request's and contextscope predicted a read. Counts of
steps, OpenAI's `cached_tokens` against the prediction:

| Set | Steps | Equal | Provider less | Provider none | Provider more | Cached over predicted tokens |
|---|---:|---:|---:|---:|---:|---:|
| gpt-5.1, 0.3.3 | 731 | 160 | 116 | 99 | 356 | 0.888 |
| gpt-5.1, now | 731 | 503 | 125 | 99 | 4 | 0.881 |
| gpt-5.2, 0.3.3 | 595 | 28 | 258 | 275 | 34 | 0.567 |
| gpt-5.2, now | 595 | 32 | 278 | 275 | 10 | 0.561 |
| gpt-5.2 high, 0.3.3 | 759 | 27 | 359 | 338 | 35 | 0.575 |
| gpt-5.2 high, now | 759 | 27 | 390 | 338 | 4 | 0.569 |

Across the three sets now: 562 equal (27%), 793 less (38%), 712 none (34%), 18
more. The "more" cases fell from 425 to 18 once the 5 framing tokens were
counted: without them the predicted boundary fell below the real one. None of the 120
first requests of a session reported cached tokens.

The hit rate rises with the size of the predicted prefix: gpt-5.1 hit on 61%
of steps under 2,048 predicted tokens and 92% above 16,384; gpt-5.2 on 6% and
80%, and the high-effort set on 10% and 74%. Every one of the 1,373 non-zero
`cached_tokens` values was a multiple of 128, as the tool assumes.

Why OpenAI served less than the prefix allowed is not visible in the request.
OpenAI's [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
(fetched 2026-10-08) says cached state lives on individual machines, that
traffic above 15 requests per minute can lead to overflow routing, and that
hits are not guaranteed. These runs come from a leaderboard run at scale, many
sessions sharing one long common start; I do not know how many ran at once,
and the data cannot separate routing from other causes. That gpt-5.2 served
far less than gpt-5.1 on the same harness is shown; why is not.

What changed in the tool for OpenAI: the 5 tokens per message, nothing else. A
prediction cannot be improved from the request alone. The README now says the
simulation is an upper bound for OpenAI and gives these numbers.

## What was wrong, and what changed

| | Cause | Change |
|---|---|---|
| String and text-block tool results differed | Prompt identity (unreleased) kept the JSON shape of a `tool_result`'s `content` | A `tool_result` with string content is compared as one text block (`src/core/prompt-identity.ts`) |
| Claude estimate 15 to 25% low | 4.0 / 2.9 characters per token | 3.3 / 2.5, fitted on side 0, reported on side 1 (`src/core/tokenize-claude.ts`) |
| OpenAI count short by 5 per message | Chat framing not counted | +5 on each plain-string Chat message (`src/core/parse-openai.ts`) |
| Opus 4.5 and Sonnet 4.5 unknown | Not in the model table | Added with documented minimum, price, context window (`src/core/pricing.ts`) |

The characters-per-token pair was fitted by grid search on side 0 (5,160
steps, steps are the segments a request adds to the one before). It is two
numbers chosen on data, then checked on the other half; held-out and
fitting-half results agree (reported over estimated growth 1.038 and 1.036).
Adding a free constant per step or per segment fitted better on both halves
(`estimator_fit` in `results.json`); neither is in the tool, because a constant
per step is not a property of any segment. The pair describes the tokenizer of the models measured: Opus 4.7 and later use a newer one that Anthropic documents as producing
about 30% more tokens ([pricing page](https://platform.claude.com/docs/en/about-claude/pricing)),
and nothing here measures it.

## What is left

- The tool-use system prompt (about 500 tokens per tool-using request) and the
  thinking factor are not modelled; Claude counts on tool-using sessions stay
  7 to 11% low and the `below_minimum_cacheable` finding is wrong in 108 of 602
  cases.
- The OpenAI simulation cannot say which steps will miss. It could present its
  reads as a ceiling in the report; this change only documents it.
- OpenAI model ids in the table are GPT-6 only; gpt-5.1 and gpt-5.2 are priced
  as the default. Token counts do not depend on it.
- Framing for array content, tool calls and tool definitions on OpenAI, and for
  anything but plain-text messages, is not measured.

## What this does not show

- It is one agent framework on one benchmark, 40 of 500 tasks per set, with
  sessions of 6 to 124 requests (median 29) where every call came within 143 seconds
  of the last. TTL expiry, 1-hour caches, the 20-block lookback window, parallel tool
  calls, images, documents, long system prompts that change, and models other than
  these six were not exercised. The lookback finding was only seen when it was
  wrong.
- The bodies are rebuilt, not captured. See the list of what could not be
  checked above.
- Opus 4.7 and later, and every Claude model released after Opus 4.6, are
  untested for token counts.
- Duplicate-content findings, the cost figures and the "optimized" scenario have
  no yardstick in this data and were not scored.
- The held-out half is held out of the two fitted numbers only. The choice of
  what to look at (which errors to chase, the 5-token framing, the model table)
  used all of it.

## Reproduce

Needs Python 3.10+, Node 20+, `uv`, and about 1 GB free. Scratch directory
`$S`; third-party code runs with an empty environment.

```sh
cd studies/real-trajectories
python3 -I fetch.py                         # lists the bucket, downloads cache/ (~150 MB), writes manifest.json

# pinned harness source (MIT) and a litellm to build bodies with; nothing is sent anywhere
for t in v1.13.3 v1.16.0 v2.0.0; do
  mkdir -p $S/src/mswe-$t
  curl -sL https://codeload.github.com/SWE-agent/mini-swe-agent/tar.gz/refs/tags/$t | tar xz -C $S/src/mswe-$t --strip-components=1
done
env -i PATH="$PATH" HOME=$S/home uv venv $S/venv
env -i PATH="$PATH" HOME=$S/home uv pip install --python $S/venv/bin/python \
    litellm==1.104.2 jinja2 pydantic platformdirs python-dotenv tenacity rich pyyaml typer requests prompt_toolkit textual numpy

MSWEA_SRC=$S/src PYBIN=$S/venv/bin/python OUT=$S/bodies HOME_SCRATCH=$S/home python3 -I run_reconstruct.py   # ~30 min

# the three versions of contextscope
git worktree add --detach $S/wt-release v0.3.3                     # released
git worktree add --detach $S/wt-head 9479694                       # this checkout before the study
for w in release head; do (cd $S/wt-$w && ln -s <repo>/node_modules node_modules && npx tsc -p tsconfig.json --outDir $S/dist-$w); done
npx tsc -p ../../tsconfig.json --outDir $S/dist-now                # working tree
ln -s <repo>/node_modules $S/node_modules

node analyze.mjs $S/dist-release $S/bodies $S/released.jsonl
node analyze.mjs $S/dist-head    $S/bodies $S/head.jsonl
node analyze.mjs $S/dist-now     $S/bodies $S/now.jsonl
node segdata.mjs $S/dist-now     $S/bodies $S/segdata.json
$S/venv/bin/python -I fit_estimator.py $S/segdata.json $S/estimator-fit.json                  # ~15 min
$S/venv/bin/python -I score.py --released $S/released.jsonl --head $S/head.jsonl --after $S/now.jsonl \
    --segdata $S/segdata.json --manifest manifest.json --bodies $S/bodies --fit $S/estimator-fit.json --out results.json
```

`reconstruct_claude.py` and `reconstruct_openai.py` rebuild one trajectory;
`run_reconstruct.py` runs them over `cache/`. Rebuilding twice gives identical
bodies (checked on two trajectories).

## References

- SWE-bench/experiments: <https://github.com/SWE-bench/experiments> (commit
  `40f164d`, 2026-09-03); trajectories under
  `s3://swe-bench-submissions/bash-only/<entry>/trajs/`.
- mini-SWE-agent: <https://github.com/SWE-agent/mini-swe-agent>, tags `v1.13.3`,
  `v1.16.0`, `v2.0.0`; MIT.
- Anthropic prompt caching, usage fields, minimum cacheable length, lookback:
  <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- Anthropic pricing, tool-use system prompt tokens, tokenizer note:
  <https://platform.claude.com/docs/en/about-claude/pricing>
- Anthropic model pages and context windows:
  <https://platform.claude.com/docs/en/models/opus-4-5/overview>,
  <https://platform.claude.com/docs/en/build-with-claude/context-windows>
- OpenAI prompt caching: <https://developers.openai.com/api/docs/guides/prompt-caching>
