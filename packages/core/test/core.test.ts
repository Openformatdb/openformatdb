import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, makeId, mergeRecords, mergeAll, linkFamilies, inheritFromFamily, effectiveStatus, validate, type FormatRecord } from "../src/index.ts";

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

test("same id with conflicting PUIDs: renamed, not merged; families follow", () => {
  const p = r({ id: "apple-disk-image", identifiers: { puid: ["fmt/1071"] }, provenance: { sources: ["pronom"] } });
  const w = r({ id: "apple-disk-image", identifiers: { puid: ["fmt/625"] }, provenance: { sources: ["wikidata"] } });
  const v = r({ id: "apple-disk-image-v2", family: "apple-disk-image", identifiers: { puid: ["fmt/626"] }, provenance: { sources: ["wikidata"] } });
  const out = mergeAll([[p], [w, v]]);
  assert.deepEqual(out.map((x) => x.id), ["apple-disk-image", "apple-disk-image-v2", "apple-disk-image-wikidata"]);
  assert.equal(out.find((x) => x.id === "apple-disk-image-v2")!.family, "apple-disk-image-wikidata");
  // Same id, no conflicting identifier: merged.
  assert.equal(mergeAll([[r({ id: "csv", identifiers: { puid: ["x-fmt/18"] } })], [r({ id: "csv", identifiers: { wikidata: ["Q935809"] } })]]).length, 1);
});

test("family ids follow the merge, families link by PUID, tools are inherited with via", () => {
  const pronom = [r({ id: "png-1-2", identifiers: { puid: ["fmt/13"] } }), r({ id: "jp2-a", identifiers: { puid: ["fmt/392"] } })];
  const wd = [
    r({ id: "png", identifiers: { wikidata: ["Q178051"] }, status: "writable", tools: [{ name: "GIMP", url: "https://www.gimp.org", reads: true, writes: true }] }),
    r({ id: "png-version-1-2", family: "png", identifiers: { puid: ["fmt/13"], wikidata: ["Q27229642"] } }),
    r({ id: "jpeg-2000", identifiers: { puid: ["fmt/392", "fmt/463"] }, tools: [{ name: "OpenJPEG", url: "https://www.openjpeg.org" }] }),
  ];
  const out = inheritFromFamily(linkFamilies(mergeAll([pronom, wd])));
  const png12 = out.find((x) => x.id === "png-1-2")!;
  assert.equal(png12.family, "png");
  assert.deepEqual(png12.tools, [{ name: "GIMP", url: "https://www.gimp.org", reads: true, writes: true, via: "png" }]);
  assert.equal(png12.status, "unknown"); // status is not inherited
  const jp2 = out.find((x) => x.id === "jp2-a")!;
  assert.equal(jp2.family, "jpeg-2000");
  assert.equal(jp2.tools![0].via, "jpeg-2000");
  for (const x of out) assert.deepEqual(validate(x), [], x.id);
});

test("family cycles do not loop", () => {
  const out = inheritFromFamily([r({ id: "a", family: "b", tools: [{ name: "A", url: "https://a" }] }), r({ id: "b", family: "a" })]);
  assert.equal(out.find((x) => x.id === "b")!.tools![0].via, "a");
  assert.equal(out.find((x) => x.id === "a")!.tools!.length, 1);
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

test("conversionPaths: cheapest chain first, family of the target counts, no cycles", async () => {
  const { conversionPaths } = await import("../src/index.ts");
  const recs = [
    r({ id: "wpd", conversions: [{ to: "odt", tool: "LibreOffice", fidelity: "partial" }, { to: "txt", tool: "x", fidelity: "lossy" }] }),
    r({ id: "odt", conversions: [{ to: "md", tool: "Pandoc", fidelity: "partial" }, { to: "wpd", tool: "y", fidelity: "lossless" }] }),
    r({ id: "txt", conversions: [{ to: "md", tool: "z", fidelity: "partial" }] }),
    r({ id: "md" }), r({ id: "md-1", family: "md" }),
  ];
  const paths = conversionPaths(recs, "wpd", "md");
  assert.deepEqual(paths[0].steps.map((s) => s.tool), ["LibreOffice", "Pandoc"]); // partial + partial beats lossy + partial
  assert.equal(paths[1].fidelity, "lossy");
  assert.equal(paths.length, 2);
  assert.equal(conversionPaths(recs, "wpd", "md-1")[0].steps.at(-1)!.to, "md"); // the family is fine
  assert.deepEqual(conversionPaths(recs, "md", "wpd"), []);
  assert.equal(conversionPaths(recs, "wpd", "md", { maxSteps: 1 }).length, 0);
});
