import { isRecord } from "./json-utils.js";
import { ContextScopeParseError } from "./parse-error.js";
import type { ParsedRequest } from "./types.js";

export interface AnthropicInjectedSettings {
  format: Record<string, unknown> | null;
  /** Schema property order is meaningful; do not canonicalize this key. */
  formatKey: string;
  citations: boolean;
}

/** Request controls that change provider-injected prompt instructions.
 * This reads content grammar only: schema examples and tool inputs may quote
 * documents without actually supplying a citable content block.
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs#prompt-modification-and-token-costs
 * https://platform.claude.com/docs/en/build-with-claude/prompt-caching#what-invalidates-the-cache
 */
export function anthropicInjectedSettings(request: Pick<ParsedRequest, "raw" | "index">): AnthropicInjectedSettings {
  const raw = isRecord(request.raw) ? request.raw : {};
  const fail = (detail: string): never => { throw new ContextScopeParseError(`Request ${request.index + 1}: ${detail}`); };
  const config = raw.output_config;
  const current = isRecord(config) ? config.format : undefined;
  const legacy = raw.output_format;
  if (current != null && legacy != null) fail("both output_config.format and deprecated output_format are present; select one output format before simulating cache use.");
  const value = current ?? legacy ?? null;
  let format: Record<string, unknown> | null = null;
  if (value !== null) {
    if (!isRecord(value) || value.type !== "json_schema" || !isRecord(value.schema)) {
      fail("output format must have type \"json_schema\" and an object-valued schema, or be null/omitted. Unsupported format settings cannot establish cache reuse.");
    }
    format = value as Record<string, unknown>;
  }

  const modes = { document: new Set<boolean>(), search_result: new Set<boolean>() };
  function visit(block: unknown, path: string): void {
    if (!isRecord(block)) return;
    if (block.type === "document" || block.type === "search_result") {
      const citation = block.citations;
      let enabled = false;
      if (citation !== undefined && citation !== null) {
        if (!isRecord(citation) || (citation.enabled !== undefined && typeof citation.enabled !== "boolean")) {
          fail(`${path}.citations.enabled must be boolean when supplied; malformed citation controls cannot establish a cache scope.`);
        }
        enabled = (citation as { enabled?: boolean }).enabled ?? false;
      }
      modes[block.type].add(enabled);
    } else if ((block.type === "tool_result" || block.type === "mcp_tool_result") && Array.isArray(block.content)) {
      block.content.forEach((child, i) => visit(child, `${path}.content[${i}]`));
    }
  }
  if (Array.isArray(raw.messages)) raw.messages.forEach((message, i) => {
    if (isRecord(message) && Array.isArray(message.content)) message.content.forEach((block, j) => visit(block, `messages[${i}].content[${j}]`));
  });
  if (modes.document.size > 1 || modes.search_result.size > 1) {
    fail("mixed citation enablement within document or search_result blocks is unsupported by the API; enable citations on all blocks of that kind or on none.");
  }
  const citations = modes.document.has(true) || modes.search_result.has(true);
  if (format !== null && citations) fail("citations and structured output formats are incompatible; remove the output format or disable citations before simulating cache use.");
  return { format, formatKey: JSON.stringify(format), citations };
}
