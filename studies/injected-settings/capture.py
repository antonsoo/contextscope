"""Capture controlled application bodies through Anthropic's SDK, offline.

uv run --no-project --with anthropic==1.15.0 studies/injected-settings/capture.py
The mock transport supplies replies; no provider or model is contacted.
"""
from __future__ import annotations

import gzip
import hashlib
import importlib
import json
import platform
from copy import deepcopy
from pathlib import Path

import anthropic

http = importlib.import_module(next(base.__module__.split(".")[0]
    for base in anthropic.DefaultHttpxClient.__mro__[1:] if base.__module__.startswith("httpx")))
HERE = Path(__file__).resolve().parent
MARKER = {"type": "ephemeral"}


def body():
    return {
        "model": "claude-sonnet-4-6", "max_tokens": 4096,
        "tools": [{"name": "lookup", "description": "Look up the exact source record. " * 300,
                   "input_schema": {"type": "object", "properties": {"query": {"type": "string"}},
                                    "required": ["query"]}, "cache_control": MARKER}],
        "system": [{"type": "text", "text": "Use the supplied reference when checking claims. " * 300,
                    "cache_control": MARKER}],
        "messages": [{"role": "user", "content": [{"type": "text",
            "text": "Reference: retain the original record, line number and observed outcome. " * 300,
            "cache_control": MARKER}]}],
    }


def format_(description="A supported answer."):
    return {"type": "json_schema", "schema": {"type": "object",
            "properties": {"answer": {"type": "string", "description": description},
                           "supported": {"type": "boolean"}},
            "required": ["answer", "supported"], "additionalProperties": False}}


def document(enabled=None, kind="document"):
    text = "The reference is a controlled local example, not a measured production event."
    block = {"type": kind, **({"source": {"type": "text", "media_type": "text/plain", "data": text}}
        if kind == "document" else {"source": "kb://controlled/reference", "title": "Reference",
                                   "content": [{"type": "text", "text": text}]})}
    if enabled is not None:
        block["citations"] = {"enabled": enabled}
    return block


def main():
    out = HERE / "captures"
    out.mkdir(exist_ok=True)
    captured = []
    cases = []
    counts = []

    def respond(request):
        assert request.url.host == "sdk.invalid"
        captured.append(request.content)
        if request.url.path.endswith("count_tokens"):
            return http.Response(200, json={"input_tokens": 1})
        return http.Response(200, json={"id": "msg_controlled", "type": "message", "role": "assistant",
            "model": json.loads(request.content)["model"], "content": [{"type": "text", "text": "Controlled reply."}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 0, "output_tokens": 0}})

    with anthropic.Anthropic(api_key="synthetic-unused", base_url="http://sdk.invalid", max_retries=0,
                            http_client=http.Client(transport=http.MockTransport(respond))) as sdk:
        def save(name, requests, actual, optimized=None, error=None):
            captured.clear()
            for request in requests:
                sdk.messages.create(**request)
            raw = b"\n".join(captured) + b"\n"
            packed = gzip.compress(raw, mtime=0)
            file = name + ".jsonl.gz"
            (out / file).write_bytes(packed)
            cases.append({"name": name, "file": file, "expected": {"actual": actual,
                          "optimized": optimized if optimized is not None else actual}, "expectedError": error,
                          "raw": {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()},
                          "gzip": {"bytes": len(packed), "sha256": hashlib.sha256(packed).hexdigest()}})

        a = body(); a["output_config"] = {"format": format_(), "effort": "high"}
        b = deepcopy(a); b["output_config"]["format"]["schema"]["properties"]["answer"]["type"] = "boolean"
        save("format-type", [a, b, a], [None, None, "messages[0].content[0]"])
        b = deepcopy(a); b["output_config"]["format"] = format_("Explain the answer briefly.")
        save("format-description", [a, b, a], [None, None, "messages[0].content[0]"])
        b = deepcopy(a); properties = b["output_config"]["format"]["schema"]["properties"]
        b["output_config"]["format"]["schema"]["properties"] = dict(reversed(list(properties.items())))
        save("format-property-order", [a, b, a], [None, None, "messages[0].content[0]"])
        b = deepcopy(a); del b["output_config"]["format"]
        save("format-toggle", [a, b, a], [None, None, "messages[0].content[0]"])
        b = deepcopy(a); legacy = b["output_config"].pop("format"); b["extra_body"] = {"output_format": legacy}
        save("format-legacy-alias", [a, b], [None, "messages[0].content[0]"])
        a = body(); b = deepcopy(a); b["output_config"] = {"format": None}
        save("format-null-default", [a, b], [None, "messages[0].content[0]"])
        for kind in ["document", "search_result"]:
            a = body(); a["messages"][0]["content"].append(document(False, kind))
            b = deepcopy(a); b["messages"][0]["content"][1]["citations"]["enabled"] = True
            save("citations-" + kind, [a, b, a], [None, "tools[0]", "messages[0].content[0]"],
                 [None, "tools[0]", "messages[0].content[1]"])
        a = body(); a["messages"].extend([
            {"role": "assistant", "content": [{"type": "tool_use", "id": "lookup-1", "name": "lookup", "input": {"query": "reference"}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "lookup-1", "content": [document(False)]}]}])
        b = deepcopy(a); b["messages"][2]["content"][0]["content"][0]["citations"]["enabled"] = True
        save("citations-tool-result", [a, b, a], [None, "tools[0]", "messages[0].content[0]"],
             [None, "tools[0]", "messages[2].content[0]"])
        a = body(); a["messages"][0]["content"].append(document())
        b = deepcopy(a); b["messages"][0]["content"][1]["citations"] = {"enabled": False}
        save("citations-default", [a, b], [None, "messages[0].content[0]"])
        b = deepcopy(a); b["messages"][0]["content"][1]["citations"] = {}
        save("citations-empty-config", [a, b], [None, "messages[0].content[0]"])
        a = body(); a["messages"][0]["content"].extend([document(True), document(False)])
        save("mixed-document-citations", [a], [], error="citation")
        a = body(); a["messages"][0]["content"].append(document(True)); a["output_config"] = {"format": format_()}
        save("format-with-citations", [a], [], error="citation")

        for name, request in [("format", {**body(), "output_config": {"effort": "high", "format": format_()}}),
                              ("speed-and-automatic", {**body(), "speed": "fast", "cache_control": MARKER})]:
            # Native count_tokens accepts these fields. The returned one token
            # is mock data, never an oracle for actual counts or costs.
            options = {k: v for k, v in request.items() if k != "max_tokens"}
            captured.clear(); sdk.messages.count_tokens(**options)
            payload = json.loads(captured[0]); file = "count-" + name + ".json"
            (out / file).write_bytes(captured[0] + b"\n")
            counts.append({"name": name, "file": file, "request": request,
                           "sha256": hashlib.sha256((out / file).read_bytes()).hexdigest()})

    (out / "manifest.json").write_text(json.dumps({
        "provenance": "Synthetic application bodies serialized by the actual SDK over a mock HTTP transport. No provider requests or observed cache/token measurements.",
        "sdk": {"anthropic": anthropic.__version__, "python": platform.python_version(),
                "http": http.__name__, "httpVersion": http.__version__}, "cases": cases, "countBodies": counts,
    }, indent=2) + "\n")
    print(f"Captured {len(cases)} cache workflows and {len(counts)} native count_tokens bodies.")


if __name__ == "__main__":
    main()
