// Constructed request bodies containing synthetic text or pinned public source.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL("./", import.meta.url));
export const markers = ["<|endoftext|>", "<|fim_prefix|>", "<|fim_middle|>", "<|fim_suffix|>", "<|im_start|>", "<|im_end|>", "<|im_sep|>", "<|endofprompt|>", "<|startoftext|>", "<|start|>", "<|end|>", "<|message|>", "<|channel|>", "<|return|>", "<|constrain|>", "<|call|>"];
const publicSources = JSON.parse(readFileSync(here + "public/manifest.json"));
const payloads = [
  { id: "markers", text: 'Explain these literal tokenizer spellings: ' + markers.join(" ") },
  { id: "unicode", text: '設定: {"eos_token": "<|endoftext|>"}; keep the literal spelling. 🎉' },
  ...publicSources.filter((e) => !e.license).map((e) => {
    const data = readFileSync(here + "public/" + e.file);
    assert.equal(createHash("sha256").update(data).digest("hex"), e.sha256);
    return { id: e.repository.split("/")[1], text: data.toString("utf8") };
  }),
  { id: "ordinary", text: "Explain this ordinary configuration value, preserving whitespace.\n" },
];
const tool = (description) => ({ type: "function", function: { name: "read_file", description, parameters: { type: "object", properties: { path: { type: "string" } } } } });
const chat = (messages, tools) => ({ model: "gpt-5.2", messages, ...(tools ? { tools } : {}) });
const responses = (input, other = {}) => ({ model: "gpt-5.2", input, ...other });
const anthropic = (messages, other = {}) => ({ model: "claude-sonnet-5", max_tokens: 32, messages, ...other });
const variants = {
  "chat-user": (text) => chat([{ role: "user", content: text }]),
  "chat-system": (text) => chat([{ role: "system", content: text }, { role: "user", content: "Explain." }]),
  "chat-tool": (text) => chat([{ role: "user", content: "Read the file." }, { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"example.py"}' } }] }, { role: "tool", tool_call_id: "call_1", content: text }]),
  "chat-schema": (text) => chat([{ role: "user", content: "Explain." }], [tool(text)]),
  "responses-input": (text) => responses(text),
  "responses-instructions": (text) => responses("Explain.", { instructions: text }),
  "responses-tool": (text) => responses([{ type: "function_call", call_id: "call_1", name: "read_file", arguments: '{"path":"example.py"}' }, { type: "function_call_output", call_id: "call_1", output: text }]),
  "responses-schema": (text) => responses("Explain.", { tools: [{ type: "function", ...tool(text).function }] }),
  "anthropic-user": (text) => anthropic([{ role: "user", content: [{ type: "text", text }] }]),
  "anthropic-system": (text) => anthropic([{ role: "user", content: "Explain." }], { system: [{ type: "text", text, cache_control: { type: "ephemeral" } }] }),
  "anthropic-tool": (text) => anthropic([{ role: "user", content: "Read the file." }, { role: "assistant", content: [{ type: "tool_use", id: "tool_1", name: "read_file", input: { path: "example.py" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_1", content: [{ type: "text", text }] }] }]),
  "anthropic-schema": (text) => anthropic([{ role: "user", content: "Explain." }], { tools: [{ name: "read_file", description: text, input_schema: { type: "object", properties: {} } }] }),
};
export const cases = payloads.flatMap((p) => Object.entries(variants).map(([variant, make]) => ({ name: p.id + "-" + variant, payload: p.text, input: JSON.stringify(make(p.text)), reject: false })));
const repeated = "<|endoftext|>".repeat(256);
cases.push({ name: "cache-threshold", payload: repeated, input: [chat([{ role: "system", content: repeated }, { role: "user", content: "Hello." }]), chat([{ role: "system", content: repeated }, { role: "user", content: "Again." }])].map(JSON.stringify).join("\n"), reject: false });
cases.push({ name: "batch-envelope", payload: markers[0], input: JSON.stringify({ custom_id: "batch-1", method: "POST", url: "/v1/chat/completions", body: variants["chat-user"](markers[0]) }), reject: false });
cases.push({ name: "broken-json", input: '{"messages":[', reject: true });
cases.push({ name: "rounded-number", input: '{"model":"gpt-5.2","messages":[{"role":"user","content":{"id":18446744073709551615}}]}', reject: true });
export const oracleTexts = [...markers.flatMap((m) => [m, `word ${m} word`, JSON.stringify({ value: m })]), ...payloads.map((p) => p.text), repeated];
