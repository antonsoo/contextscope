import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderHtmlReport } from "../src/cli/html-report.js";
import { analyze } from "../src/core/index.js";

const text = readFileSync(new URL("../examples/anthropic-duplicate-tool-results.jsonl", import.meta.url), "utf8");

describe("the HTML report", () => {
  const html = renderHtmlReport(analyze(text));

  it("is one file with no script, and loads nothing from outside", () => {
    expect(html).not.toMatch(/<script/i);
    // A link to follow is fine; a stylesheet, an image or a frame to fetch is not.
    expect(html).not.toMatch(/<(link|img|iframe|object|embed|video|audio|source)\b/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/);
  });

  it("carries a policy that has the browser hold it to that", () => {
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
    expect(policy).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
    // The policy governs what follows it.
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<style"));
  });
});
