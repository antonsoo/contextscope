import { decodeText } from "../../../src/core/decode-text.js";

export const MAX_BROWSER_INPUT_BYTES = 50 * 2 ** 20;
export interface ReadOptions {
  signal?: AbortSignal;
  maxBytes?: number;
}

function byteLimit(options: ReadOptions): number {
  const limit = options.maxBytes ?? MAX_BROWSER_INPUT_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BROWSER_INPUT_BYTES) throw new Error("Invalid input byte limit.");
  return limit;
}

function tooLarge(limit: number): Error {
  return new Error(`Input exceeds ${(limit / 2 ** 20).toLocaleString("en-US")} MB before or after decompression. Split the log into smaller sessions.`);
}

/** Stop reading as soon as the cap is crossed; never buffer an entire gzip bomb. */
export async function readBoundedStream(stream: ReadableStream<Uint8Array>, options: ReadOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const limit = byteLimit(options);
  const { signal } = options;
  const reader = stream.getReader();
  const abort = (): void => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw tooLarge(limit);
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** HTTP hosts may already have decoded .gz responses. Detect the actual bytes, not the name. */
export function looksGzipped(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function bytesToText(bytes: Uint8Array, options: ReadOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const limit = byteLimit(options);
  if (bytes.byteLength > limit) throw tooLarge(limit);
  if (!looksGzipped(bytes)) return decodeText(bytes);
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return decodeText(await readBoundedStream(stream, options));
}

export async function readPossiblyGzippedFile(file: File, options: ReadOptions = {}): Promise<string> {
  const limit = byteLimit(options);
  if (file.size > limit) throw tooLarge(limit);
  return bytesToText(await readBoundedStream(file.stream(), options), options);
}

/** Pasted strings bypass File.size; apply the same UTF-8 byte budget before parsing. */
export function checkTextSize(text: string): void {
  if (text.length > MAX_BROWSER_INPUT_BYTES || new TextEncoder().encode(text).byteLength > MAX_BROWSER_INPUT_BYTES) {
    throw tooLarge(MAX_BROWSER_INPUT_BYTES);
  }
}
