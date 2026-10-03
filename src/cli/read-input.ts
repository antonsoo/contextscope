import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeText } from "../core/decode-text.js";

export const MAX_INPUT_BYTES = 500 * 2 ** 20;

/** Bound both the input read (including pipes/growing files) and the inflated gzip output. */
export function readInputFile(path: string, maxBytes = MAX_INPUT_BYTES): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_INPUT_BYTES) throw new Error("Invalid input byte limit.");
  const mb = (n: number): string => (n / 2 ** 20).toFixed(n < 2 ** 20 ? 3 : 0);
  const tooLarge = (): Error => new Error(`input exceeds the size limit; the most this tool can load at once is ${mb(maxBytes)} MB; split it, for example one session per file`);
  const fd = openSync(path, "r");
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    if (fstatSync(fd).size > maxBytes) throw tooLarge();
    while (true) {
      // Read at most one byte beyond the limit, even when stat cannot report the full size.
      const chunk = Buffer.allocUnsafe(Math.min(2 ** 20, maxBytes - length + 1));
      const read = readSync(fd, chunk);
      if (read === 0) break;
      length += read;
      if (length > maxBytes) throw tooLarge();
      chunks.push(chunk.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  const buf = Buffer.concat(chunks, length);
  const gzip = buf[0] === 0x1f && buf[1] === 0x8b;
  try {
    return decodeText(path.endsWith(".gz") || gzip ? gunzipSync(buf, { maxOutputLength: maxBytes }) : buf);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw tooLarge();
    throw err;
  }
}
