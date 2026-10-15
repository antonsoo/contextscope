"""Check the retained native inputs, actual downloads and browser receipts."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"


def load(path):
    return json.loads(path.read_text())


def checked(path, metadata):
    raw = path.read_bytes()
    assert len(raw) == metadata["bytes"], path
    assert hashlib.sha256(raw).hexdigest() == metadata["sha256"], path
    return raw


receipt = load(RESULTS / "receipt.json")
assert receipt["beforeFirstOfflineFailures"] == 4
assert receipt["afterFirstOfflineFailures"] == 0
assert len(receipt["records"]) == 32
assert len(receipt["views"]) == 8
for identity, fixture in receipt["fixtures"].items():
    import gzip

    raw = (HERE / fixture["file"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == fixture["gzipSha256"]
    assert hashlib.sha256(gzip.decompress(raw)).hexdigest() == fixture["rawSha256"]
    assert receipt["controls"][identity]["console"]["exit"] == 0

references = set()
for record in receipt["records"]:
    for kind in ("json", "html", "original"):
        if kind not in record:
            continue
        metadata = record[kind]
        raw = checked(RESULTS / metadata["file"], metadata)
        references.add(metadata["file"])
        if kind == "json":
            assert json.loads(raw) == receipt["controls"][record["id"]]["expected"]
        if kind == "html":
            assert b"contextscope" in raw and b"<script" not in raw.lower()
for view in receipt["views"]:
    assert view["served"] == view["received"]
    assert not view["pageErrors"] and not view["externalRequests"]
    assert not view["policyViolations"] and not view["axeViolations"]
    assert not view["overflow"]
    audit = view["audit"]
    assert audit["created"] == audit["terminated"] and audit["active"] == 0
    assert audit["urls"] == audit["revoked"]
    if view["phase"] == "after":
        assert view["cold"]["shown"] and not view["cold"]["error"]
        assert not view["lateRequests"] and not view["failedRequests"]
        assert view["startup"] == dict(created=1, terminated=1, active=0,
                                      posts=0, ready=1, started=0, urls=1, revoked=1)
assert references == {str(path.relative_to(RESULTS)) for path in (RESULTS / "artifacts").iterdir()}

startup = load(RESULTS / "startup/receipt.json")
assert startup["cases"] == len(startup["rows"]) == 24
assert {(row["engine"], row["width"], row["fault"]) for row in startup["rows"]} == {
    (engine, width, fault)
    for engine in ("chromium", "firefox") for width in (1440, 375)
    for fault in ("http-503", "html", "truncated", "invalid-utf8", "held-download", "silent-worker")
}
for row in startup["rows"]:
    assert len(row["requests"]) == 2
    assert row["firstAnalysisOffline"] and row["reportMatchesBaselineCli"]
    assert not row["pageErrors"] and not row["externalRequests"]
    for stage in ("beforeRetry", "prepared", "finished"):
        audit = row[stage]
        assert audit["active"] == 0 and audit["created"] == audit["terminated"]
    assert row["beforeRetry"]["posts"] == row["prepared"]["posts"] == 0
    assert row["finished"]["posts"] == 1
    assert row["reportSha256"] in {record["json"]["sha256"] for record in receipt["records"]}

assert len(load(RESULTS / "core-unchanged.json")["files"]) == 141
print(f"Verified 32 report pairs, 8 original downloads, {len(references)} unique artifacts, "
      "8 browser views, 24 startup recoveries and native fixture hashes.")
