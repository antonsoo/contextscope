/**
 * Redacts the substrings that most commonly break an otherwise-stable
 * prefix - ISO-8601 timestamps, large epoch-looking integers, and UUIDs -
 * replacing each with a fixed placeholder. Used ONLY to compute the
 * "optimized" cache simulation (what the hit rate would look like if the
 * volatile field were parameterized out of the cached prefix, e.g. moved to
 * a per-request user message) and to drive the `volatile_prefix` finding.
 * Never used for token counts or the real/actual simulation - those always
 * use the literal text.
 */

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EPOCH_MS = /\b1[5-9]\d{11}\b/g; // 13-digit ms timestamps, roughly 2017-2286
const EPOCH_S = /\b1[5-9]\d{8}\b/g; // 10-digit second timestamps, roughly 2017-2286

export function stripVolatilePatterns(text: string): string {
  return text
    .replace(ISO_TIMESTAMP, "\u0000TIMESTAMP\u0000")
    .replace(UUID, "\u0000UUID\u0000")
    .replace(EPOCH_MS, "\u0000EPOCH\u0000")
    .replace(EPOCH_S, "\u0000EPOCH\u0000");
}

// Non-global copies for boolean checks: a `/g` regex's `.test()` is stateful (lastIndex
// persists across calls on the same instance), which would silently skip matches here.
const ISO_TIMESTAMP_ONCE = new RegExp(ISO_TIMESTAMP.source);
const UUID_ONCE = new RegExp(UUID.source, "i");
const EPOCH_MS_ONCE = new RegExp(EPOCH_MS.source);
const EPOCH_S_ONCE = new RegExp(EPOCH_S.source);

export function containsVolatilePattern(text: string): boolean {
  return ISO_TIMESTAMP_ONCE.test(text) || UUID_ONCE.test(text) || EPOCH_MS_ONCE.test(text) || EPOCH_S_ONCE.test(text);
}
