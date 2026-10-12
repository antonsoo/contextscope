import { readFileSync } from "node:fs";
const sdk = readFileSync(new URL("./evidence/sdk-requests.jsonl", import.meta.url), "utf8").trim();
const [first, second] = sdk.split("\n");
const withNumber = (number) => first.replace("18446744073709551614", number);
export const cases = [
  { name: "sdk-jsonl", input: sdk, rejected: true },
  { name: "sdk-array", input: `[${first},${second}]`, rejected: true },
  { name: "body-object", input: `{"body":${first}}`, rejected: true },
  { name: "body-string", input: JSON.stringify({ request_body: first }), rejected: true },
  { name: "second-jsonl-line", input: `${withNumber("1")}\n${second}`, rejected: true },
  { name: "precise-decimal", input: `${withNumber("0.1")}\n${withNumber("0.10000000000000001")}`, rejected: true },
  { name: "binary-exact-serialization-changes", input: withNumber("36028797018963968"), rejected: true },
  { name: "openai-schema", input: '{"model":"gpt-6-sol","input":"Look up the allowed record.","tools":[{"type":"function","name":"lookup","parameters":{"type":"object","properties":{"id":{"enum":[18446744073709551615]}}}}]}', rejected: true },
  { name: "metadata", input: `{"body":${withNumber("1")},"metadata":{"record":18446744073709551615}}`, rejected: true },
  { name: "distinct-supported-integers", input: `${withNumber("9007199254740992")}\n${withNumber("9007199254740994")}`, rejected: false, equalPrompt: false },
  { name: "equivalent-decimal-spellings", input: `${withNumber("1000")}\n${withNumber("1.000e3")}`, rejected: false, equalPrompt: true },
  { name: "distinct-string-identifiers", input: `${withNumber('"18446744073709551614"')}\n${withNumber('"18446744073709551615"')}`, rejected: false, equalPrompt: false },
];
