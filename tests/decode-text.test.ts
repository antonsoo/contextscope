import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { readInputFile } from "../src/cli/read-input.js";
import { analyze } from "../src/core/index.js";
import { decodeText } from "../src/core/decode-text.js";

const dir = mkdtempSync(join(tmpdir(), "contextscope-encodings-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const text = readFileSync(new URL("../examples/anthropic-duplicate-tool-results.jsonl", import.meta.url), "utf8");

function utf16(source: string, bigEndian: boolean): Buffer {
  const bytes = Buffer.alloc(2 + source.length * 2);
  bytes.writeUInt16LE(0xfeff, 0);
  if (bigEndian) bytes.swap16();
  for (let i = 0; i < source.length; i++) {
    if (bigEndian) bytes.writeUInt16BE(source.charCodeAt(i), 2 + i * 2);
    else bytes.writeUInt16LE(source.charCodeAt(i), 2 + i * 2);
  }
  return bytes;
}

function saved(name: string, bytes: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return readInputFile(path);
}

describe("a log saved by a Windows shell or editor", () => {
  // `... > requests.jsonl` in Windows PowerShell writes UTF-16 with a byte-order mark and CRLF.
  const crlf = text.replace(/\n/g, "\r\n");

  it.each([
    ["UTF-8 with a byte-order mark", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]), text],
    ["UTF-16 little-endian", utf16(crlf, false), crlf],
    ["UTF-16 big-endian", utf16(text, true), text],
    ["gzipped UTF-16", gzipSync(utf16(text, false)), text],
  ])("%s reads as the text it holds", (label, bytes, expected) => {
    expect(saved(`${label.replace(/\W+/g, "-")}.jsonl`, bytes)).toBe(expected);
  });

  it("and analyzes to the same result as the UTF-8 file", () => {
    const expected = analyze(text);
    const fromUtf16 = analyze(saved("session.jsonl", utf16(crlf, false)));
    expect(fromUtf16.reports.length).toBe(expected.reports.length);
    expect(expected.reports.length).toBeGreaterThan(1);
    expect(fromUtf16.findings).toEqual(expected.findings);
  });
});

describe("corrupt encoding cannot silently rewrite evidence", () => {
  it.each([
    ["invalid UTF-8", Buffer.from([0xff])],
    ["truncated UTF-8", Buffer.from([0xe2, 0x82])],
    ["overlong UTF-8", Buffer.from([0xc0, 0xaf])],
    ["UTF-8 surrogate", Buffer.from([0xed, 0xa0, 0x80])],
    ["odd UTF-16LE", Buffer.from([0xff, 0xfe, 0x61])],
    ["unpaired UTF-16LE surrogate", Buffer.from([0xff, 0xfe, 0x00, 0xd8])],
    ["unpaired UTF-16BE surrogate", Buffer.from([0xfe, 0xff, 0xd8, 0x00])],
  ])("rejects %s with recovery instructions", (_name, bytes) => {
    expect(() => decodeText(bytes)).toThrow(/encoding|UTF/i);
    expect(() => decodeText(bytes)).toThrow(/save|export/i);
    expect(() => saved("corrupt.json", bytes)).toThrow(/encoding|UTF/i);
    expect(() => saved("corrupt.json.gz", gzipSync(bytes))).toThrow(/encoding|UTF/i);
  });

  it("preserves genuine Unicode including a literal replacement character", () => {
    const unicode = 'Hello 😀 日本語 \uFFFD';
    expect(decodeText(Buffer.from(unicode))).toBe(unicode);
    expect(decodeText(utf16(unicode, false))).toBe(unicode);
    expect(decodeText(utf16(unicode, true))).toBe(unicode);
  });
});
