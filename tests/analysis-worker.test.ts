import { describe, expect, it } from "vitest";
import { analyzeInWorker } from "../web/src/analysis.js";
import { analyze } from "../src/core/analyze.js";

class FakeWorker {
  onmessage: Worker["onmessage"] = null;
  onerror: Worker["onerror"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  terminated = false;
  sent: unknown;
  postMessage(job: unknown): void { this.sent = job; }
  terminate(): void { this.terminated = true; }
  factory = (): Worker => this as unknown as Worker;
  reply(data: unknown): void { this.onmessage?.call(this as unknown as Worker, new MessageEvent("message", { data })); }
}

const input = JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content: "hello" }] });

describe("disposable analysis workers", () => {
  it("resolves a real analysis shape and releases the worker", async () => {
    const worker = new FakeWorker();
    const promise = analyzeInWorker({ input, options: {} }, new AbortController().signal, worker.factory);
    const result = analyze(input);
    worker.reply({ type: "started" });
    expect(worker.terminated).toBe(false);
    worker.reply({ type: "success", result });
    expect((await promise).result).toEqual(result);
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.sent).toEqual({ input, options: {} });
  });

  it("abort stops CPU work and stale replies cannot settle the promise", async () => {
    const worker = new FakeWorker();
    const operation = new AbortController();
    const promise = analyzeInWorker({ input, options: {} }, operation.signal, worker.factory);
    const stale = worker.onmessage!;
    operation.abort();
    stale.call(worker as unknown as Worker, new MessageEvent("message", { data: { type: "success", result: analyze(input) } }));
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("an already aborted operation creates no worker", async () => {
    const operation = new AbortController();
    operation.abort();
    let created = false;
    await expect(analyzeInWorker({ input, options: {} }, operation.signal, () => { created = true; throw new Error("unexpected"); })).rejects.toMatchObject({ name: "AbortError" });
    expect(created).toBe(false);
  });

  it("abort during construction still releases the new worker", async () => {
    const operation = new AbortController();
    const worker = new FakeWorker();
    await expect(analyzeInWorker({ input, options: {} }, operation.signal, () => { operation.abort(); return worker.factory(); })).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
    expect(worker.sent).toBeUndefined();
  });

  it("abort while loading code releases a late worker without sending request data", async () => {
    const operation = new AbortController();
    const worker = new FakeWorker();
    let complete!: (value: Worker) => void;
    const pending = new Promise<Worker>((resolve) => { complete = resolve; });
    const result = analyzeInWorker({ input, options: {} }, operation.signal, () => pending);
    operation.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    complete(worker.factory());
    await Promise.resolve();
    expect(worker.terminated).toBe(true);
    expect(worker.sent).toBeUndefined();
  });

  it("reports asynchronous code-loading failures and permits another operation", async () => {
    await expect(analyzeInWorker({ input, options: {} }, new AbortController().signal,
      async () => { throw new Error("HTTP 404"); })).rejects.toThrow(/Could not start local analysis: HTTP 404/);
    const worker = new FakeWorker();
    const result = analyzeInWorker({ input, options: {} }, new AbortController().signal, async () => worker.factory());
    await Promise.resolve();
    worker.reply({ type: "success", result: analyze(input) });
    await expect(result).resolves.toHaveProperty("type", "success");
    expect(worker.terminated).toBe(true);
  });

  it.each([null, {}, { type: "success" }, { type: "success", result: {} }, { type: "success", result: { parse: { complete: true }, reports: [{}] } }, { type: "error", message: 42 }])("rejects malformed worker reply %j", async (reply) => {
    const worker = new FakeWorker();
    const promise = analyzeInWorker({ input, options: {} }, new AbortController().signal, worker.factory);
    worker.reply(reply);
    await expect(promise).rejects.toThrow(/unreadable/);
    expect(worker.terminated).toBe(true);
  });

  it("returns input errors without losing their actionable message", async () => {
    const worker = new FakeWorker();
    const promise = analyzeInWorker({ input, options: {} }, new AbortController().signal, worker.factory);
    worker.reply({ type: "error", message: "Duplicate JSON field content." });
    await expect(promise).rejects.toThrow(/Duplicate JSON/);
    expect(worker.terminated).toBe(true);
  });

  it("worker construction and postMessage failures settle and permit later work", async () => {
    await expect(analyzeInWorker({ input, options: {} }, new AbortController().signal, () => { throw new Error("worker unavailable"); })).rejects.toThrow(/start local analysis/);
    const worker = new FakeWorker();
    worker.postMessage = () => { throw new Error("clone failure"); };
    await expect(analyzeInWorker({ input, options: {} }, new AbortController().signal, worker.factory)).rejects.toThrow(/clone failure/);
    expect(worker.terminated).toBe(true);
  });

  it("worker error and messageerror release the operation", async () => {
    for (const kind of ["error", "messageerror"]) {
      const worker = new FakeWorker();
      const promise = analyzeInWorker({ input, options: {} }, new AbortController().signal, worker.factory);
      if (kind === "error") worker.onerror!.call(worker as unknown as Worker, { message: "startup failure", preventDefault() {} } as ErrorEvent);
      else worker.onmessageerror!.call(worker as unknown as Worker, new MessageEvent("messageerror"));
      await expect(promise).rejects.toThrow(/worker failed|receive the analysis/i);
      expect(worker.terminated).toBe(true);
    }
  });
});
