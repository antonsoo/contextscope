// node catalog.mjs MCP_SDK_DIST
// Read-only discovery from the public documentation server; no tool/model call.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = process.argv[2];
assert.ok(directory, "Pass @modelcontextprotocol/sdk/dist/esm");
const { Client } = await import(pathToFileURL(resolve(directory, "client/index.js")));
const { StreamableHTTPClientTransport } = await import(pathToFileURL(resolve(directory, "client/streamableHttp.js")));
const version = JSON.parse(await readFile(resolve(directory, "../../package.json"))).version;
const endpoint = "https://developers.openai.com/mcp";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = value => Buffer.from(JSON.stringify(value));
const client = new Client({ name: "contextscope-catalog-study", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: { signal: globalThis.AbortSignal.timeout(30000) },
});
try {
  await client.connect(transport);
  const pages = [], cursors = new Set();
  let cursor;
  do {
    assert.ok(pages.length < 16, "Discovery did not finish in 16 pages");
    const page = await client.listTools(cursor === undefined ? undefined : { cursor });
    assert.ok(page.resultType === undefined || page.resultType === "complete", "Explicitly incomplete discovery");
    pages.push(page);
    cursor = page.nextCursor;
    if (cursor !== undefined) { assert.ok(!cursors.has(cursor)); cursors.add(cursor); }
  } while (cursor !== undefined);
  const snapshot = { server: client.getServerVersion(), capabilities: client.getServerCapabilities(), pages };
  const tools = pages.flatMap(page => page.tools);
  const record = { endpoint, fetchedAt: new Date().toISOString(), sdk: { name: "@modelcontextprotocol/sdk", version },
    scope: "Decoded native SDK tools/list snapshot. Read-only metadata discovery, no model/provider call and no MCP tool invocation. Full decoded metadata is cached locally; the public ledger retains names, sizes and fingerprints.",
    complete: true, pages: pages.length, toolCount: tools.length,
    decodedSnapshot: { bytes: bytes(snapshot).length, sha256: sha(bytes(snapshot)) },
    tools: tools.map(tool => ({ name: tool.name,
      descriptionBytes: Buffer.byteLength(tool.description ?? ""), descriptionSha256: sha(Buffer.from(tool.description ?? "")),
      schemaBytes: bytes(tool.inputSchema).length, schemaSha256: sha(bytes(tool.inputSchema)) })) };
  await mkdir(new URL("cache/", import.meta.url), { recursive: true });
  await writeFile(new URL("cache/catalog.json", import.meta.url), bytes(snapshot));
  await writeFile(new URL("catalog.json", import.meta.url), JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ tools: tools.length, decodedBytes: record.decodedSnapshot.bytes, endpoint, complete: true }));
} finally { await client.close(); }
