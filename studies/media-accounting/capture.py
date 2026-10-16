"""Serialize controlled multimodal requests through real SDKs, without inference.

uv run --no-project --with anthropic==1.15.0 --with openai==3.23.0 studies/media-accounting/capture.py
All HTTP transports are mocked. Usage replies are synthetic controls.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import importlib
import io
import json
import platform
import struct
import zlib
import wave
from copy import deepcopy
from pathlib import Path

import anthropic
import openai

HERE = Path(__file__).resolve().parent
OUT = HERE / "captures"
IMAGE_URL = "https://raw.githubusercontent.com/antonsoo/contextscope/20ab1235e2bbbb9b09431f7b4f93b9699b5612b8/docs/assets/thinking-settings/after.png"


def digest(data):
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def transport_module(client):
    return importlib.import_module(next(base.__module__.split(".")[0]
        for base in client.__mro__[1:] if base.__module__.startswith("httpx")))


def recompress_png(original):
    """Keep every non-IDAT chunk and identical inflated scanlines; change compression only."""
    assert original[:8] == b"\x89PNG\r\n\x1a\n"
    chunks = []
    cursor = 8
    while cursor < len(original):
        size = struct.unpack(">I", original[cursor:cursor + 4])[0]
        kind = original[cursor + 4:cursor + 8]
        payload = original[cursor + 8:cursor + 8 + size]
        assert zlib.crc32(kind + payload) == struct.unpack(">I", original[cursor + 8 + size:cursor + 12 + size])[0]
        chunks.append((kind, payload))
        cursor += size + 12
    scanlines = zlib.decompress(b"".join(payload for kind, payload in chunks if kind == b"IDAT"))
    compressed = zlib.compress(scanlines, level=0)
    rewritten = bytearray(original[:8])
    inserted = False
    for kind, payload in chunks:
        if kind == b"IDAT":
            if inserted:
                continue
            payload = compressed
            inserted = True
        rewritten.extend(struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload)))
    width, height = struct.unpack(">II", chunks[0][1][:8])
    return bytes(rewritten), {"width": width, "height": height, "inflatedScanlines": digest(scanlines),
                              "sameNonIdatChunks": True}


def pdf_bytes():
    content = b"BT /F1 12 Tf 20 100 Td (Controlled source record. Total 42.) Tj ET"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 140] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream"]
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(data)


def main():
    OUT.mkdir(exist_ok=True)
    image = (OUT / "cache-table.png").read_bytes()
    reencoded, pixels = recompress_png(image)
    (OUT / "cache-table-uncompressed.png").write_bytes(reencoded)
    pdf = pdf_bytes()
    (OUT / "record.pdf").write_bytes(pdf)
    audio_file = io.BytesIO()
    with wave.open(audio_file, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(bytes(3200))
    audio = audio_file.getvalue()
    b64 = lambda data: base64.b64encode(data).decode()
    image_source = {"type": "base64", "media_type": "image/png", "data": b64(image)}
    image_block = {"type": "image", "source": image_source}
    document = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64(pdf)}}
    cases = []
    wire = []
    ah, oh = transport_module(anthropic.DefaultHttpxClient), transport_module(openai.DefaultHttpxClient)

    def responder(module, api):
        def handle(request):
            assert request.url.host == "sdk.invalid"
            wire.append(request.content)
            model = json.loads(request.content)["model"]
            if api == "anthropic":
                return module.Response(200, json={"id": "msg_controlled", "type": "message", "role": "assistant",
                    "model": model, "content": [{"type": "text", "text": "Controlled reply."}],
                    "stop_reason": "end_turn", "stop_sequence": None,
                    "usage": {"input_tokens": 800, "cache_read_input_tokens": 400, "cache_creation_input_tokens": 0, "output_tokens": 10}})
            if request.url.path.endswith("chat/completions"):
                return module.Response(200, json={"id": "chatcmpl_controlled", "object": "chat.completion", "created": 1,
                    "model": model, "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "Controlled reply."}}],
                    "usage": {"prompt_tokens": 1200, "prompt_tokens_details": {"cached_tokens": 400}, "completion_tokens": 10, "total_tokens": 1210}})
            return module.Response(200, json={"id": "resp_controlled", "object": "response", "created_at": 1,
                "model": model, "status": "completed", "output": [], "parallel_tool_calls": True, "tool_choice": "auto", "tools": [],
                "usage": {"input_tokens": 1200, "input_tokens_details": {"cached_tokens": 400},
                          "output_tokens": 10, "output_tokens_details": {"reasoning_tokens": 0}, "total_tokens": 1210}})
        return handle

    with anthropic.Anthropic(api_key="synthetic-unused", base_url="http://sdk.invalid", max_retries=0,
            http_client=ah.Client(transport=ah.MockTransport(responder(ah, "anthropic")))) as claude, \
         openai.OpenAI(api_key="synthetic-unused", base_url="http://sdk.invalid", max_retries=0,
            http_client=oh.Client(transport=oh.MockTransport(responder(oh, "openai")))) as gpt:
        def save(name, api, requests, paths, paired=False):
            records = []
            for body in requests:
                wire.clear()
                reply = (claude.messages.create(**body) if api == "anthropic" else
                         gpt.chat.completions.create(**body) if api == "chat" else gpt.responses.create(**body))
                record = wire[0]
                if paired:
                    usage = json.dumps(reply.usage.model_dump(exclude_none=True), separators=(",", ":")).encode()
                    record = b'{"request":' + record + b',"response":{"usage":' + usage + b'}}'
                records.append(record)
            raw = b"\n".join(records) + b"\n"
            packed = gzip.compress(raw, mtime=0)
            name_file = name + ".jsonl.gz"
            (OUT / name_file).write_bytes(packed)
            cases.append({"name": name, "api": api, "file": name_file, "unmodeledPaths": paths,
                          "pairedSyntheticUsage": paired, "raw": digest(raw), "gzip": digest(packed)})

        def cb(block):
            return {"model": "claude-sonnet-4-6", "max_tokens": 256,
                    "messages": [{"role": "user", "content": [{"type": "text", "text": "Read the second cache row."}, deepcopy(block)]}]}

        variants = [image_block, {"type": "image", "source": {**image_source, "data": b64(reencoded)}},
                    {"type": "image", "source": {"type": "url", "url": IMAGE_URL}},
                    {"type": "image", "source": {"type": "file", "file_id": "file_synthetic_image"}}]
        save("anthropic-image-transports", "anthropic", [cb(block) for block in variants], [["messages[0].content[1]"]] * len(variants))
        save("anthropic-pdf-transports", "anthropic", [cb(block) for block in [document,
             {"type": "document", "source": {"type": "url", "url": "https://example.invalid/record.pdf"}},
             {"type": "document", "source": {"type": "file", "file_id": "file_synthetic_pdf"}}]], [["messages[0].content[1]"]] * 3)
        a = cb(image_block)
        a["tools"] = [{"name": "capture", "input_schema": {"type": "object", "properties": {}}}]
        a["messages"] = [{"role": "user", "content": "Capture the cache table."},
            {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_controlled", "name": "capture", "input": {}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_controlled", "content": [{"type": "text", "text": "Screenshot follows."}, image_block]}]}]
        save("anthropic-tool-image", "anthropic", [a], [["messages[2].content[0]"]])
        save("anthropic-custom-document", "anthropic", [cb({"type": "document", "source": {"type": "content", "content": [image_block]}})], [["messages[0].content[1]"]])
        save("anthropic-reported-usage", "anthropic", [cb(image_block)] * 2, [["messages[0].content[1]"]] * 2, paired=True)

        def chat(block):
            return {"model": "gpt-5.1", "messages": [{"role": "user", "content": [{"type": "text", "text": "Read the second cache row."}, deepcopy(block)]}]}

        save("chat-image-transports", "chat", [chat({"type": "image_url", "image_url": {"url": url}})
             for url in ["data:image/png;base64," + b64(image), "data:image/png;base64," + b64(reencoded), IMAGE_URL]], [["messages[0].content[1]"]] * 3)
        save("chat-file", "chat", [chat({"type": "file", "file": {"filename": "record.pdf", "file_data": "data:application/pdf;base64," + b64(pdf)}})], [["messages[0].content[1]"]])
        save("chat-audio", "chat", [chat({"type": "input_audio", "input_audio": {"data": b64(audio), "format": "wav"}})], [["messages[0].content[1]"]])
        save("chat-reported-usage", "chat", [chat({"type": "image_url", "image_url": {"url": IMAGE_URL}})] * 2, [["messages[0].content[1]"]] * 2, paired=True)

        def responses(block):
            return {"model": "gpt-5.1", "input": [{"role": "user", "content": [{"type": "input_text", "text": "Read the second cache row."}, deepcopy(block)]}]}

        save("responses-image-transports", "responses", [responses(block) for block in [
            {"type": "input_image", "image_url": "data:image/png;base64," + b64(image)},
            {"type": "input_image", "image_url": IMAGE_URL}, {"type": "input_image", "file_id": "file_synthetic_image"}]], [["input[0].content[1]"]] * 3)
        save("responses-file", "responses", [responses(block) for block in [
            {"type": "input_file", "filename": "record.pdf", "file_data": "data:application/pdf;base64," + b64(pdf)},
            {"type": "input_file", "file_id": "file_synthetic_pdf"}, {"type": "input_file", "file_url": "https://example.invalid/record.pdf"}]], [["input[0].content[1]"]] * 3)
        save("responses-tool-image", "responses", [{"model": "gpt-5.1", "input": [
            {"type": "function_call", "id": "fc_controlled", "call_id": "call_controlled", "name": "capture", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "call_controlled", "output": [{"type": "input_image", "image_url": IMAGE_URL}]}]}], [["input[1].output[0]"]])
        save("responses-computer-image", "responses", [{"model": "computer-use-preview", "tools": [
            {"type": "computer_use_preview", "display_width": pixels["width"], "display_height": pixels["height"], "environment": "browser"}], "input": [
            {"type": "computer_call", "id": "cu_controlled", "call_id": "call_controlled", "action": {"type": "screenshot"}, "pending_safety_checks": []},
            {"type": "computer_call_output", "call_id": "call_controlled", "output": {"type": "computer_screenshot", "image_url": IMAGE_URL}}]}], [["input[1]"]])
        save("responses-reported-usage", "responses", [responses({"type": "input_image", "image_url": IMAGE_URL})] * 2, [["input[0].content[1]"]] * 2, paired=True)

        literal = {"type": "text", "text": 'A literal {"type":"image","source":{"type":"base64","data":"SGVsbG8="}} is text.'}
        save("anthropic-literal-control", "anthropic", [cb(literal)] * 2, [[], []])
        save("chat-literal-control", "chat", [chat(literal)] * 2, [[], []])
        save("responses-literal-control", "responses", [responses({**literal, "type": "input_text"})] * 2, [[], []])

    (OUT / "manifest.json").write_text(json.dumps({"baseline": "6fc3ca10e3082b5be0e83edcd68511c9f789abbe",
        "provenance": "Controlled SDK-serialized application requests over mock transports. No provider calls, live acceptance, token measurements or cache measurements. Paired usage values are synthetic controls.",
        "sdk": {"anthropic": anthropic.__version__, "openai": openai.__version__, "python": platform.python_version()},
        "image": {"source": "Owned Contextscope production screenshot, docs/assets/thinking-settings/after.png", "url": IMAGE_URL,
                  "original": digest(image), "recompressed": digest(reencoded), **pixels},
        "pdf": digest(pdf), "audio": digest(audio), "cases": cases}, indent=2) + "\n")
    print(f"Captured {len(cases)} workflows; identical image scanlines in {len(image)} and {len(reencoded)} byte PNGs.")


if __name__ == "__main__":
    main()
