import { describe, expect, it, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readInputFile } from "../src/cli/read-input.js";

import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "contextscope-read-"));
const PLAIN_PATH = join(directory, "request.jsonl");
const GZ_PATH = join(directory, "request.jsonl.gz");
const GZ_NO_EXT_PATH = join(directory, "request");

const SAMPLE = JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }] }) + "\n";

describe("readInputFile", () => {


  it("reads a plain file as-is", () => {
    writeFileSync(PLAIN_PATH, SAMPLE);
    expect(readInputFile(PLAIN_PATH)).toBe(SAMPLE);
  });

  it("transparently gunzips a .gz file", () => {
    writeFileSync(GZ_PATH, gzipSync(Buffer.from(SAMPLE, "utf8")));
    expect(readInputFile(GZ_PATH)).toBe(SAMPLE);
  });

  it("detects gzip by magic bytes even without a .gz extension", () => {
    writeFileSync(GZ_NO_EXT_PATH, gzipSync(Buffer.from(SAMPLE, "utf8")));
    expect(readInputFile(GZ_NO_EXT_PATH)).toBe(SAMPLE);
  });
});

it("caps inflated gzip output before allocating the entire expansion", () => {
  writeFileSync(GZ_PATH, gzipSync("x".repeat(8 * 2 ** 20)));
  expect(() => readInputFile(GZ_PATH, 16 * 1024)).toThrow(/size limit.*split it/);
});

it("allows exact byte boundaries and rejects both plain and gzip overflows", () => {
  const value = "x".repeat(4096);
  writeFileSync(PLAIN_PATH, value);
  writeFileSync(GZ_PATH, gzipSync(value));
  expect(readInputFile(PLAIN_PATH, 4096)).toBe(value);
  expect(readInputFile(GZ_PATH, 4096)).toBe(value);
  expect(() => readInputFile(PLAIN_PATH, 4095)).toThrow(/size limit/);
  expect(() => readInputFile(GZ_PATH, 4095)).toThrow(/size limit/);
});

it("keeps corrupt gzip errors distinct from size errors", () => {
  writeFileSync(GZ_PATH, "not gzip");
  expect(() => readInputFile(GZ_PATH, 4096)).toThrow(/header/);
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));
