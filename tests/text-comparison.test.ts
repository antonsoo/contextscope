import { describe, expect, it } from "vitest";
import { compareText, escapedLine, MAX_COMPARISON_CHARS, textDownload } from "../web/src/lib/text-comparison.js";

function assertLiteralReconstruction(first: string, second: string): void {
  const result = compareText(first, second);
  expect(result.kind).toBe("diff");
  if (result.kind !== "diff") return;
  const firstLines = first.split(/(?<=\n)/).filter(s => s.length > 0);
  const secondLines = second.split(/(?<=\n)/).filter(s => s.length > 0);
  let a = 0, b = 0, left = "", right = "";
  for (const row of result.rows) {
    if (row.kind === "omitted") {
      const before = firstLines.slice(a, a + row.count).join("");
      const after = secondLines.slice(b, b + row.count).join("");
      expect(before).toBe(after);
      left += before; right += after; a += row.count; b += row.count;
    } else {
      const literal = row.text + (row.ending === "LF" ? "\n" : row.ending === "CRLF" ? "\r\n" : "");
      if (row.kind !== "added") { expect(row.firstLine).toBe(++a); left += literal; }
      else expect(row.firstLine).toBeNull();
      if (row.kind !== "removed") { expect(row.secondLine).toBe(++b); right += literal; }
      else expect(row.secondLine).toBeNull();
    }
  }
  expect(left).toBe(first); expect(right).toBe(second);
}

describe("literal duplicate text review", () => {
  it("locates distant consequential edits, folding only unchanged lines", () => {
    const before = Array.from({ length: 200 }, (_, i) => `setting_${i} = original`).join("\n");
    const after = before.replace("setting_50 = original", "setting_50 = changed").replace("setting_150 = original", "setting_150 = changed");
    assertLiteralReconstruction(before, after);
    const result = compareText(before, after);
    expect(result.kind).toBe("diff");
    if (result.kind === "diff") {
      expect([result.removedLines, result.addedLines]).toEqual([2, 2]);
      expect(result.rows.filter(r => r.kind === "added").map(r => r.secondLine)).toEqual([51, 151]);
      expect(result.rows.filter(r => r.kind === "omitted").map(r => r.count)).toEqual([47, 93, 46]);
    }
  });

  it.each([
    ["a\nb\n", "a\nb"], ["a\r\nb\r\n", "a\nb\n"], ["a b\n", "a\tb \n"],
    ["", "\n"], ["\n\n", "\n"], ["a\u0000b\n", "a\u0001b\n"],
    ["emoji: 😀\n", "emoji: 🐈\n"], ["surrogate: \ud800\n", "surrogate: \ud801\n"],
    ["<img src=x>\n", "<script>alert(1)</script>\n"], ["a\rb", "a\nb"],
  ])("preserves both literal texts including endings and controls: %j", (a, b) => {
    assertLiteralReconstruction(a, b);
    assertLiteralReconstruction(b, a);
  });

  it("never reports equal prefixes as identical complete text", () => {
    const prefix = "x".repeat(MAX_COMPARISON_CHARS);
    expect(compareText(prefix + "a", prefix + "b")).toEqual({ kind: "limited", reason: "input" });
    expect(compareText(prefix, prefix)).toEqual({ kind: "identical" });
    expect(compareText("a\n".repeat(6000), "b\n".repeat(6000))).toEqual({ kind: "limited", reason: "input" });
  });

  it("refuses excessive work or rendering without publishing a partial diff", () => {
    const a = Array.from({ length: 600 }, (_, i) => `before_${i}\n`).join("");
    const b = Array.from({ length: 600 }, (_, i) => `after_${i}\n`).join("");
    expect(compareText(a, b)).toEqual({ kind: "limited", reason: "work" });
    expect(compareText("a".repeat(20_000), "b".repeat(20_000))).toEqual({ kind: "limited", reason: "preview" });
  });

  it("makes invisible differences inspectable and preserves downloadable Unicode", () => {
    expect(escapedLine(" x\t\u0000\u202e ")).toBe('" x\\t\\u0000\\u{202e} "');
    const normal = "a\r\n😀\n";
    expect(textDownload(normal)).toEqual({ content: normal, type: "text/plain;charset=utf-8", extension: "txt" });
    const lone = "literal \ud800";
    const download = textDownload(lone);
    expect(download.extension).toBe("text.json");
    expect(JSON.parse(download.content)).toBe(lone);
  });
});
