#!/usr/bin/env python3
"""Rebuild the Anthropic request bodies that mini-SWE-agent's Claude runs sent.

Usage: reconstruct_claude.py <mini-swe-agent-src> <trajectory.json> <out.jsonl.gz>

Run it with the pinned mini-SWE-agent source of the trajectory's own version
and litellm installed, with an empty environment. Nothing is sent anywhere:
the HTTP layer of litellm is replaced by a function that records the JSON body
litellm built and raises. The history is passed through the agent's own
preparation (the pinned cache_control / thinking-block code), then through
litellm's own Anthropic request builder.
"""
import copy, gzip, importlib.util, json, sys

src, traj_path, out_path = sys.argv[1:4]
sys.path.insert(0, src)

import litellm
from litellm.llms.custom_httpx import http_handler


class Captured(Exception):
    pass


captured = {}


def fake_post(self, url, data=None, json=None, **kw):  # noqa: A002
    import json as _json
    captured["url"] = url
    captured["body"] = _json.loads(data) if isinstance(data, (str, bytes)) else json
    captured["headers"] = {k: v for k, v in (kw.get("headers") or {}).items() if k.lower() != "x-api-key"}
    raise Captured()


http_handler.HTTPHandler.post = fake_post

traj = json.load(open(traj_path))
cfg = traj["info"]["config"]["model"]
mtype = traj["info"]["config"].get("model_type", "")
msgs = traj["messages"]


def load(path):
    spec = importlib.util.spec_from_file_location("cc_" + str(abs(hash(path))), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


import minisweagent.models.utils.cache_control as cc

v2 = traj.get("trajectory_format", "").endswith("1.1")
tools = None
if v2:
    from minisweagent.models.litellm_model import LitellmModel
    from minisweagent.models.utils.actions_toolcall import BASH_TOOL
    model = LitellmModel(**{k: v for k, v in cfg.items()})
    tools = [BASH_TOOL]

records = []
n = 0
for i, m in enumerate(msgs):
    if m["role"] != "assistant":
        continue
    resp = (m.get("extra") or {}).get("response")
    if not resp:
        continue
    hist = copy.deepcopy(msgs[:i])
    if v2:
        prepared = model._prepare_messages_for_api(hist)
    else:
        hist = [{k: v for k, v in x.items() if k != "extra"} for x in hist]
        if "AnthropicModel" in mtype and cfg.get("set_cache_control") is None and "mode" not in cc.set_cache_control.__code__.co_varnames[:cc.set_cache_control.__code__.co_argcount + cc.set_cache_control.__code__.co_kwonlyargcount]:
            prepared = cc.set_cache_control(hist)
        elif cfg.get("set_cache_control") or "AnthropicModel" in mtype:
            prepared = cc.set_cache_control(hist, mode="default_end")
        else:
            prepared = hist
    kw = dict(cfg.get("model_kwargs") or {})
    captured.clear()
    try:
        litellm.completion(model=cfg["model_name"], messages=prepared, api_key="sk-ant-unused", num_retries=0,
                           **({"tools": tools} if tools else {}), **kw)
    except Exception as e:  # litellm re-raises our sentinel wrapped in its own error type
        if "body" not in captured:
            records.append({"i": i, "error": f"{type(e).__name__}: {str(e)[:300]}"})
            continue
    u = resp["usage"]
    records.append({
        "i": i,
        "created": resp.get("created"),
        "model": resp.get("model"),
        "usage": {
            "prompt_tokens": u.get("prompt_tokens"),
            "completion_tokens": u.get("completion_tokens"),
            "cache_read": u.get("cache_read_input_tokens"),
            "cache_creation": u.get("cache_creation_input_tokens"),
        },
        "body": captured["body"],
        "url": captured.get("url"),
        "beta": captured["headers"].get("anthropic-beta"),
    })
meta = {"n_assistant": sum(1 for m in msgs if m["role"] == "assistant"), "api_calls": traj["info"]["model_stats"].get("api_calls"),
        "exit_status": traj["info"].get("exit_status"), "litellm": litellm.__version__ if hasattr(litellm, "__version__") else None}
with gzip.open(out_path, "wt") as f:
    f.write(json.dumps({"meta": meta}) + "\n")
    for r in records:
        f.write(json.dumps(r) + "\n")
print(len(records), "calls", sum(1 for r in records if "error" in r), "errors")
