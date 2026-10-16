"""Retain receipts from a clean archive, installed tarball and actual downloads.

Usage: python3 studies/thinking-settings/verify-artifacts.py SCRATCH BASE_URL
SCRATCH contains clean/, consumer/, the clean-* logs and browser-{before,clean}/.
All retained paths are repository-relative; scratch paths are never published.
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
SOURCE = "efbd97888fc224168a0c4a4f6b47fbf2bc0dc60d"
RESULTS = HERE / "results"
RESULTS.mkdir(exist_ok=True)


def digest(data: bytes) -> dict:
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def loaded(path: Path):
    return json.loads(path.read_bytes())


def save(name: str, value) -> None:
    (RESULTS / name).write_text(json.dumps(value, indent=2) + "\n")


after = loaded(RESULTS / "after.json")
replays = {}
for name in ["clean-replay.json", "installed-node24.json", "installed-node20.json"]:
    path = SCRATCH / name
    assert path.read_bytes() == (RESULTS / "after.json").read_bytes(), name
    replays[name] = {**digest(path.read_bytes()), "byteIdenticalTo": "after.json",
                     "workflows": after["workflows"], "discrepancies": 0}

cli = {}
for name, case in [("installed-cli.json", "budget-change"),
                   ("installed-node20-cli.json", "budget-change"),
                   ("installed-message-cli.json", "message-effort-change"),
                   ("installed-node20-message-cli.json", "message-effort-change")]:
    value = loaded(SCRATCH / name)
    expected = next(c for c in after["cases"] if c["name"] == case)["report"]
    assert value == expected, name
    cli[name] = {**digest((SCRATCH / name).read_bytes()), "case": case,
                 "completeReportMatchesSource": True}

inputs = {}
tracked = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", SOURCE], cwd=REPO, text=True).splitlines()
for name in tracked:
    if not (name.startswith(("src/", "web/", "examples/", "tsconfig", "vite.config", "package"))
            or name in ["README.md", "LICENSE"]):
        continue
    if (REPO / name).is_symlink():
        target = (REPO / name).readlink()
        assert target == (SCRATCH / "clean" / name).readlink(), name
        inputs[name] = {"symlink": str(target)}
        continue
    current = (REPO / name).read_bytes()
    assert current == (SCRATCH / "clean" / name).read_bytes(), name
    inputs[name] = digest(current)

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
    data = loaded(SCRATCH / folder / "browser.json")
    assert len(data) == 4
    for view in data:
        assert not view["pageErrors"] and not view["httpRequestsAfterDisconnect"]
        assert len(view["workflows"]) == 4
        for flow in view["workflows"]:
            assert flow["reportMatchesCli"] and flow["noPageOverflow"] and not flow["axeViolations"]
            stem = f'{view["engine"]}-{view["width"]}-{flow["name"]}'
            assert digest((SCRATCH / folder / (stem + ".json")).read_bytes())["sha256"] == flow["jsonSha256"]
            assert digest((SCRATCH / folder / (stem + ".html")).read_bytes())["sha256"] == flow["htmlSha256"]
    browser[phase] = data
save("browser.json", browser)

# Preserve actual downloaded examples; repeated engine/width results are in the
# receipt rather than committing sixteen identical JSON reports.
for name in ["budget-change", "effort-change", "message-effort-change", "adaptive-default"]:
    shutil.copyfile(SCRATCH / "browser-clean" / f"chromium-1440-{name}.json", RESULTS / f"browser-{name}.json")
shutil.copyfile(SCRATCH / "browser-clean/chromium-1440-budget-change.html", RESULTS / "browser-budget.html")

def normalized_html(path: Path) -> str:
    text = path.read_text()
    text, count = re.subn(r"generated \d{4}-\d{2}-\d{2}T[\d:.]+Z", "generated [timestamp]", text)
    assert count == 1
    return text

reference_html = normalized_html(RESULTS / "browser-budget.html")
for name in ["installed-cli.html", "installed-node20-cli.html"]:
    assert normalized_html(SCRATCH / name) == reference_html, name

screenshots = [
    ("browser-before/chromium-1440-cache.png", "before.png"),
    ("browser-clean/chromium-1440-cache.png", "after.png"),
    ("browser-clean/chromium-375-finding.png", "finding-phone.png"),
    ("browser-clean/firefox-375-cache.png", "cache-phone.png"),
]
assets = REPO / "docs/assets/thinking-settings"
assets.mkdir(exist_ok=True)
for source, name in screenshots:
    shutil.copyfile(SCRATCH / source, assets / name)

checks = {}
for name, command in [("install", "npm ci"), ("lint", "npm run lint"),
                      ("typecheck", "npm run typecheck"), ("unit", "npm test"),
                      ("build", "npm run build"), ("browser", "npm run test:browser")]:
    path = SCRATCH / f"clean-{name}.log"
    text = path.read_text()
    if name == "unit":
        assert "577 passed" in text
    if name == "browser":
        assert "102 passed" in text and re.search(r"\b\d+ failed\b", text) is None
    checks[name] = {"command": command, "exitCode": 0, **digest(path.read_bytes())}

save("verification.json", {
    "testedSource": SOURCE,
    "scope": "Local source archive, local production preview and separately installed npm tarball. No push, hosted deployment or registry publication was performed.",
    "runtimes": {"clean": "Node 24.21.0", "installed": ["Node 24.21.0", "Node 20.0.0"]},
    "checks": checks, "unitChecks": 577, "productionBrowserChecks": 102,
    "studyBrowserWorkflowsPerPhase": 16,
    "sourceArchive": digest((SCRATCH / "source.tar").read_bytes()),
    "package": digest((SCRATCH / "antonsoloviev-contextscope-0.3.3.tgz").read_bytes()),
    "replays": replays, "installedCli": cli,
    "htmlParity": "Installed Node 24 and Node 20 CLI HTML equals the actual browser download after replacing only its one generation timestamp.",
    "sourceInputs": inputs, "installedFiles": modules, "servedFiles": served,
    "screenshots": {name: digest((assets / name).read_bytes()) for _, name in screenshots},
})
print(json.dumps({"sourceInputs": len(inputs), "installedFiles": len(modules),
                  "servedFiles": len(served), "replayWorkflows": after["workflows"],
                  "browserWorkflowsPerPhase": 16, "checks": "passed"}))
