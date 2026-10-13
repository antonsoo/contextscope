# Keep request captures intact when writing reports

Source correction, verified 2026-10-12. No npm release or hosted deployment.

At baseline `24fd8b38820ae7b297c8ceb0a3922884cfb7a96e`, the CLI read a request
file and then allowed `--json` or `--html` to overwrite it. The retained
[SDK fixture](../../tests/fixtures/sdk/openai-cache-tool-output.jsonl.gz)
contains three synthetic requests serialized by OpenAI Python 2.54.0 through
a mocked transport, with no provider calls. Its [capture script](../openai-cache/generate-sdk-fixtures.py)
and provenance predate this correction. Only disposable copies were overwritten.

| Destination | Before | After |
| --- | --- | --- |
| Input gzip, direct or through three alias forms | Exit 0; destroys all 394 source bytes | Exit 1; original bytes retained |
| HTML and JSON name the same new or existing file | Exit 0; JSON replaces HTML | Exit 1 before either write |
| Distinct ordinary report files | Both reports written | Both reports written; same analysis |

The JSON overwrite produced 12,579 bytes; HTML produced 5,931 bytes. Unlike an
atomic replacement, the old direct writes also truncated the source through
outside hard links and symlinks. The [before receipt](before.json) and
[after receipt](after.json) each contain twelve actual CLI calls: two formats
across four input aliases, and four ways for the reports to collide. Both
also replace two ordinary reports and recover all three requests.

![Replay transcript: input destinations are refused and ordinary reports still succeed](../../docs/assets/report-destination-protection.png)

The CLI now validates all paths before reading/analyzing or optional network
calibration. It compares resolved parent paths and existing file identities;
all output symlinks and non-regular files are refused. Reports are prepared in
private temporary sibling files, flushed, and only then renamed over their
destinations. A failed second staging write leaves both old reports intact;
a failed replacement leaves that destination intact. Tests inject those
failures and check temporary-file cleanup. Existing ordinary reports can still
be replaced. New/replaced report files use mode 0600 on POSIX.

Each rename is atomic, but the two renames are not a joint transaction: failure
of the second rename can leave the first report updated. The guard is not a
lock against concurrent filesystem changes, does not promise whole-machine
power-loss recovery, and cannot protect targets opened by shell redirection.

## Replay

Build the CLI, then choose a directory that does not already exist:

```sh
npm ci
node studies/report-destinations/replay.mjs /tmp/contextscope-report-check dist/cli/index.js
```

The script retains disposable inputs, safe reports, `replay.json`, and the
terminal receipt. To reproduce the destructive old behavior safely, build the
baseline in a separate checkout and pass its CLI path plus `before`, using a
different new directory. An installed package's `dist/cli/index.js` can be
passed directly; the script invokes the current Node executable from the
disposable case directory.

The safe JSON report is byte-identical before and after. HTML is identical
after normalizing only its single generation timestamp. The receipts retain
both raw and normalized hashes. Analysis, report content and CI gate meanings
are unchanged.
