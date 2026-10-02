/**
 * A log's text, as Windows tools save it too. A proxy or an SDK hook writes UTF-8, but
 * `... > requests.jsonl` in Windows PowerShell saves UTF-16 with a byte-order mark, which
 * read as UTF-8 holds no JSON at all ("No valid JSON objects found"). The mark decides the
 * encoding and is dropped; a mark in front of UTF-8 is dropped too.
 *
 * Kept free of imports: the web app loads it before the (large) rest of the core.
 */
export function decodeText(bytes: Uint8Array): string {
  const utf16 =
    bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
  return new TextDecoder(utf16 ?? "utf-8").decode(bytes);
}
