import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, makeId, mergeRecords, mergeAll, effectiveStatus, validate, type FormatRecord } from "../src/index.ts";

const r = (o: Partial<FormatRecord>): FormatRecord => ({ id: "x", name: "X", category: "other", status: "unknown", updated: "2026-01-01", ...o });

test("slugify and makeId", () => {
  assert.equal(slugify("Café+ Pro"), "cafe-plus-pro");
  assert.equal(makeId("Portable Network Graphics", "1.2"), "portable-network-graphics-1-2");
  const long = makeId("a ".repeat(30) + "bbbbbbbbbb", undefined, 20);
  assert.ok(long.length <= 20 && !long.endsWith("-"), long);
});

test("merge keeps furthest status and unions identifiers", () => {
  const m = mergeRecords(
    r({ status: "partial", identifiers: { extensions: ["png"], magic: [{ offset: 0, hex: "89504e47" }] } }),
    r({ status: "writable", identifiers: { extensions: ["png", "apng"], magic: [{ offset: 0, hex: "89504e47" }] }, provenance: { sources: ["pronom"] } }),
  );
  assert.equal(m.status, "writable");
  assert.deepEqual(m.identifiers!.extensions, ["png", "apng"]);
  assert.equal(m.identifiers!.magic!.length, 1);
  assert.deepEqual(m.provenance!.sources, ["pronom"]);
});

test("mergeAll joins on a single shared PUID, the first record keeps its id", () => {
  const curated = r({ id: "png-1-2", name: "PNG", status: "writable", identifiers: { puid: ["fmt/13"] } });
  const imported = r({ id: "portable-network-graphics-1-2", name: "Portable Network Graphics", identifiers: { puid: ["fmt/13"], mime: ["image/png"] } });
  const out = mergeAll([[curated], [imported]]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "png-1-2");
  assert.equal(out[0].name, "PNG");
  assert.deepEqual(out[0].identifiers!.mime, ["image/png"]);
});

test("mergeAll never merges a family holding several PUIDs, nor on extension", () => {
  const family = r({ id: "png", identifiers: { puid: ["fmt/11", "fmt/12", "fmt/13"], extensions: ["png"] } });
  const v12 = r({ id: "png-1-1", identifiers: { puid: ["fmt/12"], extensions: ["png"] } });
  const v13 = r({ id: "png-1-2", identifiers: { puid: ["fmt/13"], extensions: ["png"] } });
  assert.equal(mergeAll([[family], [v12, v13]]).length, 3);
});

test("mergeAll is transitive: A~B by PUID, B~C by QID", () => {
  const out = mergeAll([
    [r({ id: "a", identifiers: { puid: ["fmt/1"] } })],
    [r({ id: "b", identifiers: { puid: ["fmt/1"], wikidata: ["Q1"] } })],
    [r({ id: "c", identifiers: { wikidata: ["Q1"] } })],
  ]);
  assert.deepEqual(out.map((x) => x.id), ["a"]);
});

test("mergeAll ignores an id that two records of one source share", () => {
  const access = (id: string, puid: string) => r({ id, identifiers: { puid: [puid], loc_fdd: ["fdd000462"] } });
  const loc = r({ id: "access-loc", identifiers: { loc_fdd: ["fdd000462"] } });
  const out = mergeAll([[access("access-95", "fmt/1"), access("access-97", "fmt/2")], [loc]]);
  assert.deepEqual(out.map((x) => x.id), ["access-95", "access-97", "access-loc"]);
});

test("live claim makes unknown in-progress, expired claim does not", () => {
  const c = { who: "me", contact: "x", scope: "header", since: "2026-10-01" };
  assert.equal(effectiveStatus(r({ claims: [{ ...c, expires: "2026-11-01" }] }), "2026-10-20"), "in-progress");
  assert.equal(effectiveStatus(r({ claims: [{ ...c, expires: "2026-10-02" }] }), "2026-10-20"), "unknown");
});

test("schema accepts a full record and rejects bad identifiers", () => {
  const png = r({
    id: "png", name: "Portable Network Graphics", category: "image", status: "writable",
    identifiers: { extensions: ["png"], mime: ["image/png"], puid: ["fmt/13"], wikidata: ["Q178051"], magic: [{ offset: 0, hex: "89504e470d0a1a0a" }] },
    spec: { availability: "open-standard", url: "https://www.w3.org/TR/png-3/", standard: "ISO/IEC 15948" },
    conversions: [{ to: "webp", tool: "cwebp", command: "cwebp -lossless in.png -o out.webp", fidelity: "lossless" }],
  });
  assert.deepEqual(validate(png), []);
  assert.notDeepEqual(validate({ ...png, id: "Bad ID" }), []);
  assert.notDeepEqual(validate({ ...png, identifiers: { puid: ["13"] } }), []);
  assert.notDeepEqual(validate({ ...png, identifiers: { magic: [{ offset: 0, hex: "89 50" }] } }), []);
});
