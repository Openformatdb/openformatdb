// The remote backend against the static API the site builds (same shapes as site/src/pages/api).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { loadAll, toIndexEntry } from "@openformatdb/core";
import { RemoteBackend, backendFromEnv } from "../src/backend.ts";
import { TOOLS } from "../src/tools.ts";
import { makeRepo } from "./fixture.ts";

function staticApi(root: string) {
  const records = loadAll(root);
  const files = new Map<string, unknown>();
  files.set("/api/index.json", records.map((r) => { const { identifiers: { magic: _, ...ids }, ...e } = toIndexEntry(r, "2026-10-20"); return { ...e, identifiers: ids }; }));
  files.set("/api/magic.json", Object.fromEntries(records.filter((r) => r.identifiers?.magic).map((r) => [r.id, r.identifiers!.magic!.map((m) => [m.offset, m.hex])])));
  files.set("/api/conversions.json", Object.fromEntries(records.filter((r) => r.conversions?.length).map((r) => [r.id, r.conversions])));
  for (const r of records) files.set(`/api/formats/${r.id}.json`, r);
  let calls = 0;
  const fetch = async (url: string) => {
    calls++;
    const v = files.get(new URL(url).pathname);
    return { ok: v !== undefined, status: v === undefined ? 404 : 200, json: async () => v };
  };
  return { fetch, calls: () => calls };
}

test("remote backend: identify, lookup (full record on demand), conversions, read-only writes", async () => {
  const root = makeRepo();
  try {
    const api = staticApi(root);
    const backend = new RemoteBackend("https://example.org/", { fetch: api.fetch });
    const ctx = { backend, today: "2026-10-20" };
    const tool = (n: string) => TOOLS.find((t) => t.name === n)!;
    const id: any = await tool("identify_file").run(ctx, { magic_hex: "89504e470d0a1a0a0000000d49484452" });
    assert.equal(id.candidates[0].id, "portable-network-graphics-1-2");
    const l: any = await tool("lookup_format").run(ctx, { puid: "fmt/13" });
    assert.equal(l.tools[0].name, "GIMP");
    assert.equal(l.family_record.id, "portable-network-graphics");
    const c: any = await tool("find_conversion").run(ctx, { from: "png", to: "jpg" });
    assert.equal(c.found, true);
    const s: any = await tool("search_formats").run(ctx, { query: "png" });
    assert.equal(s.results[0].open_tools, 1); // counts come from the index
    const w: any = await tool("claim_format").run(ctx, { id: "acme-data-file", who: "a", contact: "b", scope: "c" });
    assert.match(w.error, /cannot write/);
    const before = api.calls();
    await tool("search_formats").run(ctx, { query: "jpeg" });
    assert.equal(api.calls(), before); // cached
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backendFromEnv: OFDB_REPO local, OFDB_API_URL remote", () => {
  assert.equal(backendFromEnv({ OFDB_REPO: "/tmp/x" }).kind, "local");
  assert.equal(backendFromEnv({ OFDB_API_URL: "https://example.org" }).kind, "remote");
});
