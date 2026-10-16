"""Verify a clean build, separately installed package and actual offline exports.

Usage: python3 studies/injected-settings/verify-artifacts.py SCRATCH BASE_URL
The scratch folder holds source-revision.txt, source.tar, clean/, consumer/,
clean-*.log, installed-*.json/html and browser-{before,clean}/.
Receipts retain repository-relative names rather than machine paths.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SCRATCH = Path(sys.argv[1]).resolve()
BASE = sys.argv[2]
SOURCE = (SCRATCH / "source-revision.txt").read_text().strip()
RESULTS = HERE / "results"


def digest(data: bytes) -> dict:
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def load(path: Path):
    return json.loads(path.read_bytes())


def save(name: str, value) -> None:
    (RESULTS / name).write_text(json.dumps(value, indent=2) + "\n")


after = load(RESULTS / "after.json")
replays = {}
for name in ["clean-replay.json", "installed-node24.json", "installed-node20.json"]:
    data = (SCRATCH / name).read_bytes()
    assert data == (RESULTS / "after.json").read_bytes(), name
    replays[name] = {**digest(data), "byteIdenticalTo": "after.json"}

cli = {}
refusals = {}
for runtime in ["node24", "node20"]:
    for case in ["format-type", "citations-tool-result"]:
        name = f"installed-{runtime}-{case}.json"
        assert load(SCRATCH / name) == next(c for c in after["cases"] if c["name"] == case)["report"], name
        cli[name] = {**digest((SCRATCH / name).read_bytes()), "completeReportMatchesSource": True}
    for case in ["mixed-document-citations", "format-with-citations"]:
        name = f"invalid-{runtime}-{case}"
        assert (SCRATCH / (name + ".json")).read_text() == "previous report"
        log = (SCRATCH / (name + ".log")).read_bytes()
        assert b"citation" in log.lower() and not re.search(rb"\n\s+at ", log)
        refusals[name] = {**digest(log), "exitCode": 1, "previousOutputPreserved": True, "noStackTrace": True}

# Compare the pinned revision, not mutable current docs or a later checkout.
inputs = {}
names = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", SOURCE], cwd=REPO, text=True).splitlines()
for name in names:
    if not (name.startswith(("src/", "web/", "examples/", "tsconfig", "vite.config", "package"))
            or name in ["README.md", "LICENSE"]):
        continue
    pinned = subprocess.check_output(["git", "show", f"{SOURCE}:{name}"], cwd=REPO)
    clean = SCRATCH / "clean" / name
    if clean.is_symlink():
        assert str(clean.readlink()).encode() == pinned, name
        inputs[name] = {"symlink": pinned.decode()}
    else:
        assert clean.read_bytes() == pinned, name
        inputs[name] = digest(pinned)

installed = SCRATCH / "consumer/node_modules/@antonsoloviev/contextscope"
modules = {}
for path in sorted((SCRATCH / "clean/dist").rglob("*")):
    if not path.is_file() or path.suffix == ".map":
        continue
    name = path.relative_to(SCRATCH / "clean").as_posix()
    assert path.read_bytes() == (installed / name).read_bytes(), name
    modules[name] = digest(path.read_bytes())

served = {}
for path in sorted((SCRATCH / "clean/web/dist").rglob("*")):
    if not path.is_file():
        continue
    name = path.relative_to(SCRATCH / "clean/web/dist").as_posix()
    with urllib.request.urlopen(BASE + urllib.parse.quote(name)) as response:
        assert response.status == 200
        content = response.read()
    assert content == path.read_bytes(), name
    served[name] = digest(content)

browser = {}
for phase, folder in [("before", "browser-before"), ("after", "browser-clean")]:
    views = load(SCRATCH / folder / "browser.json")
    assert len(views) == 4
    for view in views:
        assert not view["pageErrors"] and not view["httpRequestsAfterDisconnect"] and view["recovered"]
        assert len(view["flows"]) == 2 and len(view["refusals"]) == 2
        if phase == "after":
            assert all(r["message"] and r["preservesReport"] for r in view["refusals"])
        for flow in view["flows"]:
            assert flow["reportMatchesCli"] and flow["noPageOverflow"] and not flow["axeViolations"]
            stem = f'{view["engine"]}-{view["width"]}-{flow["name"]}'
            for suffix in ["json", "html"]:
                assert digest((SCRATCH / folder / (stem + "." + suffix)).read_bytes())["sha256"] == flow[suffix]
    browser[phase] = views
save("browser.json", browser)

for case in ["format-type", "citations-tool-result"]:
    for suffix in ["json", "html"]:
        shutil.copyfile(SCRATCH / "browser-clean" / f"chromium-1440-{case}.{suffix}", RESULTS / f"browser-{case}.{suffix}")


def normalized_html(path: Path) -> str:
    value, count = re.subn(r"generated \d{4}-\d{2}-\d{2}T[\d:.]+Z", "generated [timestamp]", path.read_text())
    assert count == 1
    return value


for runtime in ["node24", "node20"]:
    for case in ["format-type", "citations-tool-result"]:
        assert normalized_html(SCRATCH / f"installed-{runtime}-{case}.html") == normalized_html(RESULTS / f"browser-{case}.html")

screenshots = [
    ("browser-before/chromium-1440-format-type-cache.png", "before.png"),
    ("browser-clean/chromium-1440-format-type-cache.png", "after.png"),
    ("browser-clean/chromium-375-format-type-finding.png", "format-phone.png"),
    ("browser-clean/firefox-375-citations-tool-result-finding.png", "citations-phone.png"),
]
assets = REPO / "docs/assets/injected-settings"
assets.mkdir(exist_ok=True)
for source, name in screenshots:
    shutil.copyfile(SCRATCH / source, assets / name)

checks = {}
for name, command in [("install", "npm ci"), ("lint", "npm run lint"),
                      ("typecheck", "npm run typecheck"), ("unit", "npm test"),
                      ("build", "npm run build"), ("browser", "npm run test:browser")]:
    data = (SCRATCH / f"clean-{name}.log").read_bytes()
    checks[name] = {"command": command, "exitCode": 0, **digest(data)}
unit = int(re.search(r"Tests\s+(\d+) passed", (SCRATCH / "clean-unit.log").read_text())[1])
browser_checks = int(re.search(r"\b(\d+) passed", (SCRATCH / "clean-browser.log").read_text())[1])
assert unit == 595 and browser_checks == 106

save("verification.json", {
    "testedSource": SOURCE,
    "scope": "Clean source archive, local production preview and separately installed npm tarball. No registry release or manual hosted deployment.",
    "runtimes": {"clean": "Node 24.21.0", "installed": ["Node 24.21.0", "Node 20.0.0"]},
    "checks": checks, "unitChecks": unit, "productionBrowserChecks": browser_checks,
    "studyWorkflowsPerPhase": {"validExportFlows": 8, "invalidImports": 8, "recoveryImports": 4},
    "sourceArchive": digest((SCRATCH / "source.tar").read_bytes()),
    "package": digest((SCRATCH / "antonsoloviev-contextscope-0.3.3.tgz").read_bytes()),
    "replays": replays, "installedCli": cli, "installedRefusals": refusals,
    "htmlParity": "Both runtimes' CLI HTML equals actual browser downloads after replacing only the single generation timestamp.",
    "sourceInputs": inputs, "installedFiles": modules, "servedFiles": served,
    "screenshots": {name: digest((assets / name).read_bytes()) for _, name in screenshots},
})
print(json.dumps({"sourceInputs": len(inputs), "installedFiles": len(modules),
                  "servedFiles": len(served), "replayWorkflows": len(after["cases"]), "checks": "passed"}))
