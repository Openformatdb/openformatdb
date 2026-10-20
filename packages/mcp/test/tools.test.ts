import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LocalBackend } from "../src/backend.ts";
import { TOOLS, type Context } from "../src/tools.ts";
import { makeRepo } from "./fixture.ts";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

async function withRepo(fn: (ctx: Context) => Promise<void>) {
  const root = makeRepo();
  try { await fn({ backend: new LocalBackend(root), today: "2026-10-20" }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("identify_file: signature beats extension, wildcards match", () => withRepo(async (ctx) => {
  const png: any = await tool("identify_file").run(ctx, { magic_hex: "89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52 00 00", extension: "photo.PNG" });
  assert.equal(png.candidates[0].id, "portable-network-graphics-1-2");
  assert.deepEqual(png.candidates[0].matched, ["signature (16 bytes)", "extension .png"]);
  const jpg: any = await tool("identify_file").run(ctx, { magic_hex: "ffd8ffe000104a46494600010101" });
  assert.equal(jpg.candidates[0].id, "jpeg-file-interchange-format-1-01");
  // A .png name on JPEG bytes: the signature wins and the PNG records only come after.
  const lie: any = await tool("identify_file").run(ctx, { magic_hex: "ffd8ffe000104a46494600010101", extension: "x.png" });
  assert.equal(lie.candidates[0].id, "jpeg-file-interchange-format-1-01");
}));

test("identify_file: extension only is flagged, nothing given is an error", () => withRepo(async (ctx) => {
  const dat: any = await tool("identify_file").run(ctx, { extension: "dat", magic_hex: "00112233" });
  assert.equal(dat.candidates[0].id, "acme-data-file");
  assert.match(dat.note, /No signature matched/);
  assert.equal((await tool("identify_file").run(ctx, {})).ok, false);
}));

test("lookup_format: by PUID, merged with Wikidata, tools inherited from the family", () => withRepo(async (ctx) => {
  const r: any = await tool("lookup_format").run(ctx, { puid: "fmt/13" });
  assert.equal(r.found, true);
  assert.equal(r.id, "portable-network-graphics-1-2");
  assert.equal(r.family, "portable-network-graphics");
  assert.equal(r.family_record.status, "writable");
  assert.equal(r.tools[0].name, "GIMP"); // open source first
  assert.equal(r.tools[0].via, "portable-network-graphics");
  assert.equal(r.tools_open_source, 1);
  assert.match(r.advice, /reads and writes it: GIMP/);
  assert.match(r.advice, /listed for the family/);
  const fam: any = await tool("lookup_format").run(ctx, { wikidata: "q178051" });
  assert.deepEqual(fam.versions.map((v: any) => v.id), ["portable-network-graphics-1-2"]);
  assert.equal((await tool("lookup_format").run(ctx, { id: "nope" }) as any).found, false);
}));

test("search_formats and list_sources", () => withRepo(async (ctx) => {
  const s: any = await tool("search_formats").run(ctx, { query: "png" });
  assert.equal(s.results[0].id, "portable-network-graphics"); // the family, with its open tools, first
  assert.equal(s.count, 2);
  assert.equal((await tool("search_formats").run(ctx, { query: "jpeg", status: "writable" }) as any).count, 0);
  const src: any = await tool("list_sources").run(ctx, {});
  assert.deepEqual(src.sources.map((x: any) => [x.source, x.records]), [["converters", 1], ["pronom", 3], ["wikidata", 2]]);
  assert.equal(src.total, 4);
}));

test("claim_format: stub keeps the PUID so it merges back; renewal replaces; limits enforced", () => withRepo(async (ctx) => {
  const root = (ctx.backend as any).root as string;
  const c: any = await tool("claim_format").run(ctx, { id: "acme-data-file", who: "ana", contact: "ana@example.org", scope: "header", days: 10 });
  assert.equal(c.ok, true, c.error);
  assert.equal(c.action, "created");
  assert.equal(c.effective_status, "in-progress");
  const yaml = readFileSync(join(root, "data/formats/acme-data-file.yaml"), "utf8");
  assert.match(yaml, /fmt\/9999/);
  assert.equal((await ctx.backend.records()).filter((r) => r.identifiers?.puid?.includes("fmt/9999")).length, 1); // merged, not duplicated
  const again: any = await tool("claim_format").run(ctx, { id: "acme-data-file", who: "ana", contact: "x", scope: "header", days: 20 });
  assert.equal(again.action, "updated");
  assert.equal((await ctx.backend.get("acme-data-file"))!.claims!.length, 1);
  assert.equal((await tool("claim_format").run(ctx, { id: "acme-data-file", who: "a", contact: "b", scope: "c", days: 365 })).ok, false);
  assert.equal((await tool("claim_format").run(ctx, { id: "acme-data-file", who: "a", contact: "b", scope: "remove the DRM" })).ok, false);
}));

test("claim_format: a new format needs a category; a similar name is pointed out", () => withRepo(async (ctx) => {
  assert.match((await tool("claim_format").run(ctx, { name: "Zork Save", who: "a", contact: "b", scope: "c" }) as any).error, /category/);
  const ok: any = await tool("claim_format").run(ctx, { name: "Zork Save", category: "save-game", extensions: [".SAV"], who: "a", contact: "b", scope: "c" });
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual((await ctx.backend.get("zork-save"))!.identifiers!.extensions, ["sav"]);
  const near: any = await tool("claim_format").run(ctx, { name: "Portable Network Graphics", version: "1.3", category: "image", who: "a", contact: "b", scope: "c" });
  assert.equal(near.ok, false);
  assert.ok(near.similar.length);
}));

test("publish_findings: merges, forward-only status, releases the claim, rejects unknown targets", () => withRepo(async (ctx) => {
  await tool("claim_format").run(ctx, { id: "acme-data-file", who: "ana", contact: "x", scope: "header" });
  const patch = {
    status: "readable", summary: "Acme instrument log.",
    structure: [{ name: "header", status: "documented", confidence: "medium", spec: "https://example.org/acme.md" }],
    parsers: [{ engine: "kaitai", url: "https://example.org/acme.ksy", license: "CC0-1.0", coverage: "partial" }],
    provenance: { ai_assisted: true, tools: ["claude-code"] },
  };
  const p: any = await tool("publish_findings").run(ctx, { id: "acme-data-file", patch, release_claim_of: "ana" });
  assert.equal(p.ok, true, p.error);
  assert.equal(p.released_claims, 1);
  assert.deepEqual(p.warnings, []);
  const r = (await ctx.backend.get("acme-data-file"))!;
  assert.equal(r.status, "readable");
  assert.equal(r.parsers![0].engine, "kaitai");
  assert.equal(r.identifiers!.extensions![0], "dat"); // imported data still merged in
  assert.equal((await tool("publish_findings").run(ctx, { id: "acme-data-file", patch: { status: "partial" } }) as any).ok, false);
  assert.match((await tool("publish_findings").run(ctx, { id: "acme-data-file", patch: { conversions: [{ to: "nope", tool: "x", fidelity: "lossy" }] } }) as any).error, /not a known format/);
  assert.match((await tool("publish_findings").run(ctx, { id: "acme-data-file", patch: { bogus: 1 } }) as any).error, /Invalid patch/);
  // Inherited tools never get written into curated files.
  await tool("publish_findings").run(ctx, { id: "portable-network-graphics-1-2", patch: { summary: "PNG 1.2." } });
  assert.doesNotMatch(readFileSync(join((ctx.backend as any).root, "data/formats/portable-network-graphics-1-2.yaml"), "utf8"), /via:/);
}));

test("find_conversion: by extension or id, inherited from the family, direct list without target", () => withRepo(async (ctx) => {
  const r: any = await tool("find_conversion").run(ctx, { from: "photo.png", to: "jpg" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.found, true);
  assert.equal(r.paths[0].steps[0].tool, "ImageMagick");
  assert.equal(r.paths[0].fidelity, "lossy");
  const v: any = await tool("find_conversion").run(ctx, { from: "portable-network-graphics-1-2", to: "jpeg-file-interchange-format-1-01" });
  assert.equal(v.paths[0].steps[0].via, "portable-network-graphics");
  const direct: any = await tool("find_conversion").run(ctx, { from: "portable-network-graphics" });
  assert.equal(direct.count, 1);
  assert.equal((await tool("find_conversion").run(ctx, { from: "jpg", to: "png" }) as any).found, false);
  assert.equal((await tool("find_conversion").run(ctx, { from: "nope-zzz" })).ok, false);
}));
