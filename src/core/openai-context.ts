import { isRecord } from "./json-utils.js";
import { ContextScopeParseError } from "./parse-error.js";
import type { UnmodeledContextKind } from "./types.js";

/** A native response can echo request fields; it is not another request. */
export function isOpenAiResponseObject(value: unknown): boolean {
  return isRecord(value) && value.object === "response" && Array.isArray(value.output);
}

/** Responses can consist entirely of a stored prompt/context reference. */
export function isResponsesBody(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !isOpenAiResponseObject(value) && !Array.isArray(value.messages)
    && ("input" in value || "instructions" in value
      || value.previous_response_id != null || value.conversation != null || value.prompt != null);
}

function requireId(value: unknown, path: string, index: number): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new ContextScopeParseError(`Request ${index + 1}: ${path} must be a nonempty string. An invalid reference cannot establish context or cache reuse.`);
}

export interface ContextControl {
  path: string;
  label: string;
  raw: unknown;
  kind: UnmodeledContextKind;
}

/** Inspect only actual top-level controls, never quoted text, schemas or metadata. */
export function openAiContextControls(raw: Record<string, unknown>, index: number): ContextControl[] {
  const out: ContextControl[] = [];
  if (raw.previous_response_id != null && raw.conversation != null) throw new ContextScopeParseError(`Request ${index + 1}: cannot combine previous_response_id and conversation. Select one context source before analysis.`);
  if (raw.previous_response_id != null) {
    requireId(raw.previous_response_id, "previous_response_id", index);
    out.push({ path: "previous_response_id", label: "stored response reference", raw: raw.previous_response_id, kind: "previous_response" });
  }
  if (raw.conversation != null) {
    requireId(isRecord(raw.conversation) ? raw.conversation.id : raw.conversation, "conversation or conversation.id", index);
    out.push({ path: "conversation", label: "stored conversation reference", raw: raw.conversation, kind: "conversation" });
  }
  if (raw.prompt != null) {
    requireId(isRecord(raw.prompt) ? raw.prompt.id : undefined, "prompt.id", index);
    out.push({ path: "prompt", label: "reusable prompt reference", raw: raw.prompt, kind: "prompt_template" });
  }
  return out;
}

/** A bare {id} is the SDK's ItemReference; inline message IDs do not imply a reference. */
export function openAiItemContext(item: Record<string, unknown>, path: string, index: number): UnmodeledContextKind | undefined {
  if (item.type === "item_reference" || (item.type == null && "id" in item && !("role" in item) && !("content" in item))) {
    requireId(item.id, `${path}.id`, index);
    return "item_reference";
  }
  // Summary/content fields and opaque ciphertext do not reproduce the
  // provider's reasoning-history rendering. Withhold this unit conservatively.
  if (item.type === "reasoning") return "reasoning";
  if (item.type === "compaction") return "compaction";
  return undefined;
}
