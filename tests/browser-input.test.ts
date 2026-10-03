import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { bytesToText, readBoundedStream, readPossiblyGzippedFile } from "../web/src/lib/gunzip.js";

const sample = '{"messages":[{"role":"user","content":"hello"}]}';
const bytes = new TextEncoder().encode(sample);

describe("bounded browser input", () => {
  it("accepts exact limits, gzip magic bytes, and already-decoded gzip responses", async () => {
    const limit = 256;
    expect(await bytesToText(bytes, { maxBytes: bytes.length })).toBe(sample);
    expect(await bytesToText(gzipSync(bytes), { maxBytes: limit })).toBe(sample);
    expect(await readPossiblyGzippedFile(new File([sample], "request.jsonl.gz"), { maxBytes: bytes.length })).toBe(sample);
  });

  it("bounds compressed input and inflated output separately", async () => {
    await expect(bytesToText(bytes, { maxBytes: bytes.length - 1 })).rejects.toThrow(/Split the log/);
    const bomb = gzipSync("x".repeat(1024 * 1024));
    expect(bomb.length).toBeLessThan(4096);
    await expect(bytesToText(bomb, { maxBytes: 4096 })).rejects.toThrow(/after decompression/);
  });

  it("checks File.size before opening its stream", async () => {
    const file = new File([bytes], "request.json");
    const stream = vi.spyOn(file, "stream");
    await expect(readPossiblyGzippedFile(file, { maxBytes: 1 })).rejects.toThrow(/exceeds/);
    expect(stream).not.toHaveBeenCalled();
  });

  it("cancels the source once the streamed byte budget is exceeded", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(64)); }, cancel });
    await expect(readBoundedStream(stream, { maxBytes: 100 })).rejects.toThrow(/exceeds/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it("aborts a stalled read and releases its reader", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const read = readBoundedStream(stream, { signal: controller.signal });
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    await expect(bytesToText(bytes, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves BOM decoding and reports corrupt gzip", async () => {
    expect(await bytesToText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toBe(sample);
    await expect(bytesToText(new Uint8Array([0x1f, 0x8b, 0, 0]))).rejects.toThrow();
  });
});
