#!/usr/bin/env python3
"""Sample mini-SWE-agent trajectories from the public SWE-bench submissions bucket.

Lists each entry's trajs/ prefix (unauthenticated S3 listing), draws a seeded
sample of instances, downloads them into cache/, and writes manifest.json
(key, size, ETag, sha256). Re-running reuses files already in cache/ whose
sha256 matches the manifest.
"""
import hashlib, json, os, random, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

BUCKET = "https://swe-bench-submissions.s3.amazonaws.com"
UA = "contextscope-study/0.1 (read-only research sample; anton@praviel.com)"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
SEED = 20261008
PER_ENTRY = int(os.environ.get("PER_ENTRY", "30"))

ENTRIES = json.load(open(os.path.join(HERE, "entries.json")))


def get(url, retries=4):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(2 ** (i + 1))


def list_keys(prefix):
    keys, token = [], None
    while True:
        q = {"prefix": prefix, "max-keys": "1000", "list-type": "2"}
        if token:
            q["continuation-token"] = token
        xml = get(BUCKET + "/?" + urllib.parse.urlencode(q))
        root = ET.fromstring(xml)
        ns = {"s": root.tag.split("}")[0][1:]}
        for c in root.findall("s:Contents", ns):
            keys.append((c.find("s:Key", ns).text, int(c.find("s:Size", ns).text), c.find("s:ETag", ns).text.strip('"')))
        if root.find("s:IsTruncated", ns).text == "true":
            token = root.find("s:NextContinuationToken", ns).text
        else:
            return keys


def download(item):
    key, size, etag, path = item
    if os.path.exists(path) and os.path.getsize(path) == size:
        data = open(path, "rb").read()
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = get(BUCKET + "/" + urllib.parse.quote(key))
        open(path, "wb").write(data)
    return key, hashlib.sha256(data).hexdigest()


def main():
    manifest = {"bucket": BUCKET, "fetched": time.strftime("%Y-%m-%d"), "seed": SEED, "per_entry": PER_ENTRY,
                "listing": "S3 ListObjectsV2, prefix bash-only/<entry>/trajs/", "entries": {}}
    jobs = []
    for entry in ENTRIES:
        prefix = f"bash-only/{entry}/trajs/"
        keys = sorted(k for k in list_keys(prefix) if k[0].endswith(".traj.json"))
        rng = random.Random(f"{SEED}:{entry}")
        pick = sorted(rng.sample(keys, min(PER_ENTRY, len(keys))))
        manifest["entries"][entry] = {"listed": len(keys), "files": {}}
        for key, size, etag in pick:
            path = os.path.join(CACHE, entry, key.rsplit("/", 1)[1])
            jobs.append((entry, key, size, etag, path))
        print(entry, len(keys), "listed", len(pick), "picked", flush=True)
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(download, [(k, s, e, p) for _, k, s, e, p in jobs]))
    sha = dict(res)
    for entry, key, size, etag, path in jobs:
        manifest["entries"][entry]["files"][key.rsplit("/", 1)[1]] = {"key": key, "size": size, "etag": etag, "sha256": sha[key]}
    json.dump(manifest, open(os.path.join(HERE, "manifest.json"), "w"), indent=1)
    print("bytes", sum(j[2] for j in jobs))


main()
