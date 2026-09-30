import { normalizeModelId } from "./pricing.js";

/** Two requests hit the same prompt cache only if they run on the same model: a cached prefix is
 * the model's own attention state, so it can't carry over to a different model. An unknown model
 * on either side is treated as "same", since there is nothing to compare. */
export function sameModel(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return true;
  return normalizeModelId(a) === normalizeModelId(b);
}
