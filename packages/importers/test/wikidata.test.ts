import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, mergeAll } from "@openformatdb/core";
import { toRecords, groupTools } from "../src/sources/wikidata.ts";
import { compactRecord } from "../src/lib.ts";

const u = (q: string) => ({ value: `http://www.wikidata.org/entity/${q}` });
const v = (value: string) => ({ value });

// SPARQL rows as query.wikidata.org returns them: one row per combination of values.
const FORMATS = [
  { uri: u("Q178051"), uriLabel: v("Portable Network Graphics"), desc: v("raster graphics file format"), puid: v("fmt/13"), extension: v("png"), mimetype: v("image/png"), ffw: v("PNG"), lcfdd: v("fdd000153"), sig: v("89 50 4E 47 0D 0A 1A 0A"), encodingLabel: v("hexadecimal"), relativityLabel: v("beginning of file"), offset: v("0") },
  { uri: u("Q178051"), uriLabel: v("Portable Network Graphics"), desc: v("raster graphics file format"), puid: v("fmt/13"), extension: v(".PNG"), mimetype: v("image/png") },
  { uri: u("Q1"), uriLabel: v("Data file"), extension: v("dat"), sig: v("DAT"), encodingLabel: v("ASCII") },
  { uri: u("Q2"), uriLabel: v("Data file"), extension: v("dat"), sig: v("0000"), relativityLabel: v("end of file") },
];
const READS = [
  { item: u("Q10"), itemLabel: v("GIMP"), website: v("https://www.gimp.org"), licenseLabel: v("GNU General Public License, version 3.0 or later"), format: u("Q178051") },
  { item: u("Q11"), itemLabel: v("Photoshop"), licenseLabel: v("proprietary license"), format: u("Q178051") },
  { item: u("Q12"), itemLabel: v("Q12"), format: u("Q999") }, // format not in the format query
];
const WRITES = [
  { item: u("Q10"), itemLabel: v("GIMP"), website: v("https://www.gimp.org"), licenseLabel: v("GNU General Public License, version 3.0 or later"), format: u("Q178051") },
];

test("rows are grouped into one valid record per item", () => {
  const recs = toRecords(FORMATS, READS, WRITES, "2026-10-20").map(compactRecord);
  for (const r of recs) assert.deepEqual(validate(r), [], r.id);
  const png = recs.find((r) => r.identifiers?.wikidata?.[0] === "Q178051")!;
  assert.equal(png.id, "portable-network-graphics");
  assert.equal(png.category, "image");
  assert.equal(png.summary, "raster graphics file format");
  assert.deepEqual(png.identifiers, {
    extensions: ["png"], mime: ["image/png"], puid: ["fmt/13"], wikidata: ["Q178051"], loc_fdd: ["fdd000153"],
    magic: [{ offset: 0, hex: "89504e470d0a1a0a" }],
  });
  assert.equal(png.status, "writable"); // GIMP, GPL, writes it
  assert.ok(png.projects!.some((p) => p.url === "http://fileformats.archiveteam.org/wiki/PNG"));
});

test("a label shared by two items gets the QID appended; ASCII and end-of-file signatures are skipped", () => {
  const recs = toRecords(FORMATS, [], [], "2026-10-20").map(compactRecord);
  const dat = recs.filter((r) => r.name === "Data file");
  assert.deepEqual(dat.map((r) => r.id).sort(), ["data-file-q1", "data-file-q2"]);
  assert.ok(dat.every((r) => !r.identifiers?.magic));
  assert.ok(dat.every((r) => r.status === "unknown"));
});

test("tools: reads and writes combined, open source only from a known licence, Wikidata page as fallback url", () => {
  const tools = groupTools(READS, WRITES).get("Q178051")!;
  assert.deepEqual(tools, [
    { name: "GIMP", url: "https://www.gimp.org", reads: true, writes: true, license: "GNU General Public License, version 3.0 or later", open_source: true },
    { name: "Photoshop", url: "https://www.wikidata.org/wiki/Q11", reads: true, writes: false, license: "proprietary license" },
  ]);
});

test("a Wikidata item merges with the PRONOM record holding the same single PUID", () => {
  const wd = toRecords(FORMATS, READS, WRITES, "2026-10-20").map(compactRecord);
  const pronom = { id: "portable-network-graphics-1-2", name: "Portable Network Graphics", version: "1.2", category: "image", status: "unknown" as const,
    identifiers: { puid: ["fmt/13"], extensions: ["png"] }, provenance: { sources: ["pronom"] }, updated: "2005-08-02" };
  const merged = mergeAll([[pronom], wd]).find((r) => r.identifiers?.puid?.includes("fmt/13"))!;
  assert.equal(merged.id, "portable-network-graphics-1-2");
  assert.equal(merged.status, "writable");
  assert.deepEqual(merged.provenance!.sources, ["pronom", "wikidata"]);
  assert.equal(merged.tools!.length, 2);
});
