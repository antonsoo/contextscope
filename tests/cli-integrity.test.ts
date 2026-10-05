import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const request = JSON.stringify({ model: "gpt-6-sol", input: "hello" });
const cli = fileURLToPath(new URL("../dist/cli/index.js", import.meta.url));

describe("CLI evidence gates", () => {
  it.each(["error", "warning", "info"])("an incomplete log fails --fail-on %s and exports coverage", (severity) => {
    const dir = mkdtempSync(join(tmpdir(), "contextscope-gate-"));
    try {
      const input = join(dir, "requests.jsonl");
      const json = join(dir, "report.json");
      const html = join(dir, "report.html");
      writeFileSync(input, `${request}\n{truncated`);
      const result = spawnSync(process.execPath, [cli, "analyze", input, "--fail-on", severity, "--json", json, "--html", html], { encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("Incomplete input");
      const report = JSON.parse(readFileSync(json, "utf8")) as { parse: Record<string, unknown>; findings: unknown[] };
      expect(report.parse).toMatchObject({ complete: false, sourceRecords: 2, skippedRecords: 1 });
      expect(report.findings).toEqual([]);
      expect(readFileSync(html, "utf8")).toContain("Line 2");
    } finally { rmSync(dir, { recursive: true }); }
  });

  it("a complete no-finding log passes and an empty array fails with recovery text", () => {
    const dir = mkdtempSync(join(tmpdir(), "contextscope-gate-"));
    try {
      const input = join(dir, "requests.json");
      writeFileSync(input, request);
      expect(spawnSync(process.execPath, [cli, "analyze", input, "--fail-on", "info"]).status).toBe(0);
      writeFileSync(input, "[]");
      const result = spawnSync(process.execPath, [cli, "analyze", input], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no requests");
      expect(result.stderr).not.toContain("at main");
    } finally { rmSync(dir, { recursive: true }); }
  });

  it("corrupt bytes cannot produce a complete CLI report", () => {
    const dir = mkdtempSync(join(tmpdir(), "contextscope-gate-"));
    try {
      const input = join(dir, "corrupt.json");
      writeFileSync(input, Buffer.concat([Buffer.from('{"model":"gpt-6-sol","input":"'), Buffer.from([0xff]), Buffer.from('"}') ]));
      const result = spawnSync(process.execPath, [cli, "analyze", input], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Invalid UTF-8 encoding.*Export or save/);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("at main");
    } finally { rmSync(dir, { recursive: true }); }
  });

  it("a real CLI JSON export does not repeat private prompt previews", () => {
    const dir = mkdtempSync(join(tmpdir(), "contextscope-gate-"));
    try {
      const input = join(dir, "requests.json");
      const json = join(dir, "report.json");
      const marker = "synthetic-private-content-marker";
      writeFileSync(input, JSON.stringify(["a", "b"].map((suffix) => ({ model: "gpt-6-sol", instructions: "stable setup", input: `${marker} ${suffix}` }))));
      const result = spawnSync(process.execPath, [cli, "analyze", input, "--json", json], { encoding: "utf8" });
      expect(result.status).toBe(0);
      const text = readFileSync(json, "utf8");
      expect(text).not.toContain(marker);
      const report = JSON.parse(text) as { prefixMatches: Record<string, unknown>[] };
      expect(report.prefixMatches[0]).toMatchObject({ fromIndex: 0, toIndex: 1, matchedSegments: 1 });
      expect(report.prefixMatches[0]).not.toHaveProperty("diff");
    } finally { rmSync(dir, { recursive: true }); }
  });
});
