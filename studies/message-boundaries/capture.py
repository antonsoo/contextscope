"""Capture synthetic histories through the actual SDK, without network or inference.

Run with OpenAI's Python SDK installed. The transport supplies controlled replies;
request bytes and parsed history objects are the SDK's. This is not evidence of
live-server acceptance, token usage or caching. Empty-array cases are defensive
input controls, not a claim that the provider emits or accepts empty messages.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib
import json
import platform
from copy import deepcopy
from pathlib import Path
from typing import Any

import openai

MODEL = "gpt-6-sol"
SYSTEM = "Stable review rule. " * 650
QUESTION = "Review the record."
FOLLOWUP = "Continue with public records."
REFUSAL = "Cannot provide the requested record. " + "Private entry. " * 120
REVISED = "Cannot provide the revised record. " + "Different private entry. " * 120


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "fixtures")
    out = parser.parse_args().out
    out.mkdir(parents=True, exist_ok=True)
    hx = importlib.import_module(next(
        base.__module__.split(".")[0]
        for base in openai.DefaultHttpxClient.__mro__[1:]
        if base.__module__.startswith("httpx")
    ))
    captured: list[bytes] = []

    def handle(request: Any) -> Any:
        captured.append(request.content)
        body = json.loads(request.content)
        if request.url.path.endswith("/chat/completions"):
            return hx.Response(200, json={
                "id": "chatcmpl-boundary", "object": "chat.completion", "created": 1,
                "model": body["model"], "choices": [{
                    "index": 0, "finish_reason": "stop", "message": {
                        "role": "assistant", "content": None, "refusal": REFUSAL,
                    },
                }],
            })
        return hx.Response(200, json={
            "id": "resp-boundary", "object": "response", "created_at": 1,
            "model": body["model"], "status": "completed", "output": [{
                "id": "msg-boundary", "type": "message", "role": "assistant",
                "status": "completed", "phase": "commentary", "content": [],
            }], "parallel_tool_calls": True, "tool_choice": "auto", "tools": [],
        })

    catalogue: list[dict[str, Any]] = []

    def save(case_id: str, api: str, histories: list[list[Any]], *, path: str, changed: bool,
             sdk: Any, note: str = "Controlled application history") -> None:
        captured.clear()
        for history in histories:
            if api == "chat":
                sdk.chat.completions.create(model=MODEL, messages=history)
            else:
                sdk.responses.create(model=MODEL, instructions=SYSTEM, input=history)
        raw = b"\n".join(captured) + b"\n"
        name = case_id + ".jsonl.gz"
        data = gzip.compress(raw, mtime=0)
        (out / name).write_bytes(data)
        catalogue.append({
            "id": case_id, "file": name, "api": api, "changed": changed,
            "expectedMatchedSegments": 2 if changed else 4,
            "requiredSegmentPath": path,
            "rawBytes": len(raw), "rawSha256": hashlib.sha256(raw).hexdigest(),
            "gzipBytes": len(data), "gzipSha256": hashlib.sha256(data).hexdigest(),
            "provenance": note,
        })

    with openai.OpenAI(api_key="unused", http_client=hx.Client(transport=hx.MockTransport(handle)),
                       max_retries=0) as sdk:
        chat_prefix = [{"role": "developer", "content": SYSTEM},
                       {"role": "user", "content": QUESTION}]
        chat_suffix = {"role": "user", "content": FOLLOWUP}
        returned = sdk.chat.completions.create(model=MODEL, messages=chat_prefix).choices[0].message
        for changed in (True, False):
            second = returned.model_copy(update={"refusal": REVISED}) if changed else returned.model_copy()
            save("chat-refusal-" + ("changed" if changed else "identical"), "chat",
                 [[*chat_prefix, returned, chat_suffix], [*chat_prefix, second, chat_suffix]],
                 path="messages[2].refusal", changed=changed, sdk=sdk,
                 note="Parsed SDK assistant message from a controlled refusal reply; second history edited only when labelled changed")
        for case_id, first, second in (
            ("chat-empty-role", {"role": "user", "content": ""}, {"role": "assistant", "content": ""}),
            ("chat-empty-name", {"role": "user", "content": "", "name": "reviewer_a"}, {"role": "user", "content": "", "name": "reviewer_b"}),
            ("chat-empty-array", {"role": "user", "content": [], "name": "reviewer_a"}, {"role": "user", "content": [], "name": "reviewer_b"}),
            ("chat-refusal-part", {"role": "assistant", "content": [{"type": "refusal", "refusal": REFUSAL}]}, {"role": "assistant", "content": [{"type": "refusal", "refusal": REVISED}]}),
        ):
            path = "messages[2].content[0]" if case_id.endswith("part") else "messages[2].content"
            save(case_id, "chat", [[*chat_prefix, first, chat_suffix], [*chat_prefix, second, chat_suffix]],
                 path=path, changed=True, sdk=sdk,
                 note="Defensive empty-array control; SDK serialization alone does not prove server acceptance" if case_id.endswith("array") else "Controlled application history")
        empty = {"role": "user", "content": ""}
        save("chat-empty-identical", "chat", [[*chat_prefix, empty, chat_suffix]] * 2,
             path="messages[2].content", changed=False, sdk=sdk)
        save("chat-empty-insert", "chat", [[*chat_prefix, chat_suffix], [*chat_prefix, empty, chat_suffix]],
             path="messages[2].content", changed=True, sdk=sdk)

        response_prefix = [{"role": "user", "content": QUESTION}]
        response_suffix = {"role": "user", "content": FOLLOWUP}
        for changed in (True, False):
            first = {"role": "user", "content": ""}
            second = {"role": "assistant", "content": ""} if changed else deepcopy(first)
            save("responses-empty-" + ("role" if changed else "identical"), "responses",
                 [[*response_prefix, first, response_suffix], [*response_prefix, second, response_suffix]],
                 path="input[1].content", changed=changed, sdk=sdk)
        save("responses-empty-insert", "responses",
             [[*response_prefix, response_suffix], [*response_prefix, empty, response_suffix]],
             path="input[1].content", changed=True, sdk=sdk)
        output = sdk.responses.create(model=MODEL, instructions=SYSTEM, input=QUESTION).output[0]
        save("responses-empty-output-phase", "responses",
             [[*response_prefix, output, response_suffix],
              [*response_prefix, output.model_copy(update={"phase": "final_answer"}), response_suffix]],
             path="input[1].content", changed=True, sdk=sdk,
             note="Parsed SDK output message from a controlled empty-array reply; only phase edited. Not a claim that a live provider emits empty output messages")

    (out / "cases.json").write_text(json.dumps({
        "sdk": {"openai": openai.__version__, "python": platform.python_version()},
        "population": "Synthetic histories captured through the actual SDK over a mocked HTTP transport; no inference, reported token usage or provider cache observations",
        "cases": catalogue,
    }, indent=2) + "\n")
    print(f"Captured {len(catalogue)} two-request workflows with OpenAI {openai.__version__}.")


if __name__ == "__main__":
    main()
