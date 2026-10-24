import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@openformatdb/core";
import { toRecord, assignIds, magicPrefix, category, isoDate } from "../src/sources/pronom.ts";
import { compactRecord, finalize } from "../src/lib.ts";

// Trimmed copy of signatures/fmt/13.json from github.com/nationalarchives/pronom (MIT).
const PNG = {
  formatName: "Portable Network Graphics",
  version: "1.2",
  formatDescription: "Portable Network Graphics (PNG) was designed for the lossless,  portable, compressed storage of raster images.",
  lastUpdatedDate: "02 Aug 2005",
  formatAliases: "PNG (1.2)",
  formatTypes: "Image (Raster)",
  identifiers: [
    { identifierText: "fmt/13", identifierType: "PUID" },
    { identifierText: "image/png", identifierType: "MIME" },
    { identifierText: "public.png", identifierType: "Apple Uniform Type Identifier" },
  ],
  internalSignatures: [{
    name: "PNG 1.2",
    byteSequences: [
      { positionType: "Absolute from BOF", offset: 0, maxOffset: null, byteSequence: "89504E470D0A1A0A0000000D49484452*69545874" },
      { positionType: "Absolute from EOF", offset: 0, maxOffset: null, byteSequence: "0000000049454E44AE426082" },
    ],
  }],
  externalSignatures: [{ externalSignature: "png", signatureType: "File extension" }],
};

test("magicPrefix keeps the literal run from the start", () => {
  assert.equal(magicPrefix("89504E470D0A1A0A0000000D49484452*69545874"), "89504e470d0a1a0a0000000d49484452");
  assert.equal(magicPrefix("4D4D??2A{4}"), "4d4d??2a");
  assert.equal(magicPrefix("FF??"), null); // one byte only
  assert.equal(magicPrefix("[00:7F]1234"), null);
  assert.equal(magicPrefix("(FFD8|FFD9)"), null);
});

test("category and dates", () => {
  assert.equal(category("Image (Raster)"), "image");
  assert.equal(category("Unknown, Audio"), "audio");
  assert.equal(category(null), "other");
  assert.equal(isoDate("02 Aug 2005"), "2005-08-02");
  assert.equal(isoDate("someday"), undefined);
});

test("PNG record maps to a valid format record", () => {
  const [rec] = assignIds([toRecord(PNG)]);
  const r = compactRecord(rec);
  assert.deepEqual(validate(r), []);
  assert.equal(r.id, "portable-network-graphics-1-2");
  assert.equal(r.version, "1.2");
  assert.equal(r.category, "image");
  assert.deepEqual(r.aliases, ["PNG (1.2)"]);
  assert.deepEqual(r.identifiers, {
    extensions: ["png"], mime: ["image/png"], puid: ["fmt/13"], uti: ["public.png"],
    magic: [{ offset: 0, hex: "89504e470d0a1a0a0000000d49484452", notes: "PNG 1.2" }],
    signatures: [{ name: "PNG 1.2", sequences: [
      { position: "bof", offset: 0, pattern: "89504e470d0a1a0a0000000d49484452*69545874" },
      { position: "eof", offset: 0, pattern: "0000000049454e44ae426082" },
    ] }],
  });
  assert.equal(r.summary, "Portable Network Graphics (PNG) was designed for the lossless, portable, compressed storage of raster images.");
  assert.equal(r.updated, "2005-08-02");
});

test("MIME parameters are dropped and invalid extensions skipped", () => {
  const r = toRecord({ ...PNG, identifiers: [...PNG.identifiers, { identifierText: "image/cgm; version=1", identifierType: "MIME" }],
    externalSignatures: [{ externalSignature: "qxp report", signatureType: "File extension" }] });
  assert.deepEqual(r.identifiers!.mime, ["image/png", "image/cgm"]);
  assert.deepEqual(r.identifiers!.extensions, []);
});

test("records sharing a name and version get their PUID appended, nothing is merged", () => {
  const a = toRecord({ ...PNG, identifiers: [{ identifierText: "fmt/1", identifierType: "PUID" }] });
  const b = toRecord({ ...PNG, identifiers: [{ identifierText: "x-fmt/2", identifierType: "PUID" }] });
  const c = toRecord({ ...PNG, version: "1.0", identifiers: [{ identifierText: "fmt/11", identifierType: "PUID" }] });
  const ids = assignIds([a, b, c]).map((r) => r.id);
  assert.deepEqual(ids, ["portable-network-graphics-1-2-fmt-1", "portable-network-graphics-1-2-x-fmt-2", "portable-network-graphics-1-0"]);
  assert.equal(finalize(assignIds([a, b, c])).merged, 0);
});
