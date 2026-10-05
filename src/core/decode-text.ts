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
  const encoding = utf16 ?? "utf-8";
  try {
    // Replacement decoding would turn two different corrupt captures into the same
    // prompt, then incorrectly report complete coverage and matching cache prefixes.
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Invalid ${encoding.toUpperCase()} encoding. Export or save the original log as valid UTF-8 (or UTF-16 with a byte-order mark) and import it again.`);
  }
}
