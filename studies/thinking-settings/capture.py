"""Serialize controlled Claude request histories through the real Python SDK.

The mock HTTP transport records exact request bytes and supplies a fixed reply.
There is no inference, external HTTP request, token usage or observed cache result.
Run: uv run --no-project --with anthropic capture.py
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

# Use the actual HTTP implementation this SDK release accepts (httpx2 in 1.15).
httpx = importlib.import_module(next(
    base.__module__.split(".")[0] for base in anthropic.DefaultHttpxClient.__mro__[1:]
    if base.__module__.startswith("httpx")
))

ROOT = Path(__file__).resolve().parent
MARKER = {"type": "ephemeral"}


def body(model: str = "claude-sonnet-4-6") -> dict:
    return {
        "model": model,
        "max_tokens": 8192,
        "tools": [{
            "name": "lookup",
            "description": "Look up a record in the supplied project reference.",
            "input_schema": {"type": "object", "properties": {
                "query": {"type": "string"}}, "required": ["query"]},
        }],
        "system": [{"type": "text", "text": "Use the reference to check each claim. " * 300,
                    "cache_control": MARKER}],
        "messages": [{"role": "user", "content": [{"type": "text",
            "text": "Reference: the parser retains each original record and its line number. " * 300,
            "cache_control": MARKER}]}],
    }


def main() -> None:
    out = ROOT / "captures"
    out.mkdir(exist_ok=True)
    pending: list[bytes] = []
    cases: list[dict] = []

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "sdk.invalid"
        pending.append(request.content)
        return httpx.Response(200, json={
            "id": "msg_synthetic", "type": "message", "role": "assistant",
            "model": json.loads(request.content)["model"],
            "content": [{"type": "text", "text": "Controlled reply; no inference."}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 0, "output_tokens": 0},
        })

    with anthropic.Anthropic(api_key="synthetic-unused", base_url="http://sdk.invalid",
                            max_retries=0,
                            http_client=httpx.Client(transport=httpx.MockTransport(respond))) as sdk:
        def save(name: str, requests: list[dict], expected: list[str], note: str = "") -> None:
            pending.clear()
            for request in requests:
                sdk.messages.create(**request)
            raw = b"\n".join(pending) + b"\n"
            packed = gzip.compress(raw, mtime=0)
            filename = name + ".jsonl.gz"
            (out / filename).write_bytes(packed)
            cases.append({"name": name, "file": filename, "expectedReadBoundaries": expected,
                          "rawBytes": len(raw), "rawSha256": hashlib.sha256(raw).hexdigest(),
                          "gzipBytes": len(packed), "gzipSha256": hashlib.sha256(packed).hexdigest(),
                          "note": note})

        a = body()
        a["thinking"] = {"type": "enabled", "budget_tokens": 2048}
        b = deepcopy(a)
        b["thinking"]["budget_tokens"] = 4096
        save("budget-change", [a, b, a], ["none", "none", "all"],
             "Message miss is documented; all-level isolation is a conservative model because setup survival is model-specific.")
        a = body()
        b = deepcopy(a)
        b["thinking"] = {"type": "enabled", "budget_tokens": 2048}
        save("thinking-toggle", [a, b, a], ["none", "none", "all"])
        a = body("claude-opus-4-6")
        a["thinking"] = {"type": "adaptive"}
        a["output_config"] = {"effort": "high"}
        b = deepcopy(a)
        b["output_config"]["effort"] = "medium"
        save("effort-change", [a, b, a], ["none", "none", "all"])
        for name, model, thinking, effort in [
            ("disabled-default", "claude-sonnet-4-6", "disabled", "high"),
            ("adaptive-default", "claude-opus-5-5", "adaptive", "medium"),
            ("adaptive-high-default", "claude-sonnet-5-5", "adaptive", "high"),
        ]:
            a = body(model)
            b = deepcopy(a)
            b["thinking"] = {"type": thinking}
            b["output_config"] = {"effort": effort}
            save(name, [a, b], ["none", "all"])
        a = body()
        a["thinking"] = {"type": "enabled", "budget_tokens": 2048}
        b = deepcopy(a)
        b["thinking"] = {"budget_tokens": 2048, "type": "enabled"}
        save("configuration-key-order", [a, b], ["none", "all"])
        a = body()
        b = deepcopy(a)
        b["max_tokens"] = 16000
        save("output-limit-only", [a, b], ["none", "all"])
        a = body()
        b = deepcopy(a)
        save("unchanged", [a, b], ["none", "all"])
        a = body("custom-claude-model")
        b = deepcopy(a)
        b["thinking"] = {"type": "disabled"}
        save("unknown-default", [a, b], ["none", "none"],
             "Unknown model; SDK serialization does not establish provider acceptance or defaults.")
        a = body("claude-opus-5-5")
        a["thinking"] = {"type": "adaptive"}
        a["output_config"] = {"effort": "medium"}
        a["messages"].extend([
            {"role": "assistant", "content": "I will check the reference."},
            {"role": "system", "content": [], "output_config": {"effort": "high"}},
            {"role": "user", "content": [{"type": "text", "text": "Now examine the failure.",
                                           "cache_control": MARKER}]},
        ])
        b = deepcopy(a)
        b["messages"][2]["output_config"]["effort"] = "low"
        save("message-effort-change", [a, b, a], ["none", "first-user", "all"],
             "Beta per-message effort requires the appropriate header and supported platform/model; this capture verifies body serialization only.")
        a = body("claude-opus-5-5")
        b = deepcopy(a)
        b["messages"].extend([
            {"role": "assistant", "content": "I will check the reference."},
            {"role": "system", "content": [], "output_config": {"effort": "low"}},
            {"role": "user", "content": [{"type": "text", "text": "Continue with the short check.",
                                           "cache_control": MARKER}]},
        ])
        save("message-effort-append", [a, b], ["none", "first-user"])

    (out / "manifest.json").write_text(json.dumps({
        "provenance": "Synthetic application requests captured as exact HTTP bodies from the actual SDK on a mock transport. No provider was contacted; reply usage zeros are mock data and are not retained as measurements.",
        "python": platform.python_version(), "anthropic": anthropic.__version__,
        "httpImplementation": httpx.__name__, "httpVersion": httpx.__version__, "cases": cases,
    }, indent=2) + "\n")
    print(f"Captured {len(cases)} workflows with anthropic {anthropic.__version__}.")


if __name__ == "__main__":
    main()
