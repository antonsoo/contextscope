import { normalizeModelId } from "./pricing.js";

/** Two requests hit the same prompt cache only if they run on the same model: a cached prefix is
 * the model's own attention state, so it can't carry over to a different model. Requests with
 * no model named form a separate assumed-model group; missing is not a wildcard. */
export function sameModel(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return normalizeModelId(a) === normalizeModelId(b);
}

/**
 * Sets of cached prefixes, one per model. What a request can read is what its own model cached,
 * with missing model names isolated from all named models. This matches `sameModel`.
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
    const entries = this.byModel.get(mine);
    return entries ? [entries] : [];
  }
}
