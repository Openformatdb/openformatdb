import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { LocalBackend } from "../src/backend.ts";
import { TOOLS, type Context } from "../src/tools.ts";
import { makeRepo } from "./fixture.ts";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

function withRepo(fn: (ctx: Context) => void) {
  const root = makeRepo();
  try { fn({ backend: new LocalBackend(root), today: "2026-10-20" }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("identify_file: signature beats extension, wildcards match", () => withRepo((ctx) => {
  const png: any = tool("identify_file").run(ctx, { magic_hex: "89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00", extension: "photo.PNG" });
  assert.equal(png.candidates[0].id, "portable-network-graphics-1-2");
  assert.deepEqual(png.candidates[0].matched, ["signature (16 bytes)", "extension .png"]);
  const jpg: any = tool("identify_file").run(ctx, { magic_hex: "ffd8ffe000104a46494600010101" });
  assert.equal(jpg.candidates[0].id, "jpeg-file-interchange-format-1-01");
  // A .png name on JPEG bytes: the signature wins and the PNG records only come after.
  const lie: any = tool("identify_file").run(ctx, { magic_hex: "ffd8ffe000104a46494600010101", extension: "x.png" });
  assert.equal(lie.candidates[0].id, "jpeg-file-interchange-format-1-01");
}));

test("identify_file: extension only is flagged, nothing given is an error", () => withRepo((ctx) => {
  const dat: any = tool("identify_file").run(ctx, { extension: "dat", magic_hex: "00112233" });
  assert.equal(dat.candidates[0].id, "acme-data-file");
  assert.match(dat.note, /No signature matched/);
  assert.equal(tool("identify_file").run(ctx, {}).ok, false);
}));

test("lookup_format: by PUID, merged with Wikidata, tools inherited from the family", () => withRepo((ctx) => {
  const r: any = tool("lookup_format").run(ctx, { puid: "fmt/13" });
  assert.equal(r.found, true);
  assert.equal(r.id, "portable-network-graphics-1-2");
  assert.equal(r.family, "portable-network-graphics");
  assert.equal(r.family_record.status, "writable");
  assert.equal(r.tools[0].name, "GIMP"); // open source first
  assert.equal(r.tools[0].via, "portable-network-graphics");
  assert.equal(r.tools_open_source, 1);
  assert.match(r.advice, /reads and writes it: GIMP/);
  assert.match(r.advice, /listed for the family/);
  const fam: any = tool("lookup_format").run(ctx, { wikidata: "q178051" });
  assert.deepEqual(fam.versions.map((v: any) => v.id), ["portable-network-graphics-1-2"]);
  assert.equal((tool("lookup_format").run(ctx, { id: "nope" }) as any).found, false);
}));

test("search_formats and list_sources", () => withRepo((ctx) => {
  const s: any = tool("search_formats").run(ctx, { query: "png" });
  assert.equal(s.results[0].id, "portable-network-graphics"); // the family, with its open tools, first
  assert.equal(s.count, 2);
  assert.equal((tool("search_formats").run(ctx, { query: "jpeg", status: "writable" }) as any).count, 0);
  const src: any = tool("list_sources").run(ctx, {});
  assert.deepEqual(src.sources.map((x: any) => [x.source, x.records]), [["pronom", 3], ["wikidata", 2]]);
  assert.equal(src.total, 4);
}));
