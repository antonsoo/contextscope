# /// script
# requires-python = ">=3.12"
# dependencies = ["anthropic==1.15.0", "openai==3.35.1", "httpx2==2.14.0"]
# ///
"""Capture native SDK connector bodies, with synthetic replies over MockTransport.

No provider or MCP server is contacted. SDK serialization establishes the wire
shape, not live acceptance, cache behavior, provider token counts or charges.
Reported usage and the returned tool listing are explicitly synthetic controls.
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
import openai

HERE = Path(__file__).resolve().parent
MODEL = "claude-sonnet-4-6"
TEXT = "Inspect the retained incident evidence. " * 1600
LOCAL = {
    "name": "inspect_artifact",
    "description": "Read retained build evidence.",
    "input_schema": {
        "type": "object",
        "properties": {"artifact": {"type": "string"}},
        "required": ["artifact"],
    },
}


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    output = HERE / "captures"
    output.mkdir(exist_ok=True)
    http = importlib.import_module(
        next(
            base.__module__.split(".")[0]
            for base in anthropic.DefaultHttpxClient.__mro__[1:]
            if base.__module__.startswith("httpx")
        )
    )
    wire = []
    reads = []

    def handle(request):
        assert request.url.host == "sdk.invalid"
        assert request.url.path == "/v1/messages"
        assert str(request.url).endswith("/v1/messages?beta=true")
        wire.append(
            {"body": request.content, "beta": request.headers["anthropic-beta"]}
        )
        content = [{"type": "text", "text": "Synthetic transport reply."}]
        if json.loads(request.content).get("mcp_servers"):
            content.insert(
                0,
                {
                    "type": "mcp_tool_listing",
                    "mcp_server_name": "diagnostics",
                    "tools": [LOCAL],
                },
            )
        return http.Response(
            200,
            json={
                "id": "msg_synthetic",
                "type": "message",
                "role": "assistant",
                "model": MODEL,
                "content": content,
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {
                    "input_tokens": 12000,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": reads.pop(0) if reads else 0,
                    "output_tokens": 10,
                },
            },
        )

    cases = []
    catalog = json.loads((HERE / "catalog.json").read_text())
    public_endpoint = catalog["endpoint"]
    with anthropic.Anthropic(
        api_key="synthetic-unused",
        base_url="http://sdk.invalid",
        max_retries=0,
        http_client=http.Client(transport=http.MockTransport(handle)),
    ) as client:

        def body(**settings):
            return {
                "model": MODEL,
                "max_tokens": 64,
                "cache_control": {"type": "ephemeral"},
                "messages": [{"role": "user", "content": TEXT}],
                **settings,
            }

        def server(label="alpha"):
            return {
                "type": "url",
                "name": "diagnostics",
                "url": f"https://{label}.example.com/mcp",
            }

        toolset = {"type": "mcp_toolset", "mcp_server_name": "diagnostics"}

        def save(name, requests, unknown=True, beta="mcp-client-2026-09-15", note=None):
            records, headers = [], []
            reads[:] = [0, 400]
            for request in requests:
                wire.clear()
                response = client.beta.messages.create(betas=[beta], **request)
                captured = wire[0]
                usage = json.dumps(
                    response.usage.model_dump(exclude_none=True)
                ).encode()
                records.append(
                    b'{"request":'
                    + captured["body"]
                    + b',"response":{"usage":'
                    + usage
                    + b"}}"
                )
                headers.append(captured["beta"])
            raw = b"\n".join(records) + b"\n"
            packed = gzip.compress(raw, mtime=0)
            filename = name + ".jsonl.gz"
            (output / filename).write_bytes(packed)
            cases.append(
                {
                    "name": name,
                    "file": filename,
                    "provider": "anthropic",
                    "unmodeledMcp": unknown,
                    "betaHeaders": headers,
                    "note": note,
                    "raw": digest(raw),
                    "gzip": digest(packed),
                }
            )

        save(
            "local-tools-control",
            [body(tools=[LOCAL])] * 2,
            unknown=False,
            note="Ordinary local tool definitions; unchanged token, cache and usage comparison control.",
        )
        save(
            "connector-server-switch",
            [
                body(mcp_servers=[server(label)], tools=[toolset])
                for label in ["alpha", "beta"]
            ],
        )
        save(
            "connector-same-server", [body(mcp_servers=[server()], tools=[toolset])] * 2
        )
        save(
            "public-catalog-connector",
            [
                body(
                    mcp_servers=[
                        {"type": "url", "name": "public_docs", "url": public_endpoint}
                    ],
                    tools=[{"type": "mcp_toolset", "mcp_server_name": "public_docs"}],
                )
            ]
            * 2,
            note="The endpoint has a separately discovered public catalog. SDK replies and usage remain authored mocks, not provider observations.",
        )
        save(
            "deferred-connector",
            [
                body(
                    mcp_servers=[server()],
                    tools=[{**toolset, "default_config": {"defer_loading": True}}],
                )
            ]
            * 2,
        )
        save(
            "pinned-connector",
            [body(mcp_servers=[server()], tools=[{**toolset, "tools": [LOCAL]}])] * 2,
            note="Definitions are supplied, but this estimator does not implement MCP's provider rendering.",
        )
        legacy = {**server(), "tool_configuration": {"enabled": True}}
        save(
            "legacy-connector",
            [body(mcp_servers=[legacy])] * 2,
            beta="mcp-client-2025-04-04",
            note="Documented deprecated layout; serialization does not establish current provider acceptance.",
        )
        # Capture a returned native SDK block, then replay it unchanged in the
        # assistant history. The returned listing is authored mock data.
        seed = client.beta.messages.create(
            betas=["mcp-client-2026-09-15"],
            **body(mcp_servers=[server()], tools=[toolset]),
        )
        listing = seed.content[0]
        assert listing.type == "mcp_tool_listing"
        history = [
            {"role": "user", "content": "Inventory the available tools."},
            {"role": "assistant", "content": seed.content},
            {"role": "user", "content": TEXT},
        ]
        save(
            "recorded-tool-listing",
            [body(mcp_servers=[server()], tools=[toolset], messages=deepcopy(history))]
            * 2,
            note=f"Synthetic listing decoded as {type(listing).__name__} and reserialized by the SDK.",
        )

    def openai_reply(request):
        assert request.url.host == "sdk.invalid" and request.url.path == "/v1/responses"
        wire.append(request.content)
        body = json.loads(request.content)
        content = [
            {
                "id": "msg_synthetic",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {
                        "type": "output_text",
                        "text": "Synthetic transport reply.",
                        "annotations": [],
                    }
                ],
            }
        ]
        if any(tool.get("type") == "mcp" for tool in body.get("tools", [])):
            content.insert(
                0,
                {
                    "id": "mcpl_controlled",
                    "type": "mcp_list_tools",
                    "server_label": "diagnostics",
                    "tools": [LOCAL],
                },
            )
        return http.Response(
            200,
            json={
                "id": "resp_synthetic",
                "object": "response",
                "created_at": 1,
                "model": body["model"],
                "status": "completed",
                "output": content,
                "parallel_tool_calls": True,
                "tool_choice": "auto",
                "tools": body.get("tools", []),
                "usage": {
                    "input_tokens": 12000,
                    "input_tokens_details": {
                        "cached_tokens": reads.pop(0) if reads else 0
                    },
                    "output_tokens": 10,
                    "output_tokens_details": {"reasoning_tokens": 0},
                    "total_tokens": 12010,
                },
            },
        )

    with openai.OpenAI(
        api_key="synthetic-unused",
        base_url="http://sdk.invalid/v1",
        max_retries=0,
        http_client=http.Client(transport=http.MockTransport(openai_reply)),
    ) as client:

        def response_body(**settings):
            return {"model": "gpt-5.1", "input": TEXT, **settings}

        def remote(label="alpha"):
            return {
                "type": "mcp",
                "server_label": "diagnostics",
                "server_url": f"https://{label}.example.com/mcp",
                "require_approval": "never",
            }

        def save_response(name, requests, unknown=True, note=None):
            records = []
            reads[:] = [0, 400]
            for request in requests:
                wire.clear()
                response = client.responses.create(**request)
                usage = json.dumps(
                    response.usage.model_dump(exclude_none=True)
                ).encode()
                records.append(
                    b'{"request":' + wire[0] + b',"response":{"usage":' + usage + b"}}"
                )
            raw = b"\n".join(records) + b"\n"
            packed = gzip.compress(raw, mtime=0)
            filename = name + ".jsonl.gz"
            (output / filename).write_bytes(packed)
            cases.append(
                {
                    "name": name,
                    "file": filename,
                    "provider": "openai",
                    "unmodeledMcp": unknown,
                    "note": note,
                    "raw": digest(raw),
                    "gzip": digest(packed),
                }
            )

        local = {
            "type": "function",
            "name": LOCAL["name"],
            "description": LOCAL["description"],
            "parameters": LOCAL["input_schema"],
        }
        save_response(
            "openai-local-tools-control",
            [response_body(tools=[local])] * 2,
            unknown=False,
        )
        save_response(
            "openai-connector-same-server", [response_body(tools=[remote()])] * 2
        )
        save_response(
            "openai-public-catalog-connector",
            [
                response_body(
                    tools=[
                        {
                            "type": "mcp",
                            "server_label": "public_docs",
                            "server_url": public_endpoint,
                            "require_approval": "never",
                        }
                    ]
                )
            ]
            * 2,
            note="The endpoint has a separately discovered public catalog. SDK replies and usage remain authored mocks, not provider observations.",
        )
        save_response(
            "openai-connector-server-switch",
            [response_body(tools=[remote(label)]) for label in ["alpha", "beta"]],
        )
        seed = client.responses.create(**response_body(tools=[remote()]))
        listing = seed.output[0]
        assert listing.type == "mcp_list_tools"
        history = [*seed.output, {"role": "user", "content": TEXT}]
        save_response(
            "openai-recorded-tool-listing",
            [response_body(tools=[remote()], input=deepcopy(history))] * 2,
            note=f"Synthetic listing decoded as {type(listing).__name__} and reserialized by the SDK.",
        )
    manifest = {
        "scope": __doc__,
        "python": platform.python_version(),
        "anthropic": anthropic.__version__,
        "openai": openai.__version__,
        "publicCatalog": {
            "ledger": "catalog.json",
            "sha256": digest((HERE / "catalog.json").read_bytes())["sha256"],
            "endpoint": public_endpoint,
            "toolCount": catalog["toolCount"],
        },
        "transport": {"module": http.__name__, "version": http.__version__},
        "cases": cases,
    }
    (HERE / "capture.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        json.dumps(
            {
                "captures": len(cases),
                "records": 2 * len(cases),
                "providerRequests": 0,
                "mcpServerRequests": 0,
                "sdks": {
                    "anthropic": anthropic.__version__,
                    "openai": openai.__version__,
                },
            }
        )
    )


if __name__ == "__main__":
    main()
