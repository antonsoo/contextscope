const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** True if `bytes` starts with the gzip magic bytes - the same check `src/cli/read-input.ts` does
 * on the Node side. This is the only reliable signal: a static file server may transparently
 * gzip-decode a `.gz` asset before it ever reaches this code (`vite preview`'s dev server does,
 * via a `Content-Encoding: gzip` response header that `fetch()` honors automatically - so despite
 * the `.gz` name, the bytes handed to JS are already plain text), while a GitHub Pages-style host
 * or a user's locally-saved `.jsonl.gz` file hands over the real compressed bytes. Checking the
 * name is not enough either way. */
export function looksGzipped(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}

/** Decodes a byte buffer to text, gunzipping first only if it's actually still gzip-compressed
 * (see `looksGzipped`). Used for both fetched static assets and user-dropped files, so either one
 * works whether or not something upstream already decompressed it. Uses the browser's native
 * `DecompressionStream` (Chrome/Edge 80+, Firefox 113+, Safari 16.4+ - no library for a feature
 * this narrow). */
export async function bytesToText(bytes: Uint8Array): Promise<string> {
  if (!looksGzipped(bytes)) return new TextDecoder().decode(bytes);
  // `bytes` is always backed by a real ArrayBuffer in this app's callers (arrayBuffer() results),
  // never a SharedArrayBuffer - TS's DOM lib types BlobPart more narrowly than that, hence the cast.
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Reads a File/Blob as text, transparently gunzipping it if it's gzip-compressed - covers a user
 * dropping their own `.jsonl.gz` session log (a local File never goes through HTTP content
 * negotiation, so its bytes are exactly what's on disk either way). */
export async function readPossiblyGzippedFile(file: File): Promise<string> {
  return bytesToText(new Uint8Array(await file.arrayBuffer()));
}
