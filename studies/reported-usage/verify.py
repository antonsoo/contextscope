#!/usr/bin/env python3
"""Check response counters against source JSON, then reconstruct 120 Chat trajectories.

Uses the hash-pinned, unmodified public data from ../real-trajectories/manifest.json.
No network or model calls. Raw data and rebuilt captures stay in gitignored cache/.
Python reads expected counts directly; Node runs the shipped parser/report pipeline.
"""

import argparse
import collections
import hashlib
import json
import subprocess
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHAT_ENTRIES = {
    "20251120_mini-v1.15.0_gpt-5.1-2025-11-13",
    "20251211_mini-v1.17.2_gpt-5.2-2025-12-11",
    "20251211_mini-v1.17.2_gpt-5.2-2025-12-11-high",
}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def responses(trajectory):
    for index, message in enumerate(trajectory["messages"]):
        if message.get("role") == "assistant":
            response = (message.get("extra") or {}).get("response")
            if not isinstance(response, dict):
                raise ValueError(f"Assistant message {index} has no response")
            yield index, response
        elif message.get("object") == "response":
            yield index, message


def expected_usage(usage, provider):
    """Direct source lookup, with no Contextscope estimates or normalized records."""
    if not isinstance(usage, dict):
        raise TypeError("A sampled response has no usage object")
    if "prompt_tokens" in usage:
        prompt = usage["prompt_tokens"]
        output = usage["completion_tokens"]
        if provider == "anthropic":
            read = usage["cache_read_input_tokens"]
            write = usage["cache_creation_input_tokens"]
            # Source alone cannot disambiguate historical gateway totals with writes.
            total = prompt if write == 0 else None
            read_path = "cache_read_input_tokens"
        else:
            read = usage["prompt_tokens_details"]["cached_tokens"]
            write = usage["prompt_tokens_details"].get("cache_write_tokens")
            total = prompt
            read_path = "prompt_tokens_details.cached_tokens"
    else:
        total = usage["input_tokens"]
        read = usage["input_tokens_details"]["cached_tokens"]
        write = usage["input_tokens_details"].get("cache_write_tokens")
        output = usage["output_tokens"]
        read_path = "input_tokens_details.cached_tokens"
    for value in [total, read, write, output]:
        assert value is None or (type(value) is int and 0 <= value <= 2**53 - 1)
    return {"inputTokens": total, "cacheReadTokens": read, "cacheWriteTokens": write,
            "outputTokens": output, "readPath": "response.usage." + read_path}


