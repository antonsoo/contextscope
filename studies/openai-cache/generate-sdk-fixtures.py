"""Capture synthetic cache scenarios through OpenAI Python 2.54.0's real serializer.

The HTTP transport is replaced before the client is constructed. Canned responses
carry no usage, and only outgoing request bodies are retained. No provider calls.
Run with an isolated environment and the pinned SDK installed, from the repo root.
"""
import gzip
import hashlib
import json
from pathlib import Path
import httpx
import openai

assert openai.__version__ == "2.54.0", "Use the pinned SDK to reproduce these fixtures"
captured = []


def capture(request):
    body = json.loads(request.content)
    captured.append(body)
    return httpx.Response(200, json={
        "id": "resp_offline", "object": "response", "created_at": 0,
        "status": "completed", "model": body["model"], "output": [],
    })


client = openai.OpenAI(api_key="offline-placeholder", base_url="https://offline.invalid/v1",
                      http_client=httpx.Client(transport=httpx.MockTransport(capture)), max_retries=0)
reference = "Stable evidence for the decision. " * 400
for case, mode, marked in [("disabled", "explicit", False), ("implicit", "implicit", False), ("marked", "explicit", True)]:
    for turn in range(2):
        block = {"type": "input_text", "text": reference}
        if marked:
            block["prompt_cache_breakpoint"] = {"mode": "explicit"}
        client.responses.create(model="gpt-6-sol", prompt_cache_key=case,
            prompt_cache_options={"mode": mode, "ttl": "30m"}, input=[
                {"role": "developer", "content": [block]},
                {"role": "user", "content": f"task {turn}"},
            ])


def save(path, bodies):
    data = ("\n".join(json.dumps(body, separators=(",", ":")) for body in bodies) + "\n").encode()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(gzip.compress(data, mtime=0))
    return {"path": path, "requests": len(bodies), "jsonlSha256": hashlib.sha256(data).hexdigest()}


examples = save("examples/openai-cache-modes.jsonl.gz", captured)
captured.clear()
for call, tail in [("call_a", "first"), ("call_a", "second"), ("call_b", "second")]:
    client.responses.create(model="gpt-6-sol", prompt_cache_options={"mode": "explicit"}, input=[
        {"type": "function_call", "call_id": call, "name": "read_evidence", "arguments": "{}"},
        {"type": "function_call_output", "call_id": call, "output": [
            {"type": "input_text", "text": reference, "prompt_cache_breakpoint": {"mode": "explicit"}},
            {"type": "input_text", "text": tail},
        ]},
    ])
tools = save("tests/fixtures/sdk/openai-cache-tool-output.jsonl.gz", captured)
manifest = {"kind": "synthetic request bodies serialized by the real SDK; mocked transport, no provider usage",
            "openai": openai.__version__, "httpx": httpx.__version__, "providerCalls": 0, "fixtures": [examples, tools]}
Path("studies/openai-cache/sdk-fixtures.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest))
