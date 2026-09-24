/** Small deterministic-serialization helpers shared by the parsers and findings. */

/** JSON.stringify with recursively sorted object keys, so semantically identical objects with
 * different key order serialize identically. Used for token counting and content hashing -
 * NOT for the "tool schema key order differs" finding, which deliberately compares raw order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
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
