#!/usr/bin/env node
// OpenFormatDB MCP server (stdio). Data from OFDB_REPO or this checkout, see backend.ts.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { backendFromEnv, type Backend } from "./backend.ts";
import { TOOLS, READ_ONLY, type Context } from "./tools.ts";

export function createServer(backend: Backend, opts: { today?: string } = {}): McpServer {
  const server = new McpServer(
    { name: "openformatdb", version: "0.2.0" },
    {
      instructions:
        "OpenFormatDB is a directory of file formats: how to recognise each one, which software reads, writes and converts it, " +
        "and how far it is documented or reverse engineered. Before writing a parser or reverse engineering a file, " +
        "call identify_file with its first bytes (magic_hex) and name, then lookup_format on the best candidate. " +
        "If nothing open handles it and you start documenting it, call claim_format first and publish_findings when done, then open a pull request. " +
        `Data: ${backend.kind} (${backend.location})${backend.root ? "" : ", read-only"}.`,
    },
  );
  const ctx: Context = { backend, today: opts.today };
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.shape,
        annotations: { readOnlyHint: READ_ONLY.has(t.name), destructiveHint: false, openWorldHint: false },
      },
      async (args: any) => {
        try {
          const result = await t.run(ctx, args ?? {});
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], isError: !result.ok };
        } catch (e: any) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: String(e?.message ?? e) }) }], isError: true };
        }
      },
    );
  }
  return server;
}

// Entry point check that survives the npm bin symlink (import.meta.main needs Node >= 24.2).
const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const backend = backendFromEnv();
  await createServer(backend).connect(new StdioServerTransport());
  console.error(`openformatdb-mcp: ${backend.kind} data at ${backend.location}`);
}
