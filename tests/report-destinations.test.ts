import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeReports } from "../src/cli/write-reports.js";

vi.mock("node:fs", { spy: true });
const actualFs = await vi.importActual<typeof fs>("node:fs");

const cli = fileURLToPath(new URL("../dist/cli/index.js", import.meta.url));
const original = fs.readFileSync(new URL("./fixtures/sdk/openai-cache-tool-output.jsonl.gz", import.meta.url));
const directories: string[] = [];
function setup() {
  const dir = fs.mkdtempSync(join(tmpdir(), "contextscope-output-"));
  directories.push(dir);
  const input = join(dir, "requests.gz");
  fs.writeFileSync(input, original);
  return { dir, input };
}
function run(input: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, "analyze", input, ...args], { encoding: "utf8" });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fs.writeFileSync).mockImplementation(actualFs.writeFileSync);
  vi.mocked(fs.renameSync).mockImplementation(actualFs.renameSync);
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("CLI report destinations", () => {
  for (const format of ["--json", "--html"]) {
    it.each(["direct", "hardlink", "symlink", "parent-symlink"])(`${format} preserves the input via %s`, (alias) => {
      const { dir, input } = setup();
      let output = input;
      if (alias === "hardlink") { output = join(dir, "alias"); fs.linkSync(input, output); }
      if (alias === "symlink") { output = join(dir, "alias"); fs.symlinkSync(input, output); }
      if (alias === "parent-symlink") { fs.symlinkSync(dir, join(dir, "parent")); output = join(dir, "parent", "requests.gz"); }
      const result = run(input, format, output);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/distinct files|symbolic link/);
      expect(result.stderr).not.toContain("at main");
      expect(fs.readFileSync(input)).toEqual(original);
      expect(fs.readFileSync(output)).toEqual(original);
      if (alias === "symlink") expect(fs.lstatSync(output).isSymbolicLink()).toBe(true);
      expect(fs.readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
    });
  }

  it.each(["new", "existing", "hardlink", "parent-symlink"])("rejects colliding report files: %s", (alias) => {
    const { dir, input } = setup();
    const html = join(dir, "report");
    let json = html;
    if (alias !== "new") fs.writeFileSync(html, "previous report");
    if (alias === "hardlink") { json = join(dir, "alias"); fs.linkSync(html, json); }
    if (alias === "parent-symlink") { fs.symlinkSync(dir, join(dir, "parent")); json = join(dir, "parent", "report"); }
    const result = run(input, "--html", html, "--json", json);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("JSON output and HTML must use distinct files");
    expect(result.stdout).toBe("");
    expect(fs.readFileSync(input)).toEqual(original);
    if (alias === "new") expect(fs.existsSync(html)).toBe(false);
    else expect(fs.readFileSync(html, "utf8")).toBe("previous report");
  });

  it.each(["directory", "missing-parent", "broken-link"])("checks the second output before touching the first: %s", (kind) => {
    const { dir, input } = setup();
    const html = join(dir, "report.html");
    fs.writeFileSync(html, "previous report");
    let json = join(dir, "bad");
    if (kind === "directory") fs.mkdirSync(json);
    if (kind === "missing-parent") json = join(dir, "absent", "report.json");
    if (kind === "broken-link") fs.symlinkSync(join(dir, "absent"), json);
    const result = run(input, "--html", html, "--json", json);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Could not prepare report files");
    expect(fs.readFileSync(html, "utf8")).toBe("previous report");
  });

  it("refuses an input alias before optional network calibration", () => {
    const { input } = setup();
    const result = run(input, "--calibrate", "--json", input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("distinct files");
    expect(result.stderr).not.toContain("Calibration failed");
    expect(fs.readFileSync(input)).toEqual(original);
  });

  it("replaces two ordinary reports while retaining the SDK capture", () => {
    const { dir, input } = setup();
    const html = join(dir, "report.html");
    const json = join(dir, "report.json");
    fs.writeFileSync(html, "old HTML"); fs.writeFileSync(json, "old JSON");
    const result = run(input, "--html", html, "--json", json);
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(json, "utf8")).parse.requests).toHaveLength(3);
    expect(fs.readFileSync(html, "utf8")).toContain("<!doctype html>");
    expect(fs.readFileSync(input)).toEqual(original);
    expect(fs.readdirSync(dir).sort()).toEqual(["report.html", "report.json", "requests.gz"]);
    if (process.platform !== "win32") expect(fs.statSync(json).mode & 0o777).toBe(0o600);
  });
});

describe("report write failures", () => {
  it("keeps both old reports and removes staging files when the second write fails", () => {
    const { dir, input } = setup();
    const html = join(dir, "report.html"), json = join(dir, "report.json");
    fs.writeFileSync(html, "old HTML"); fs.writeFileSync(json, "old JSON");
    const write = actualFs.writeFileSync;
    let writes = 0;
    vi.spyOn(fs, "writeFileSync").mockImplementation((...args) => {
      if (++writes === 2) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      return write(...args);
    });
    expect(() => writeReports(input, [{ label: "HTML", path: html, text: "new HTML" }, { label: "JSON", path: json, text: "new JSON" }])).toThrow("disk full");
    expect(fs.readFileSync(html, "utf8")).toBe("old HTML");
    expect(fs.readFileSync(json, "utf8")).toBe("old JSON");
    expect(fs.readdirSync(dir).sort()).toEqual(["report.html", "report.json", "requests.gz"]);
  });

  it("keeps a previous report and cleans staging after a failed rename", () => {
    const { dir, input } = setup();
    const path = join(dir, "report.json"); fs.writeFileSync(path, "old JSON");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("replacement denied"); });
    expect(() => writeReports(input, [{ label: "JSON", path, text: "new JSON" }])).toThrow("replacement denied");
    expect(fs.readFileSync(path, "utf8")).toBe("old JSON");
    expect(fs.readdirSync(dir).sort()).toEqual(["report.json", "requests.gz"]);
  });
});
