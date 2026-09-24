import { describe, expect, it, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readInputFile } from "../src/cli/read-input.js";

const PLAIN_PATH = "/tmp/contextscope-read-input-test.jsonl";
const GZ_PATH = "/tmp/contextscope-read-input-test.jsonl.gz";
const GZ_NO_EXT_PATH = "/tmp/contextscope-read-input-test-noext";

const SAMPLE = JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content: "hi" }] }) + "\n";

describe("readInputFile", () => {
  afterEach(() => {
    for (const p of [PLAIN_PATH, GZ_PATH, GZ_NO_EXT_PATH]) {
      try {
        unlinkSync(p);
      } catch {
        /* not written this test - fine */
      }
    }
  });

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
