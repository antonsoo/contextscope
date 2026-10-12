"""Capture synthetic requests through the real SDK; no provider connection."""
import hashlib
import importlib.metadata
import json
import platform
import socket
import sys
from pathlib import Path

import anthropic
import httpx2

destination = Path(sys.argv[1])
destination.mkdir(parents=True, exist_ok=True)
bodies = []


def forbid_network(*args, **kwargs):
    raise AssertionError("The SDK capture must not open a network socket")


def receive(request):
    assert request.url.host == "capture.example.invalid"
    bodies.append(request.content)
    return httpx2.Response(200, json={
        "id": "msg_synthetic", "type": "message", "role": "assistant",
        "model": "claude-sonnet-5", "content": [], "stop_reason": "end_turn",
        "stop_sequence": None, "usage": {"input_tokens": 1, "output_tokens": 0},
    })


socket.socket.connect = forbid_network
socket.create_connection = forbid_network
with anthropic.Anthropic(
    api_key="synthetic-not-a-credential", base_url="https://capture.example.invalid",
    max_retries=0, http_client=httpx2.Client(transport=httpx2.MockTransport(receive)),
) as client:
    for identifier in [18446744073709551614, 18446744073709551615]:
        client.messages.create(
            model="claude-sonnet-5", max_tokens=32,
            tools=[{
                "name": "lookup", "description": "Look up the exact record identifier.",
                "input_schema": {
                    "type": "object", "properties": {"recordId": {"type": "integer", "enum": [identifier]}},
                    "required": ["recordId"],
                },
            }],
            system=[{
                "type": "text", "text": "You are a meticulous, detail-oriented coding assistant. " * 120,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": "Look up the allowed record."}],
        )
assert len(bodies) == 2
identifiers = [json.loads(body)["tools"][0]["input_schema"]["properties"]["recordId"]["enum"][0] for body in bodies]
assert identifiers == [18446744073709551614, 18446744073709551615]
data = b"\n".join(bodies) + b"\n"
(destination / "sdk-requests.jsonl").write_bytes(data)
(destination / "sdk-provenance.json").write_text(json.dumps({
    "python": platform.python_version(),
    "packages": {name: importlib.metadata.version(name) for name in ["anthropic", "httpx2"]},
    "source": "https://github.com/anthropics/anthropic-sdk-python/tree/v1.13.0",
    "transport": "httpx2.MockTransport; socket connections forbidden",
    "provenance": "Synthetic input, actual SDK serialization; no provider acceptance or cache measurement",
    "identifiers": [str(value) for value in identifiers],
    "requestBytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
}, indent=2) + "\n")
print(f"Captured {len(bodies)} SDK request bodies with distinct integer IDs")
