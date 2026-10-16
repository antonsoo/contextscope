"""Capture controlled native Responses bodies through a mock HTTP transport.

uv run --no-project --with openai==3.23.0 studies/stored-context/capture.py
No provider, stored object, model inference or token measurement is contacted.
Mock replies, IDs and usage are synthetic controls, not acceptance evidence.
"""
from __future__ import annotations

import gzip
import hashlib
import importlib
import json
import platform
from copy import deepcopy
from pathlib import Path

import openai
from openai.types.responses.response_input_item_param import ItemReference

HERE = Path(__file__).resolve().parent
OUT = HERE / "captures"
MODEL = "gpt-5.1"
TEXT = "Summarize the supplied reference carefully. " * 650


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    OUT.mkdir(exist_ok=True)
    http = importlib.import_module(next(base.__module__.split(".")[0]
        for base in openai.DefaultHttpxClient.__mro__[1:] if base.__module__.startswith("httpx")))
    wire = []
    usage_reads = []
    serial = 0

    def handle(request):
        nonlocal serial
        assert request.url.host == "sdk.invalid"
        serial += 1
        body = json.loads(request.content)
        if request.url.path.rstrip("/").endswith("/conversations"):
            return http.Response(200, json={"id": f"conv_controlled_{serial}", "object": "conversation", "created_at": 1, "metadata": {}})
        wire.append(request.content)
        return http.Response(200, json={"id": f"resp_controlled_{serial}", "object": "response", "created_at": 1,
            "model": body.get("model", MODEL), "status": "completed", "output": [{"id": f"msg_controlled_{serial}",
                "type": "message", "role": "assistant", "status": "completed",
                "content": [{"type": "output_text", "text": "Controlled saved response.", "annotations": []}]}],
            "parallel_tool_calls": True, "tool_choice": "auto", "tools": [],
            "usage": {"input_tokens": 12000, "input_tokens_details": {"cached_tokens": usage_reads.pop(0) if usage_reads else 400},
                      "output_tokens": 10, "output_tokens_details": {"reasoning_tokens": 0}, "total_tokens": 12010}})

    cases = []
    with openai.OpenAI(api_key="synthetic-unused", base_url="http://sdk.invalid", max_retries=0,
            http_client=http.Client(transport=http.MockTransport(handle))) as sdk:
        # These IDs come from actual SDK response objects, supplied by the mock.
        # The seed requests are deliberately absent from the workflow log.
        seeds = [sdk.responses.create(model=MODEL, input=f"Controlled hidden source {name}.", store=True) for name in ["alpha", "beta"]]
        conversations = [sdk.conversations.create(items=[{"type": "message", "role": "user", "content": f"Controlled hidden source {name}."}]) for name in ["alpha", "beta"]]

        def save(name, requests, unknown, paired=False, error=None, note=None, append_response=False):
            records = []
            usage_reads[:] = [0, 400] if paired else []
            for body in requests:
                wire.clear()
                reply = sdk.responses.create(**body)
                record = wire[0]
                if paired:
                    usage = json.dumps(reply.usage.model_dump(exclude_none=True), separators=(",", ":")).encode()
                    record = b'{"request":' + record + b',"response":{"usage":' + usage + b'}}'
                records.append(record)
            if append_response:
                # A native response can echo tool definitions. It is still not
                # another request, and its usage cannot be joined implicitly.
                response = reply.model_dump(exclude_none=True)
                response["tools"] = [{"type": "function", "name": "lookup", "parameters": {"type": "object"}}]
                records.append(json.dumps(response, separators=(",", ":")).encode())
            raw = b"\n".join(records) + b"\n"
            packed = gzip.compress(raw, mtime=0)
            file = name + ".jsonl.gz"
            (OUT / file).write_bytes(packed)
            cases.append({"name": name, "file": file, "unresolvedPaths": unknown,
                "pairedSyntheticUsage": paired, "expectedError": error, "note": note,
                "expectedSkippedRecords": 1 if append_response else 0,
                "raw": digest(raw), "gzip": digest(packed)})

        def body(**settings):
            return {"model": MODEL, "input": TEXT, **settings}

        a, b = (seed.id for seed in seeds)
        ca, cb = (conversation.id for conversation in conversations)
        save("previous-response-change", [body(previous_response_id=a), body(previous_response_id=b)], [["previous_response_id"]] * 2)
        save("previous-response-same", [body(previous_response_id=a)] * 2, [["previous_response_id"]] * 2)
        save("conversation-change", [body(conversation=ca), body(conversation=cb)], [["conversation"]] * 2)
        save("conversation-object", [body(conversation=ca), body(conversation={"id": ca})], [["conversation"]] * 2)
        save("prompt-template-change", [body(prompt={"id": "pmpt_controlled_alpha", "variables": {"subject": "reference"}}),
            body(prompt={"id": "pmpt_controlled_beta", "variables": {"subject": "reference"}})], [["prompt"]] * 2)
        save("prompt-variable-change", [body(prompt={"id": "pmpt_controlled_alpha", "variables": {"subject": name}}) for name in ["alpha", "beta"]], [["prompt"]] * 2)
        ids = [seed.output[0].id for seed in seeds]
        def referenced(reference):
            return {"model": MODEL, "input": [reference, {"role": "user", "content": TEXT}]}
        save("item-reference-change", [referenced(ItemReference(id=identifier, type="item_reference")) for identifier in ids], [["input[0]"]] * 2)
        save("item-reference-defaults", [referenced(ItemReference(id=ids[0])), referenced(ItemReference(id=ids[0], type=None)),
            referenced(ItemReference(id=ids[0], type="item_reference"))], [["input[0]"]] * 3)
        save("item-reference-only", [{"model": MODEL, "input": [ItemReference(id=identifier)]} for identifier in ids], [["input[0]"]] * 2)
        save("previous-response-only", [{"model": MODEL, "previous_response_id": identifier} for identifier in [a, b]], [["previous_response_id"]] * 2,
             note="Defensive request-only reference control; SDK serialization does not establish live acceptance without new input.")
        save("prompt-only", [{"model": MODEL, "prompt": {"id": "pmpt_controlled_alpha", "variables": {"subject": name}}} for name in ["alpha", "beta"]], [["prompt"]] * 2)
        reasoning = {"type": "reasoning", "id": "rs_controlled", "summary": [{"type": "summary_text", "text": "Controlled summary."}],
                     "encrypted_content": "controlled-opaque-reasoning-payload"}
        changed = deepcopy(reasoning); changed["encrypted_content"] = "different-opaque-reasoning-payload" * 100
        save("encrypted-reasoning", [referenced(block) for block in [reasoning, changed]], [["input[0]"]] * 2,
             note="Opaque strings are synthetic, not valid provider ciphertext or equal-plaintext claims.")
        summary = deepcopy(reasoning); del summary["encrypted_content"]
        save("reasoning-summary-only", [referenced(summary)] * 2, [["input[0]"]] * 2,
             note="A summary and item ID do not expose the full referenced reasoning context.")
        compact = {"type": "compaction", "id": "cmp_controlled", "encrypted_content": "controlled-opaque-compaction-payload"}
        save("compaction", [{**referenced(compact), "model": "gpt-6-astra"}] * 2, [["input[0]"]] * 2,
             note="Synthetic opaque compaction payload, not valid provider ciphertext or live model acceptance evidence.")
        save("reported-usage", [body(previous_response_id=a), body(previous_response_id=b)], [["previous_response_id"]] * 2, paired=True)
        save("mixed-known-unknown", [body(), body(previous_response_id=a), body()], [[], ["previous_response_id"], []])
        save("store-control", [body(), body(store=True), body(store=False)], [[], [], []])
        save("null-control", [body(), body(previous_response_id=None, conversation=None, prompt=None)], [[], []])
        literal = '{"type":"item_reference","id":"msg_literal","previous_response_id":"resp_literal","conversation":"conv_literal"}'
        save("literal-control", [body(input=TEXT + literal, metadata={"previous_response_id": "resp_literal"})] * 2, [[], []])
        save("invalid-mutual-state", [body(previous_response_id=a, conversation=ca)], [], error="cannot combine")
        save("invalid-identifier", [body(previous_response_id=42)], [], error="string")
        save("response-object-control", [body()], [[], []], append_response=True)

    (OUT / "manifest.json").write_text(json.dumps({"baseline": "ecc601b2c83cf93b509ad2d4ea61e493201cc508",
        "provenance": "Controlled application requests serialized by the actual SDK over a mock transport. No provider inference, token/cache measurement or live acceptance check. IDs, replies and paired usage are synthetic controls.",
        "sdk": {"openai": openai.__version__, "python": platform.python_version(), "http": http.__name__, "httpVersion": http.__version__},
        "unloggedMockSeeds": [{"responseId": seed.id, "outputItemId": seed.output[0].id, "source": name} for seed, name in zip(seeds, ["alpha", "beta"])],
        "cases": cases}, indent=2) + "\n")
    print(f"Captured {len(cases)} controlled workflows through OpenAI SDK {openai.__version__}.")


if __name__ == "__main__":
    main()
