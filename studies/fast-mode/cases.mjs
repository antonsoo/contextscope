const marker = { cache_control: { type: "ephemeral" } };

export function body(speed, { toolMarker = true, model = "claude-opus-5-5", longTtl = false } = {}) {
  const setupMarker = longTtl ? { cache_control: { type: "ephemeral", ttl: "1h" } } : marker;
  return {
    model, max_tokens: 512, ...(speed === undefined ? {} : { speed }),
    tools: [{ name: "lookup", description: "Fixed reference ".repeat(700), input_schema: { type: "object" }, ...(toolMarker ? setupMarker : {}) }],
    system: [{ type: "text", text: "Stable instructions ".repeat(500), ...setupMarker }],
    messages: [{ role: "user", content: [{ type: "text", text: "Fixed request ".repeat(500), ...marker }] }],
  };
}

export const cases = [
  { name: "marked-tools", requests: [body(), body("fast"), body("standard"), body("fast")], second: "tools", fastRate: 8 },
  { name: "system-marker-only", requests: [body(undefined, { toolMarker: false }), body("fast", { toolMarker: false }), body(undefined, { toolMarker: false })], second: "none", fastRate: 8 },
  { name: "mixed-ttls", requests: [body(undefined, { longTtl: true }), body("fast", { longTtl: true }), body(undefined, { longTtl: true })], second: "tools", fastRate: 8 },
  { name: "opus-5", requests: [body(undefined, { model: "claude-opus-5" }), body("fast", { model: "claude-opus-5" }), body(undefined, { model: "claude-opus-5" })], second: "tools", fastRate: 10 },
  { name: "opus-48", requests: [body(undefined, { model: "claude-opus-4-8" }), body("fast", { model: "claude-opus-4-8" }), body(undefined, { model: "claude-opus-4-8" })], second: "tools", fastRate: 10 },
  { name: "opus-46-fallback", requests: [body(undefined, { model: "claude-opus-4-6" }), body("fast", { model: "claude-opus-4-6" }), body(undefined, { model: "claude-opus-4-6" })], second: "full", fastRate: 5 },
  { name: "unpriced-fast", requests: [body(undefined, { model: "claude-sonnet-4-5" }), body("fast", { model: "claude-sonnet-4-5" }), body(undefined, { model: "claude-sonnet-4-5" })], second: "tools" },
];
