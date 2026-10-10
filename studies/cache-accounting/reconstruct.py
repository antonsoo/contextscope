#!/usr/bin/env python3
"""Reconstruct the 240 hash-pinned Claude histories with the existing offline SDK harness.

Usage: python3 studies/cache-accounting/reconstruct.py SCRATCH
SCRATCH needs venv/ with litellm 1.104.2 and src/mswe-v{1.13.3,1.16.0,2.0.0}/.
Only public historical request bodies are rebuilt; no inference calls are made.
"""
import concurrent.futures
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

here = Path(__file__).resolve().parent
scratch = Path(sys.argv[1]).resolve()
study = here.parent / "real-trajectories"
manifest = json.loads((study / "manifest.json").read_text())
jobs = []
for entry, data in manifest["entries"].items():
    if "claude" not in entry and "sonnet" not in entry:
        continue
    for filename, metadata in sorted(data["files"].items()):
        source = study / "cache" / entry / filename
        if hashlib.sha256(source.read_bytes()).hexdigest() != metadata["sha256"]:
            raise ValueError(f"Source hash mismatch: {source}")
        jobs.append((entry, source))


def reconstruct(job):
    entry, source = job
    tag = re.search(r"mini-(v[\d.]+)", entry).group(1)
    destination = scratch / "bodies" / entry / source.name.replace(".traj.json", ".jsonl.gz")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        # Per-process configuration is isolated; no user credentials enter the harness.
        env = {"PATH": os.environ["PATH"], "HOME": str(scratch / "isolated-home"),
               "LITELLM_LOCAL_MODEL_COST_MAP": "True", "LITELLM_LOG": "ERROR"}
        command = [str(scratch / "venv/bin/python"), "-I", str(study / "reconstruct_claude.py"),
                   str(scratch / "src" / ("mswe-" + tag) / "src"), str(source), str(destination)]
        result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=600)
        if result.returncode:
            raise RuntimeError(f"{entry}/{source.name}: {result.stderr[-2000:]}")
    raw = gzip.decompress(destination.read_bytes())
    rows = [json.loads(line) for line in raw.splitlines()]
    if len(rows) < 2 or any("error" in row for row in rows):
        raise ValueError(f"Incomplete reconstruction: {destination}")
    return {"entry": entry, "file": source.name, "requests": len(rows) - 1,
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "requestsSha256": hashlib.sha256(raw).hexdigest()}


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = []
    for result in pool.map(reconstruct, jobs):
        results.append(result)
        if len(results) % 10 == 0:
            print(f"Rebuilt and checked {len(results)}/{len(jobs)} trajectories", flush=True)
metadata = {"manifestSha256": hashlib.sha256((study / "manifest.json").read_bytes()).hexdigest(),
            "sources": results}
(scratch / "reconstruction.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(f"Complete: {len(results)} trajectories; {sum(r['requests'] for r in results)} requests", flush=True)
