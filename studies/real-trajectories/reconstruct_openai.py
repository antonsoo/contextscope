#!/usr/bin/env python3
"""Rebuild the Chat Completions bodies mini-SWE-agent 1.x sent to OpenAI models via Portkey.

Usage: reconstruct_openai.py <trajectory.json> <out.jsonl.gz>

In these versions the agent passes its message list to the client unchanged
(only role and content are meaningful; `extra` and `timestamp` are bookkeeping
the OpenAI API ignores), with no tools and no cache markers
(portkey_model.py, `_query`). The body is therefore {model, messages}.
"""
import gzip, json, sys

traj_path, out_path = sys.argv[1:3]
traj = json.load(open(traj_path))
msgs = traj["messages"]
records = []
for i, m in enumerate(msgs):
    if m["role"] != "assistant":
        continue
    resp = (m.get("extra") or {}).get("response")
    if not resp or not resp.get("usage"):
        continue
    u = resp["usage"]
    ptd = u.get("prompt_tokens_details") or {}
    records.append({
        "i": i, "created": resp.get("created"), "model": resp.get("model"),
        "usage": {"prompt_tokens": u["prompt_tokens"], "completion_tokens": u.get("completion_tokens"),
                  "cached_tokens": ptd.get("cached_tokens"), "reasoning_tokens": (u.get("completion_tokens_details") or {}).get("reasoning_tokens")},
        "body": {"model": resp.get("model"), "messages": [{"role": x["role"], "content": x["content"]} for x in msgs[:i]]},
    })
meta = {"n_assistant": sum(1 for m in msgs if m["role"] == "assistant"), "api_calls": traj["info"]["model_stats"].get("api_calls"),
        "exit_status": traj["info"].get("exit_status")}
with gzip.open(out_path, "wt") as f:
    f.write(json.dumps({"meta": meta}) + "\n")
    for r in records:
        f.write(json.dumps(r) + "\n")
