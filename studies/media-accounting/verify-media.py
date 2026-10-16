"""Independent decoding checks, using Pillow and optional Poppler.

uv run --no-project --with pillow==12.2.0 studies/media-accounting/verify-media.py --check-url
No provider request or image modification occurs. --check-url fetches the one
public immutable image reference; omit it for offline decoder checks only.
"""
import argparse
import datetime
import hashlib
import json
import shutil
import subprocess
import urllib.request
from pathlib import Path

import PIL
from PIL import Image

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check-url", action="store_true")
options = parser.parse_args()
paths = [ROOT / "captures/cache-table.png", ROOT / "captures/cache-table-uncompressed.png"]
images = [Image.open(path).convert("RGBA") for path in paths]
assert images[0].size == images[1].size
assert images[0].tobytes() == images[1].tobytes()
proof = dict(decoder="Pillow " + PIL.__version__, width=images[0].width, height=images[0].height,
    decodedRgbaSha256=hashlib.sha256(images[0].tobytes()).hexdigest(), identicalDecodedPixels=True,
    files={path.name: dict(bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in paths})
if shutil.which("pdftotext"):
    text = subprocess.check_output(["pdftotext", str(ROOT / "captures/record.pdf"), "-"], text=True)
    assert "Controlled source record. Total 42." in text
    proof["pdfControl"] = dict(extractor=subprocess.run(["pdftotext", "-v"], capture_output=True, text=True).stderr.splitlines()[0],
        text=text.strip(), validTextPage=True)
if options.check_url:
    url = json.loads((ROOT / "captures/manifest.json").read_text())["image"]["url"]
    with urllib.request.urlopen(url, timeout=45) as response:
        assert response.status == 200
        data = response.read()
    assert data == paths[0].read_bytes()
    proof["publicImageReference"] = dict(url=url, status=200, matchesOriginal=True, bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(), checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
(ROOT / "results/media-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps(proof))
