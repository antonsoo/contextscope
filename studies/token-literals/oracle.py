"""Independent native ordinary-text o200k_base reference. JSON stdin / stdout."""
import hashlib
import importlib.metadata
import json
import sys

import tiktoken

texts = json.load(sys.stdin)
encoding = tiktoken.get_encoding("o200k_base")
rows = []
for text in texts:
    tokens = encoding.encode_ordinary(text)
    assert encoding.decode(tokens) == text
    rows.append({"textSha256": hashlib.sha256(text.encode()).hexdigest(), "tokens": len(tokens),
                 "tokenIdsSha256": hashlib.sha256(json.dumps(tokens, separators=(",", ":")).encode()).hexdigest()})
json.dump({"tiktoken": importlib.metadata.version("tiktoken"), "encoding": encoding.name,
           "mode": "encode_ordinary", "rows": rows}, sys.stdout)
