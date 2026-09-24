import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** True if `buf` starts with the gzip magic bytes, independent of the file's extension - a
 * renamed or extension-less gzip file (piped input, a download that dropped `.gz`) still decodes. */
function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1;
}

/** Reads a request file, transparently gunzipping it if it's gzip-compressed (by extension or,
 * more reliably, by magic bytes) - the flagship examples ship as `.jsonl.gz` to stay under the
 * repo's file-size limits, and a user's own captured session log may well be gzipped too. */
export function readInputFile(path: string): string {
  const buf = readFileSync(path);
  if (path.endsWith(".gz") || isGzip(buf)) {
    return gunzipSync(buf).toString("utf8");
  }
  return buf.toString("utf8");
}
