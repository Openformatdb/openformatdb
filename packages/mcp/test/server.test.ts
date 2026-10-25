// End to end: spawn the stdio server and talk to it with the official SDK client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeRepo } from "./fixture.ts";

const SERVER = fileURLToPath(new URL("../src/server.ts", import.meta.url));

test("stdio server lists the tools and identifies a PNG", async () => {
  const root = makeRepo();
  const client = new Client({ name: "ofdb-test", version: "0.0.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [SERVER], env: { ...process.env, OFDB_REPO: root } as Record<string, string>, stderr: "ignore",
    }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["claim_format", "convert_file", "find_conversion", "identify_file", "list_sources", "lookup_format", "publish_findings", "search_formats"]);
    assert.ok(tools.find((t) => t.name === "identify_file")!.inputSchema.properties!.magic_hex);
    const res: any = await client.callTool({ name: "identify_file", arguments: { magic_hex: "89504e470d0a1a0a0000000d49484452" } });
    assert.equal(res.isError, false);
    assert.equal(JSON.parse(res.content[0].text).candidates[0].id, "portable-network-graphics-1-2");
    const bad: any = await client.callTool({ name: "lookup_format", arguments: {} });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
