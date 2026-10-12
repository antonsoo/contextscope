"""Compare the clean build, exercised build, installed tarball and served files."""
import hashlib
import json
import os
import subprocess
import sys
import tarfile
from pathlib import Path

clean, current, installed, archive, output = map(Path, sys.argv[1:])


def receipt(name, data):
    return {"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=current, text=True).strip()
tracked = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", commit], cwd=current, text=True).splitlines()
configs = {"package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "eslint.config.js", "playwright.config.mjs"}
inputs = []
for name in tracked:
    if name.startswith(("src/", "web/", "tests/", "examples/")) or name in configs:
        if (clean / name).is_symlink():
            target = os.readlink(clean / name)
            assert target == os.readlink(current / name), name
            inputs.append({"path": name, "symlink": target})
            continue
        data = (clean / name).read_bytes()
        assert data == (current / name).read_bytes(), name
        inputs.append(receipt(name, data))
build = []
for directory in ["dist", "web/dist"]:
    for path in sorted((clean / directory).rglob("*")):
        if path.is_file():
            name = path.relative_to(clean).as_posix()
            data = path.read_bytes()
            assert data == (current / name).read_bytes(), name
            build.append(receipt(name, data))
package = []
with tarfile.open(archive) as tar:
    for member in tar.getmembers():
        if not member.isfile():
            continue
        name = member.name.removeprefix("package/")
        data = tar.extractfile(member).read()
        assert data == (installed / name).read_bytes(), name
        assert data == (clean / name).read_bytes(), name
        package.append(receipt(name, data))
browser = json.loads((current / "studies/numeric-integrity/evidence/browser-after.json").read_text())
clean_browser = json.loads((current / "studies/numeric-integrity/evidence/clean-browser.json").read_text())
assert browser["servedAssets"] == clean_browser["servedAssets"]
assert browser["results"] == clean_browser["results"]
for asset in browser["servedAssets"]:
    assert asset == receipt(asset["path"], (clean / "web/dist" / asset["path"]).read_bytes())
result = {
    "sourceCommit": commit,
    "sourceInputs": inputs,
    "build": build,
    "package": package,
    "archive": receipt(archive.name, archive.read_bytes()),
    "servedAssets": browser["servedAssets"],
    "allBytesEqual": True,
    "scope": "Clean archived source build and local installed package; no registry publication or hosted deployment",
}
output.write_text(json.dumps(result, indent=2) + "\n")
print(f"Identical: {len(inputs)} build inputs, {len(build)} build files, {len(package)} installed package files, {len(browser['servedAssets'])} served assets")
