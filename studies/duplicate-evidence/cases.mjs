// Synthetic local request captures. No request is sent to a provider.
export const snapshots = [0, 1, 2].map((stage) =>
  Array.from(
    { length: 200 },
    (_, i) =>
      `record_${String(i).padStart(3, "0")}=${(stage >= 1 && i >= 50 && i < 60) || (stage >= 2 && i >= 100 && i < 110) ? "updated" : "original"}`,
  ).join("\n"),
);
const phrase = "one two three four five six ".repeat(20);
const prefix = "synthetic-opaque-value-" + "x".repeat(190);
export const collision = [
  `${prefix}41d6d051e04b0a5f`,
  `${prefix}b4e1d39a5cc84eb3`,
];
export function request(texts, name = "fixture") {
  return {
    model: "claude-sonnet-4-5",
    max_tokens: 64,
    tools: [
      {
        name: "read_file",
        description: "Read the synthetic configuration fixture.",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ],
    messages: texts.flatMap((text, i) => [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: `${name}_${i}`,
            name: "read_file",
            input: { path: "synthetic-settings.conf" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: `${name}_${i}`, content: text },
        ],
      },
    ]),
  };
}
export const cases = [
  {
    name: "chained-edits",
    bodies: [request(snapshots)],
    expected: [{ kind: "near", members: 2, minimum: 182 / 210 }],
  },
  {
    name: "exact-copies",
    bodies: [request([snapshots[0], snapshots[0], snapshots[0]])],
    expected: [{ kind: "exact", members: 3, minimum: 1 }],
  },
  {
    name: "changed-repetition",
    bodies: [request([phrase, phrase.repeat(2)])],
    expected: [{ kind: "near", members: 2, minimum: 1 }],
  },
  { name: "short-hash-collision", bodies: [request(collision)], expected: [] },
  {
    name: "collision-in-separate-conversations",
    bodies: collision.map((text, i) =>
      request([text, text], `conversation${i}`),
    ),
    expected: [
      { kind: "exact", members: 2, minimum: 1 },
      { kind: "exact", members: 2, minimum: 1 },
    ],
  },
  {
    name: "different-evidence-at-same-paths",
    bodies: [
      request([phrase, phrase], "exact"),
      request(snapshots.slice(0, 2), "near"),
    ],
    expected: [
      { kind: "near", members: 2, minimum: 182 / 210 },
      { kind: "exact", members: 2, minimum: 1 },
    ],
  },
];
