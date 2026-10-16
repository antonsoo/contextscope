"""Check a retained clean build, installed package and actual browser exports.

python3 studies/stored-context/verify-artifacts.py SCRATCH BASE_URL
Scratch holds clean/, consumer/, source.tar, source-revision.txt, clean-*.log,
installed-*.json/html and browser-{before,clean}/. No machine paths are retained.
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


def digest(data):
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


def load(path):
    return json.loads(path.read_bytes())


def save(name, value):
    (RESULTS / name).write_text(json.dumps(value, indent=2) + "\n")


after = load(RESULTS / "after.json")
replays = {}
for name in ["clean-replay.json", "installed-node24.json", "installed-node20.json"]:
    data = (SCRATCH / name).read_bytes()
    assert data == (RESULTS / "after.json").read_bytes(), name
    replays[name] = {**digest(data), "byteIdenticalTo": "after.json", "workflows": 22}

cli = {}
for runtime in ["node24", "node20"]:
    for case in ["previous-response-change", "item-reference-only", "reported-usage"]:
        name = f"installed-{runtime}-{case}.json"
        assert load(SCRATCH / name) == next(c for c in after["cases"] if c["name"] == case)["report"], name
        cli[name] = {**digest((SCRATCH / name).read_bytes()), "completeReportMatchesSource": True}
    assert (SCRATCH / f"refusal-{runtime}.json").read_text() == "previous report"
    log = (SCRATCH / f"refusal-{runtime}.log").read_bytes()
    assert b"cannot combine" in log.lower() and not re.search(rb"\n\s+at ", log)

inputs = {}
for name in subprocess.check_output(["git", "ls-tree", "-r", "--name-only", SOURCE], cwd=REPO, text=True).splitlines():
    if not (name.startswith(("src/", "web/", "examples/", "tsconfig", "vite.config", "package")) or name in ["README.md", "LICENSE"]):
        continue
    pinned = subprocess.check_output(["git", "show", f"{SOURCE}:{name}"], cwd=REPO)
    path = SCRATCH / "clean" / name
    if path.is_symlink():
        assert str(path.readlink()).encode() == pinned, name
        inputs[name] = {"symlink": pinned.decode()}
    else:
        assert path.read_bytes() == pinned, name
        inputs[name] = digest(pinned)

installed = SCRATCH / "consumer/node_modules/@antonsoloviev/contextscope"
modules = {}
for path in sorted((SCRATCH / "clean/dist").rglob("*")):
    if not path.is_file() or path.suffix == ".map":
        continue
    name = path.relative_to(SCRATCH / "clean").as_posix()
    assert path.read_bytes() == (installed / name).read_bytes(), name
    modules[name] = digest(path.read_bytes())
for name in ["README.md", "LICENSE", "package.json"]:
    assert (SCRATCH / "clean" / name).read_bytes() == (installed / name).read_bytes(), name
    modules[name] = digest((installed / name).read_bytes())

served = {}
for path in sorted((SCRATCH / "clean/web/dist").rglob("*")):
    if not path.is_file():
        continue
    name = path.relative_to(SCRATCH / "clean/web/dist").as_posix()
    with urllib.request.urlopen(BASE + urllib.parse.quote(name)) as response:
        assert response.status == 200
        data = response.read()
    assert data == path.read_bytes(), name
    served[name] = digest(data)

browser = {}
for phase, folder in [("before", "browser-before"), ("after", "browser-clean")]:
    views = load(SCRATCH / folder / "browser.json")
    assert len(views) == 4
    for view in views:
        assert not view["pageErrors"] and not view["httpRequestsAfterDisconnect"] and view["textRecovery"]
        assert len(view["flows"]) == 3
        for flow in view["flows"]:
            assert flow["reportMatchesCli"] and flow["noPageOverflow"] and not flow["axeViolations"]
            if phase == "after":
                assert flow["originalPreserved"] and view["refusalPreservesWorkspace"]
            stem = f'{view["engine"]}-{view["width"]}-{flow["name"]}'
            for suffix in ["json", "html"]:
                assert digest((SCRATCH / folder / (stem + "." + suffix)).read_bytes())["sha256"] == flow[suffix]
    browser[phase] = views
save("browser.json", browser)


def normalized_html(path):
    value, count = re.subn(r"generated \d{4}-\d{2}-\d{2}T[\d:.]+Z", "generated [timestamp]", path.read_text())
    assert count == 1
    return value


for case in ["previous-response-change", "reported-usage"]:
    for suffix in ["json", "html"]:
        shutil.copyfile(SCRATCH / "browser-clean" / f"chromium-1440-{case}.{suffix}", RESULTS / f"browser-{case}.{suffix}")
    for runtime in ["node24", "node20"]:
        assert normalized_html(SCRATCH / f"installed-{runtime}-{case}.html") == normalized_html(RESULTS / f"browser-{case}.html")

screenshots = [
    ("browser-before/chromium-1440-previous-response-change-totals.png", "before.png"),
    ("browser-before/chromium-1440-previous-response-change-cache.png", "before-cache.png"),
    ("browser-clean/chromium-1440-previous-response-change-totals.png", "after.png"),
    ("browser-clean/chromium-375-reported-usage-totals.png", "reported-phone.png"),
    ("browser-clean/chromium-375-item-reference-only-finding.png", "finding-phone.png"),
    ("browser-clean/firefox-375-item-reference-only-cache.png", "cache-phone.png"),
]
assets = REPO / "docs/assets/stored-context"
assets.mkdir(exist_ok=True)
for source, name in screenshots:
    shutil.copyfile(SCRATCH / source, assets / name)

checks = {}
for name, command in [("install", "npm ci"), ("lint", "npm run lint"), ("typecheck", "npm run typecheck"),
                      ("unit", "npm test"), ("build", "npm run build"), ("browser", "npm run test:browser")]:
    checks[name] = {"command": command, "exitCode": 0, **digest((SCRATCH / f"clean-{name}.log").read_bytes())}
assert re.search(r"Tests\s+625 passed", (SCRATCH / "clean-unit.log").read_text())
assert re.search(r"\b114 passed", (SCRATCH / "clean-browser.log").read_text())

save("verification.json", dict(testedSource=SOURCE,
    scope="Clean source archive, local preview and separately installed source tarball. This receipt does not establish public hosting or a new registry release.",
    runtimes=dict(clean="Node 24.21.0", installed=["Node 24.21.0", "Node 20.0.0"]),
    checks=checks, unitChecks=625, productionBrowserChecks=114, studyExportFlowsPerPhase=12,
    studyRecoveryImportsPerPhase=4, sourceArchive=digest((SCRATCH / "source.tar").read_bytes()),
    package=digest((SCRATCH / "antonsoloviev-contextscope-0.3.3.tgz").read_bytes()), replays=replays,
    installedCli=cli, installedBinChecks=load(SCRATCH / "installed-cli-checks.json"),
    htmlParity="Both runtimes' Responses CLI HTML equals actual browser downloads after replacing only the single generation timestamp.",
    sourceInputs=inputs, installedFiles=modules, servedFiles=served,
    screenshots={name: digest((assets / name).read_bytes()) for _, name in screenshots}))
print(json.dumps(dict(sourceInputs=len(inputs), installedFiles=len(modules), servedFiles=len(served), checks="passed")))
