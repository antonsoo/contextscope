// Controlled request bodies, not captured API traffic.
const marker = { cache_control: { type: "ephemeral" } };
export function request(choice = { type: "auto" }, setupMarker = true) {
  return {
    model: "claude-sonnet-4-5-20250929", max_tokens: 100,
    tools: [{ name: "lookup", description: "Find a record", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }],
    system: [{ type: "text", text: "You answer questions using verified records. ".repeat(200), ...(setupMarker ? marker : {}) }],
    messages: [{ role: "user", content: [{ type: "text", text: "Find documentation on reliable parsers. ".repeat(200), ...marker }] }],
    ...(choice === undefined ? {} : { tool_choice: choice }),
  };
}
export const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=" } };
export function withImage(nested = false) {
  const body = request();
  if (nested) body.messages.push(
    { role: "assistant", content: [{ type: "tool_use", id: "lookup-1", name: "lookup", input: { query: "figure" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "lookup-1", content: [image] }] },
  );
  else body.messages[0].content.push(image);
  return body;
}
export const cases = [
  { name: "choice-with-setup-marker", requests: [request(), request({ type: "any" }), request()] },
  { name: "choice-without-setup-marker", requests: [request({ type: "auto" }, false), request({ type: "any" }, false), request({ type: "auto" }, false)] },
  { name: "parallel-tool-policy", requests: [request(), request({ type: "auto", disable_parallel_tool_use: true }), request({ type: "auto", disable_parallel_tool_use: false })] },
  { name: "image-after-marked-prefix", requests: [request(), withImage(), request()] },
  { name: "tool-result-image-after-prefix", requests: [request(), withImage(true), request()] },
];
