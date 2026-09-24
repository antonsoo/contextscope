// 16 tool definitions (Anthropic shape) for the realistic flagship example - enough that the
// "tools" segment of the prefix is itself a meaningful chunk of the context window, the way a
// real coding agent's tool surface is.

function tool(name, description, properties, required) {
  return {
    name,
    description,
    input_schema: {
      type: "object",
      properties,
      ...(required ? { required } : {}),
    },
  };
}

export const TOOLS = [
  tool("list_directory", "List files and subdirectories at a given path in the repository. Non-recursive; ignores .gitignore'd files.", {
    path: { type: "string", description: "Path relative to the repository root." },
  }, ["path"]),
  tool("read_file", "Read the full contents of a file in the repository as UTF-8 text.", {
    path: { type: "string", description: "Path relative to the repository root." },
  }, ["path"]),
  tool("grep_search", "Search tracked file contents for a regular expression, optionally scoped to a path prefix.", {
    pattern: { type: "string", description: "Regular expression to search for." },
    path_prefix: { type: "string", description: "Optional path prefix to scope the search." },
  }, ["pattern"]),
  tool("search_symbol", "Resolve a function, class, or top-level constant name to its definition site(s) across the whole monorepo.", {
    symbol: { type: "string", description: "The exact symbol name to look up." },
  }, ["symbol"]),
  tool("write_file", "Overwrite a file with new contents. The file must already exist and have been read or patched earlier in this conversation, or must not yet exist.", {
    path: { type: "string" },
    content: { type: "string", description: "The full new contents of the file." },
  }, ["path", "content"]),
  tool("apply_patch", "Apply a unified diff to a file already present in this conversation's history. Fails loudly, naming the first hunk that doesn't match, rather than applying partially.", {
    path: { type: "string" },
    diff: { type: "string", description: "A unified diff (as produced by `diff -u`) to apply to the file." },
  }, ["path", "diff"]),
  tool("run_tests", "Run the project's pytest suite, optionally scoped to a -k pattern.", {
    pattern: { type: "string", description: "Optional pytest -k style pattern to scope the run." },
    path: { type: "string", description: "Optional path to scope the run to a directory or file." },
  }),
  tool("run_lint", "Run ruff across the whole monorepo or a given path.", {
    path: { type: "string", description: "Optional path to scope the lint run." },
  }),
  tool("run_typecheck", "Run mypy --strict across the whole monorepo or a given path.", {
    path: { type: "string", description: "Optional path to scope the typecheck run." },
  }),
  tool("format_file", "Run the repository's configured formatter (black for Python, prettier for TypeScript) on exactly the given file.", {
    path: { type: "string" },
  }, ["path"]),
  tool("git_status", "Show the working tree status of the sandbox's local git checkout.", {}),
  tool("git_diff", "Show the working tree diff of the sandbox's local git checkout, optionally scoped to a path.", {
    path: { type: "string", description: "Optional path to scope the diff." },
  }),
  tool("git_commit", "Create a commit from the currently staged changes in the sandbox's local git checkout (never pushed anywhere by this tool).", {
    message: { type: "string", description: "The commit message." },
  }, ["message"]),
  tool("get_file_history", "Return the most recent commit summaries touching a given path, most recent first.", {
    path: { type: "string" },
    limit: { type: "integer", description: "Maximum number of commits to return. Defaults to 10." },
  }, ["path"]),
  tool("install_dependency", "Add a package to the relevant pyproject.toml or package.json and update the lockfile.", {
    package: { type: "string" },
    version: { type: "string", description: "Optional exact version constraint." },
    ecosystem: { type: "string", enum: ["python", "node"] },
  }, ["package", "ecosystem"]),
  tool("fetch_ci_status", "Look up the most recent CI run for the current branch and report pass/fail per stage. Does not trigger a new run.", {}),
];

export function toOpenAiTools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}
