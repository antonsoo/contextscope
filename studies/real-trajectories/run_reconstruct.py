#!/usr/bin/env python3
"""Drive the reconstruction over every sampled trajectory that can be rebuilt soundly.

Claude entries go through reconstruct_claude.py, the Chat Completions entries
of mini-SWE-agent 1.15 / 1.17 (OpenAI via Portkey) through reconstruct_openai.py.
The four Responses-API entries in entries.json are skipped: one continues a
stored response (`previous_response_id`), the other sends reasoning items by id,
so neither request body can be rebuilt from the trajectory.

Needs MSWEA_SRC (a directory holding the pinned mini-swe-agent source trees
mswe-v1.13.3, mswe-v1.16.0, mswe-v2.0.0), PYBIN (python with litellm), OUT and
HOME_SCRATCH. Each child runs with an empty environment.
"""
import glob, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, PYBIN, OUT, HOME = (os.environ[k] for k in ("MSWEA_SRC", "PYBIN", "OUT", "HOME_SCRATCH"))
ENTRIES = [e for e in json.load(open(os.path.join(HERE, "entries.json"))) if "claude" in e or "sonnet" in e or re.search(r"v1\.(15|17)\.\d_gpt", e)]


def version(entry):
    return re.search(r"mini-(v[\d.]+)", entry).group(1)


def job(args):
    entry, f = args
    out = os.path.join(OUT, entry, os.path.basename(f).replace(".traj.json", ".jsonl.gz"))
    if os.path.exists(out):
        return out, "cached"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if "_gpt" in entry:
        cmd = [PYBIN, "-I", os.path.join(HERE, "reconstruct_openai.py"), f, out]
    else:
        cmd = [PYBIN, "-I", os.path.join(HERE, "reconstruct_claude.py"), os.path.join(SRC, f"mswe-{version(entry)}", "src"), f, out]
    r = subprocess.run(["env", "-i", f"PATH={os.environ['PATH']}", f"HOME={HOME}", *cmd], capture_output=True, text=True)
    return out, (r.stdout.strip().splitlines() or [r.stderr[-300:]])[-1]


jobs = [(e, f) for e in ENTRIES for f in sorted(glob.glob(os.path.join(HERE, "cache", e, "*.json")))]
with ThreadPoolExecutor(4) as ex:
    for out, msg in ex.map(job, jobs):
        print(os.path.basename(out), msg, flush=True)
