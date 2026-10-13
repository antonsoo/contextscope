// Constructed captures. No provider requests or private documents.
export function configuration() {
  return Array.from({ length: 200 }, (_, i) => i === 50 ? 'allow_delete = false'
    : i === 150 ? 'retry_budget = 3' : `setting_${String(i).padStart(3, '0')} = original`).join('\n');
}
export function request(texts, model = 'claude-sonnet-5') {
  return { model, messages: [{ role: 'user', content: texts.map(text => ({ type: 'text', text })) }] };
}
export const original = configuration();
export const edited = original.replace('allow_delete = false', 'allow_delete = true').replace('retry_budget = 3', 'retry_budget = 8');
export const cases = {
  edits: request([original, edited]),
  exact: request([original, original]),
  whitespace: request([original, original.replace('setting_000 = original\n', 'setting_000\t=  original\r\n') + '\n']),
  html: request([original + '\n<img src="https://example.invalid/pixel" onerror="alert(1)">', original + '\n<script>alert(2)</script>']),
  large: request([original.repeat(100), edited.repeat(100)]),
  surrogate: request([original + '\n\ud800', original + '\n\ud801']),
  crossRequest: [request([original, edited]), request(['An unrelated conversation with no repeated material.'])],
};
