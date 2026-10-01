/** Small deterministic-serialization helpers shared by the parsers and findings. */

/** JSON.stringify with recursively sorted object keys, so semantically identical objects with
 * different key order serialize identically. Used by the optimized cache scenario ("what if the
 * schema were serialized deterministically") and by the key-order finding. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value)) ?? "null";
}

/** A JSON object: not null, not an array. Request logs are untrusted input, so the parsers
 * check before reading a field rather than assume the documented shape. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The text of a segment: the string itself, or the JSON of whatever sits where a string
 * should be, so a malformed block is still counted and compared instead of crashing the parse. */
export function asText(value: unknown): string {
  return typeof value === "string" ? value : blockJson(value);
}

function withoutCacheControl(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !("cache_control" in value)) return value;
  const rest: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete rest["cache_control"];
  return rest;
}

/**
 * A content block or tool definition as the API receives it - key order preserved, because the
 * prompt is rendered in that order and a reordered key breaks the cached prefix - minus its
 * `cache_control` marker. A rolling breakpoint moves every turn; the marker isn't part of the
 * cached content, so it must not make two otherwise identical blocks differ.
 */
export function blockJson(value: unknown): string {
  // JSON.stringify(undefined) is undefined, not a string.
  return JSON.stringify(withoutCacheControl(value)) ?? "null";
}

/** blockJson with sorted keys: the same block if it were serialized deterministically. */
export function canonicalBlockJson(value: unknown): string {
  return canonicalJson(withoutCacheControl(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeysDeep(v);
    return out;
  }
  return value;
}

/** Recursively lists object keys in their ORIGINAL (insertion) order, depth-first, as
 * "path.key" strings - used to detect "tool schema key order differs" between requests. */
export function keyOrderFingerprint(value: unknown, prefix = ""): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => out.push(...keyOrderFingerprint(item, `${prefix}[${i}]`)));
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out.push(`${prefix}.${key}`);
      out.push(...keyOrderFingerprint((value as Record<string, unknown>)[key], `${prefix}.${key}`));
    }
  }
  return out;
}

/** A short, stable hash (FNV-1a, 32-bit, hex) for content-based dedup/shingling. No crypto
 * dependency needed - this is for grouping identical/near-identical text, not security. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
