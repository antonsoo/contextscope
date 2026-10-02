"""Writes tests/fixtures/sdk/: request bodies exactly as the SDKs serialize them.

Each SDK is given an HTTP client whose transport records the request and answers with a
canned reply, so no network and no API key are involved, and the bodies are what the SDK
really puts on the wire for these calls (key order, omitted defaults, how response objects
appended to the history are dumped). The conversation itself is made up.

    uv run --with anthropic --with openai python scripts/sdk-request-bodies.py

The committed fixtures were written with anthropic 1.11.0 and openai 3.23.0.
"""

from __future__ import annotations

import gzip
import importlib
import json
from pathlib import Path
from typing import Any

import anthropic
import openai

OUT = Path(__file__).parent.parent / "tests" / "fixtures" / "sdk"
MODEL = "claude-opus-5-5"

SYSTEM = "You are a careful coding agent working in a large repository. " + " ".join(
    f"Rule {i}: always explain what you changed and why, cite the file and line, "
    "and never leave a failing test behind."
    for i in range(260)
)
TOOLS = [
    {
        "name": name,
        "description": f"{name} tool. " + "Use it when the task calls for it; pass precise arguments. " * 12,
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "repository-relative path"}},
            "required": ["path"],
        },
    }
    for name in ("read_file", "write_file", "grep_search", "run_tests", "list_dir")
]


def http_module(sdk: Any) -> Any:
    for base in sdk.DefaultHttpxClient.__mro__[1:]:
        root = base.__module__.split(".")[0]
        if root.startswith("httpx"):
            return importlib.import_module(root)
    raise RuntimeError("can't tell which HTTP library the SDK uses")


def write(name: str, bodies: list[dict[str, Any]]) -> None:
    data = "".join(json.dumps(body) + "\n" for body in bodies).encode()
    with open(OUT / f"{name}.jsonl.gz", "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as f:
        f.write(data)
    print(f"{name}: {len(bodies)} requests")


def anthropic_agent_loop(mark_tail: bool, **request_options: Any) -> list[dict[str, Any]]:
    """An eight-turn tool loop. `mark_tail` puts a cache_control marker on the last block of
    each request by hand; `request_options` go to `messages.create` as they are."""
    hx = http_module(anthropic)
    captured: list[dict[str, Any]] = []

    def handler(request: Any) -> Any:
        body = json.loads(request.content)
        captured.append(body)
        turn = len(captured)
        reply = {
            "id": f"msg_{turn}",
            "type": "message",
            "role": "assistant",
            "model": body["model"],
            "content": [
                {"type": "text", "text": f"Step {turn} done."},
                {"type": "tool_use", "id": f"toolu_{turn}", "name": "read_file", "input": {"path": f"src/module_{turn}.py"}},
            ],
            "stop_reason": "tool_use",
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 20},
        }
        return hx.Response(200, json=reply)

    client = anthropic.Anthropic(
        api_key="unused", http_client=hx.Client(transport=hx.MockTransport(handler)), max_retries=0
    )

    def marked(messages: list[Any]) -> list[Any]:
        plain = json.loads(json.dumps(messages, default=lambda o: o.model_dump(exclude_none=True)))
        last = plain[-1]
        if isinstance(last["content"], str):
            last["content"] = [{"type": "text", "text": last["content"]}]
        last["content"][-1]["cache_control"] = {"type": "ephemeral"}
        return plain

    messages: list[Any] = [{"role": "user", "content": "Find and fix the failing test in the billing module."}]
    for turn in range(8):
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM,
            tools=TOOLS,
            messages=marked(messages) if mark_tail else messages,
            **request_options,
        )
        # The application keeps the SDK's own response objects as history, as the docs show.
        messages.append({"role": "assistant", "content": response.content})
        result = f"def handler_{turn}(request):\n    return compute(request) # " + "line of file content " * 60
        messages.append(
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": response.content[1].id, "content": result}]}
        )
    return captured


def openai_stored_responses() -> list[dict[str, Any]]:
    """Six turns chained with previous_response_id: each request carries only the new input."""
    hx = http_module(openai)
    captured: list[dict[str, Any]] = []

    def handler(request: Any) -> Any:
        body = json.loads(request.content)
        captured.append(body)
        n = len(captured)
        message = {
            "id": f"msg_{n}",
            "type": "message",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": f"Answer {n}.", "annotations": []}],
        }
        reply = {
            "id": f"resp_{n}",
            "object": "response",
            "created_at": 1,
            "model": body["model"],
            "status": "completed",
            "output": [message],
            "parallel_tool_calls": True,
            "tool_choice": "auto",
            "tools": [],
        }
        return hx.Response(200, json=reply)

    client = openai.OpenAI(api_key="unused", http_client=hx.Client(transport=hx.MockTransport(handler)), max_retries=0)
    previous = None
    for turn in range(6):
        chained = {"previous_response_id": previous} if previous else {}
        response = client.responses.create(
            model="gpt-6-sol",
            instructions=SYSTEM,
            input=f"Question {turn}: what does module_{turn} do?",
            prompt_cache_key="agent-session-42",
            **chained,
        )
        previous = response.id
    return captured


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write("anthropic-automatic-caching", anthropic_agent_loop(False, cache_control={"type": "ephemeral"}))
    write("anthropic-tail-breakpoint", anthropic_agent_loop(True))
    write("openai-previous-response", openai_stored_responses())
