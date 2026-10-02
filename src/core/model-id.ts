import { normalizeModelId } from "./pricing.js";

/** Two requests hit the same prompt cache only if they run on the same model: a cached prefix is
 * the model's own attention state, so it can't carry over to a different model. An unknown model
 * on either side is treated as "same", since there is nothing to compare. */
export function sameModel(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return true;
  return normalizeModelId(a) === normalizeModelId(b);
}

/**
 * Sets of cached prefixes, one per model. What a request can read is what its own model cached,
 * plus - by the same rule as `sameModel` - what a request with no model named cached; a request
 * with no model named can read everything.
 */
export class ModelScoped {
  private readonly byModel = new Map<string, Set<number>>();

  private static key(model: string | undefined): string {
    return model === undefined ? "" : normalizeModelId(model);
  }

  /** The set this model writes to. */
  of(model: string | undefined): Set<number> {
    const key = ModelScoped.key(model);
    let set = this.byModel.get(key);
    if (set === undefined) {
      set = new Set();
      this.byModel.set(key, set);
    }
    return set;
  }

  /** Every set a request on this model can read from. */
  visibleTo(model: string | undefined): Set<number>[] {
    const mine = ModelScoped.key(model);
    const out: Set<number>[] = [];
    for (const [key, set] of this.byModel) {
      if (mine === "" || key === "" || key === mine) out.push(set);
    }
    return out;
  }
}
