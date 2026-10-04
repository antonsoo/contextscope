/** Validate evidence before JSON.parse can overwrite fields or round overflow to Infinity.
 * Syntax remains the native parser's job; this scan bounds nesting and tracks object keys.
 * It is iterative so even an input thousands of levels deep produces an actionable error. */
export const MAX_JSON_DEPTH = 128;

export class JsonIntegrityError extends Error {}

export function readJson(text: string): unknown {
  // Native parsing is iterative and supplies syntax validation. Only inspect valid JSON:
  // an incomplete JSONL line must not make the following records appear nested inside it.
  const value: unknown = JSON.parse(text);
  const containers: (Set<string> | undefined)[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === '"') break;
      }
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      const keys = containers[containers.length - 1];
      if (keys && text[next] === ":") {
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        if (keys.has(key)) throw new JsonIntegrityError(`Duplicate JSON field ${JSON.stringify(key.slice(0, 80))}. Keep one explicit value before analysis.`);
        keys.add(key);
      }
    } else if (char === "{" || char === "[") {
      containers.push(char === "{" ? new Set() : undefined);
      if (containers.length > MAX_JSON_DEPTH) throw new JsonIntegrityError(`JSON nesting exceeds ${MAX_JSON_DEPTH} levels. Flatten the request metadata or split the log before analysis.`);
    } else if (char === "}" || char === "]") {
      containers.pop();
    }
  }
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "number" && !Number.isFinite(current)) {
      throw new JsonIntegrityError("JSON number is outside the finite JavaScript number range. Preserve it as a string or use representable units.");
    }
    if (current !== null && typeof current === "object") {
      for (const item of Object.values(current)) pending.push(item);
    }
  }
  return value;
}