def main():
    if not __debug__:
        raise RuntimeError("Run without -O: verification requires assertions.")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-cache", type=Path, default=HERE.parent / "real-trajectories/cache")
    parser.add_argument("--node", default="node")
    parser.add_argument("--output", type=Path, default=HERE / "results.json")
    parser.add_argument("--fetch", action="store_true", help="Download missing files from the pinned manifest; verify their hashes before saving")
    parser.add_argument("--keep-capture", help="Retain ENTRY/FILE's reconstructed Chat capture as cache/review-capture.jsonl")
    args = parser.parse_args()
    started = time.monotonic()
    manifest_path = HERE.parent / "real-trajectories/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    cache = HERE / "cache"
    cache.mkdir(exist_ok=True)
    raw_rows, expected, sources, full_jobs = [], {}, [], []
    groups = {}
    for entry, meta in manifest["entries"].items():
        provider = "anthropic" if "claude" in entry or "sonnet" in entry else "openai"
        group = collections.Counter()
        for filename, info in sorted(meta["files"].items()):
            path = args.source_cache / entry / filename
            if args.fetch and not path.exists():
                url = manifest["bucket"].rstrip("/") + "/" + info["key"]
                with urllib.request.urlopen(url, timeout=60) as response:
                    fetched = response.read()
                assert hashlib.sha256(fetched).hexdigest() == info["sha256"], f"Download hash changed: {url}"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(fetched)
            raw = path.read_bytes()  # Missing files fail the run; no partial success.
            digest = hashlib.sha256(raw).hexdigest()
            assert digest == info["sha256"], f"Source hash changed: {entry}/{filename}"
            data = json.loads(raw)
            group["files"] += 1
            records = list(responses(data))
            assert records, f"No supported responses in {path}"
            sources.append({"entry": entry, "file": filename, "sha256": digest, "responses": len(records)})
            for index, response in records:
                key = f"{entry}/{filename}:{index}"
                usage = response["usage"]
                raw_rows.append({"key": key, "provider": provider, "usage": usage})
                expected[key] = expected_usage(usage, provider)
                group["response_counters"] += 1
                if expected[key]["inputTokens"] is None:
                    group["input_totals_withheld"] += 1
                if provider == "anthropic" and usage["cache_creation_input_tokens"] > usage["prompt_tokens"]:
                    group["creation_exceeds_gateway_prompt_count"] += 1
            if entry in CHAT_ENTRIES:
                full_jobs.append((entry, filename, data, records))
        groups[entry] = dict(group)

    if args.keep_capture and not any(f"{entry}/{filename}" == args.keep_capture for entry, filename, *_rest in full_jobs):
        raise ValueError("--keep-capture must name one of the sampled stateless OpenAI Chat trajectories")

    normalized_input, normalized_output = cache / "usage.jsonl", cache / "normalized.json"
    normalized_input.write_text("".join(json.dumps(row) + "\n" for row in raw_rows))
    subprocess.run([args.node, str(HERE / "run.mjs"), "normalize", str(normalized_input), str(normalized_output)], check=True)
    normalized = json.loads(normalized_output.read_text())
    assert len(normalized) == len(expected)
    assert {row["key"] for row in normalized} == set(expected)
    for row in normalized:
        actual, wanted = row["usage"], expected[row["key"]]
        assert actual["status"] == "valid", (row["key"], actual)
        for field in ["inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens"]:
            assert actual[field] == wanted[field], (row["key"], field, actual[field], wanted[field])
        assert {"path": wanted["readPath"], "status": "reported", "value": wanted["cacheReadTokens"]} in actual["counters"], row["key"]
    print(f"Checked {len(normalized)} raw response usage records against source counters", flush=True)

    full_results = []
    for job, (entry, filename, data, records) in enumerate(full_jobs, 1):
        packets = []
        for index, response in records:
            body = {"model": response["model"], "messages": [
                {"role": m["role"], "content": m["content"]} for m in data["messages"][:index]
            ]}
            packets.append({"request": body, "response": {"usage": response["usage"]}})
        capture = cache / "capture.jsonl"
        capture.write_text("".join(json.dumps(row) + "\n" for row in packets))
        report_path = cache / "report.json"
        subprocess.run([args.node, str(HERE / "run.mjs"), "analyze", str(capture), str(report_path)], check=True)
        report = json.loads(report_path.read_text())
        review = report["usageComparison"]
        assert report["parse"]["complete"]
        assert not review["issues"] and not review["invalidRequestIndices"] and not review["uncomparedRequestIndices"]
        assert len(review["rows"]) == len(records)
        outcomes = collections.Counter()
        reported_input = reported_read = estimated_input = simulated_read = 0
        for ordinal, ((index, _response), row) in enumerate(zip(records, review["rows"], strict=True)):
            wanted = expected[f"{entry}/{filename}:{index}"]
            assert row["requestIndex"] == ordinal
            assert row["reportedInputTokens"] == wanted["inputTokens"]
            assert row["reportedReadTokens"] == wanted["cacheReadTokens"]
            # An independent token-count relation established in the original study.
            assert row["estimatedInputTokens"] == wanted["inputTokens"], (entry, filename, index)
            assert row["inputDeltaTokens"] == 0
            assert row["readDeltaTokens"] == row["simulatedReadTokens"] - wanted["cacheReadTokens"]
            sim, read = row["simulatedReadTokens"], wanted["cacheReadTokens"]
            outcome = ("both_positive" if sim else "reported_hit_simulated_zero") if read else ("simulated_hit_reported_zero" if sim else "both_zero")
            assert row["readOutcome"] == outcome
            outcomes[outcome] += 1
            reported_input += wanted["inputTokens"]
            reported_read += read
            estimated_input += row["estimatedInputTokens"]
            simulated_read += sim
            assert report["parse"]["requests"][ordinal]["source"]["line"] == ordinal + 1
        for field, reported_sum, simulated_sum in [("input", reported_input, estimated_input), ("cacheRead", reported_read, simulated_read)]:
            assert review[field] == {"requestIndices": list(range(len(records))), "reportedTokens": reported_sum,
                                     "simulatedTokens": simulated_sum, "deltaTokens": simulated_sum - reported_sum}
        assert {k: v for k, v in review["readOutcomes"].items() if v} == dict(outcomes)
        full_results.append({"entry": entry, "file": filename, "requests": len(records),
                             "reported_input": reported_input, "reported_read": reported_read,
                             "simulated_read": simulated_read, "read_outcomes": dict(outcomes),
                             "capture_bytes": capture.stat().st_size})
        if args.keep_capture == f"{entry}/{filename}":
            (cache / "review-capture.jsonl").write_bytes(capture.read_bytes())
        if job % 10 == 0:
            print(f"Reconstructed and reconciled {job}/{len(full_jobs)} trajectories", flush=True)

    output = {
        "source_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "source_files": len(sources), "response_counters_checked": len(normalized),
        "normalization_disagreements": 0, "full_trajectories": len(full_results),
        "full_requests": sum(row["requests"] for row in full_results), "reconciliation_disagreements": 0,
        "scope": "All 520 files for usage normalization; only the 120 stateless OpenAI Chat trajectories for reconstructed-request comparisons. Gateway input totals with cache creation are withheld. No live API calls.",
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "groups": groups, "trajectories": full_results, "sources": sources,
    }
    write_json(args.output, output)
    print(json.dumps({k: output[k] for k in ["source_files", "response_counters_checked", "full_trajectories", "full_requests", "elapsed_seconds"]}), flush=True)


if __name__ == "__main__":
    main()
