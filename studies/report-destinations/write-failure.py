"""Exercise a real POSIX file-size write failure on disposable report files.

No filesystem fills up: the child alone gets a 7,000-byte per-file limit.
The HTML fits; the following JSON write receives EFBIG from the operating system.
"""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import signal
import subprocess


parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("cli", type=Path)
parser.add_argument("--node", default="node")
parser.add_argument("--expect", choices=["before", "after"], default="after")
args = parser.parse_args()
root = args.directory.resolve()
root.mkdir()
original = (Path(__file__).resolve().parents[2] / "tests/fixtures/sdk/openai-cache-tool-output.jsonl.gz").read_bytes()
(root / "requests.gz").write_bytes(original)
(root / "report.html").write_text("previous HTML")
(root / "report.json").write_text("previous JSON")


def limit_file_size():
    resource.setrlimit(resource.RLIMIT_FSIZE, (7000, 7000))
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)


result = subprocess.run(
    [args.node, str(args.cli.resolve()), "analyze", "requests.gz", "--html", "report.html", "--json", "report.json"],
    cwd=root, capture_output=True, text=True, preexec_fn=limit_file_size,
)
assert result.returncode == 1, result.stderr
assert "EFBIG" in result.stderr, result.stderr
assert (root / "requests.gz").read_bytes() == original
preserved = {}
for name, prior in [("report.html", b"previous HTML"), ("report.json", b"previous JSON")]:
    data = (root / name).read_bytes()
    preserved[name] = {"preserved": data == prior, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    assert (data == prior) == (args.expect == "after")
assert sorted(p.name for p in root.iterdir()) == ["report.html", "report.json", "requests.gz"]
receipt = {"mode": args.expect, "limitBytes": 7000, "exit": result.returncode, "osError": "EFBIG",
           "inputPreserved": True, "reports": preserved, "temporaryFiles": 0,
           "friendlyError": result.stderr.startswith("Could not write reports:")}
(root / "write-failure.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
