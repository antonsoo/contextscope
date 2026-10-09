// Used by verify.py. Each trajectory gets a fresh process, releasing tokenizer caches.
import { readFileSync, writeFileSync } from "node:fs";
import { readReportedUsage } from "../../dist/core/reported-usage.js";

const [mode, input, output] = process.argv.slice(2);
if (mode === "normalize") {
  const rows = readFileSync(input, "utf8").trim().split("\n").map((line) => {
    const row = JSON.parse(line);
    return { key: row.key, usage: readReportedUsage({ request: {}, response: { usage: row.usage } }, "request", row.provider) };
  });
  writeFileSync(output, JSON.stringify(rows));
} else if (mode === "analyze") {
  const { analyze, toJsonReport } = await import("../../dist/core/index.js");
  const result = analyze(readFileSync(input, "utf8"));
  writeFileSync(output, toJsonReport(result));
} else {
  throw new Error("Expected normalize or analyze mode");
}
