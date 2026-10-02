import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeText } from "../core/decode-text.js";

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
export function readInputFile(path: string, maxBytes = MAX_INPUT_BYTES): string {
  const buf = readFileSync(path);
  const bytes = path.endsWith(".gz") || isGzip(buf) ? gunzipSync(buf) : buf;
  // A JavaScript string holds at most about 512 MB, and Node's own message for going over
  // ("Cannot create a string longer than 0x1fffffe8 characters") doesn't say what to do about it.
  if (bytes.length > maxBytes) {
    const mb = (n: number): string => (n / 2 ** 20).toFixed(n < 2 ** 20 ? 3 : 0);
    throw new Error(`it holds ${mb(bytes.length)} MB of JSON and the most this tool can load at once is ${mb(maxBytes)} MB; split it, for example one session per file`);
  }
  return decodeText(bytes);
}

export const MAX_INPUT_BYTES = 500 * 2 ** 20;
