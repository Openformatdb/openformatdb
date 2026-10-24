import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, mergeAll } from "@openformatdb/core";
import { toRecord, assignIds, plain, pageUrl } from "../src/sources/ffw.ts";
import { compactRecord } from "../src/lib.ts";

// Shaped like fileformats.archiveteam.org/wiki/PNG (trimmed).
const PNG = `{{FormatInfo
|formattype=electronic
|subcat=Graphics
|extensions={{ext|png}}
|mimetypes={{mimetype|image/png}}
|pronom={{PRONOM|fmt/11}}, {{PRONOM|fmt/12}}, {{PRONOM|fmt/13}}
|wikidata={{wikidata|Q178051}}
|LoCFDD={{LoCFDD|fdd000153}}
|released=1996
}}
'''PNG''' (Portable Network Graphics) is a [[lossless]] raster image format, designed to replace [[GIF]].<ref>RFC 2083</ref>

== Identification ==
Files start with {{magic|89 50 4E 47 0D 0A 1A 0A}}, then an {{magic|IHDR}} chunk.

== Specifications ==
* [https://www.w3.org/TR/png-3/ PNG Specification (Third Edition)]

== Software ==
* [https://www.libpng.org/pub/png/libpng.html libpng]
* [[GIMP]]

[[Category:Graphics]]
`;

test("a format page maps to a valid record", () => {
  const r = compactRecord(toRecord("PNG", PNG, "2026-10-24")!);
  assert.deepEqual(validate(r), []);
  assert.equal(r.id, "png");
  assert.equal(r.category, "image");
  assert.deepEqual(r.identifiers, {
    extensions: ["png"], mime: ["image/png"], puid: ["fmt/11", "fmt/12", "fmt/13"], wikidata: ["Q178051"], loc_fdd: ["fdd000153"],
    magic: [{ offset: 0, hex: "89504e470d0a1a0a", notes: "File Formats Wiki" }],
  });
  assert.equal(r.summary, "PNG (Portable Network Graphics) is a lossless raster image format, designed to replace GIF.");
  assert.deepEqual(r.tools, [{ name: "libpng", url: "https://www.libpng.org/pub/png/libpng.html" }]);
  assert.deepEqual(r.projects!.map((p) => p.kind), ["wiki", "format-doc"]);
  assert.equal(r.projects![0].url, "http://fileformats.archiveteam.org/wiki/PNG");
});

test("pages without identifiers and redirects are skipped; ids are unique", () => {
  assert.equal(toRecord("Graphics", "{{FormatInfo|subcat=Graphics}}\nOverview of image formats.", "2026-10-24"), null);
  assert.equal(toRecord("Png", "#REDIRECT [[PNG]]", "2026-10-24"), null);
  const a = toRecord("ZIP", "{{FormatInfo|subcat=Archiving}} {{ext|zip}}")!, b = toRecord("Zip", "{{FormatInfo}} {{ext|zip}}")!;
  assert.deepEqual(assignIds([a, b]).map((r) => r.id), ["zip", "zip-2"]);
  assert.equal(a.category, "archive");
});

test("the wiki record merges into the Wikidata one by its single QID", () => {
  const ffw = compactRecord(toRecord("PNG", PNG, "2026-10-24")!);
  const wd = { id: "portable-network-graphics", name: "Portable Network Graphics", category: "image", status: "writable" as const,
    identifiers: { wikidata: ["Q178051"] }, provenance: { sources: ["wikidata"] }, updated: "2026-10-20" };
  const out = mergeAll([[wd], [ffw]]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].provenance!.sources, ["wikidata", "ffw"]);
});

test("plain text and page urls", () => {
  assert.equal(plain("A [[Foo|bar]] and [https://x.org link] {{tmpl|{{inner}}}} '''bold'''"), "A bar and link bold");
  assert.equal(pageUrl("Microsoft Word (DOC)"), "http://fileformats.archiveteam.org/wiki/Microsoft_Word_(DOC)");
});
