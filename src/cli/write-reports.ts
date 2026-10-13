import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, type BigIntStats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface ReportPath { path: string; label: "HTML" | "JSON" }
export interface ReportFile extends ReportPath { text: string }

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Validate every destination together, before analysis or optional calibration. */
export function validateReportPaths(input: string, reports: readonly ReportPath[]): void {
  if (!reports.length) return;
  const seen: { label: string; path: string; info: BigIntStats | undefined }[] = [
    { label: "input", path: realpathSync(input), info: statSync(input, { bigint: true }) },
  ];
  for (const report of reports) {
    const path = resolve(report.path);
    const info = (() => {
      try { return lstatSync(path, { bigint: true }); }
      catch (error) { if (missing(error)) return undefined; throw error; }
    })();
    // Do not follow a link or replace the link itself with a regular file.
    // Parents may be symlinked; their resolved names still identify the same file.
    if (info?.isSymbolicLink()) throw new Error(`${report.label} output must not be a symbolic link: ${report.path}`);
    if (info && !info.isFile()) throw new Error(`${report.label} output must be a regular file: ${report.path}`);
    const canonical = join(realpathSync(dirname(path)), basename(path));
    for (const previous of seen) {
      if (canonical === previous.path || (info && previous.info && info.dev === previous.info.dev && info.ino === previous.info.ino)) {
        throw new Error(`${report.label} output and ${previous.label} must use distinct files, including file aliases.`);
      }
    }
    seen.push({ label: report.label, path: canonical, info });
  }
}

/** Stage all reports before replacing any; each replacement is atomic.
 * This is not a transaction across both reports or a lock against other writers. */
export function writeReports(input: string, reports: readonly ReportFile[]): void {
  validateReportPaths(input, reports);
  const staged: { temporary: string; destination: string }[] = [];
  const errors: unknown[] = [];
  try {
    for (const report of reports) {
      const destination = resolve(report.path);
      const temporary = join(dirname(destination), `.contextscope-${randomUUID()}.tmp`);
      const fd = openSync(temporary, "wx", 0o600);
      staged.push({ temporary, destination });
      try {
        writeFileSync(fd, report.text, "utf8");
        fsyncSync(fd);
      } finally { closeSync(fd); }
    }
    validateReportPaths(input, reports);
    for (const file of staged) renameSync(file.temporary, file.destination);
  } catch (error) {
    errors.push(error);
  } finally {
    for (const file of staged) {
      try { unlinkSync(file.temporary); }
      catch (error) { if (!missing(error)) errors.push(error); }
    }
  }
  if (errors.length) throw errors[0];
}
