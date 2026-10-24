import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, mergeAll, type FormatRecord } from "@openformatdb/core";
import { toRecords, type Spec } from "../src/sources/kaitai.ts";
import { compactRecord } from "../src/lib.ts";

const rec = (id: string, ids: FormatRecord["identifiers"]): FormatRecord => ({ id, name: id, category: "image", status: "unknown", identifiers: ids, updated: "2026-01-01" });

const EXISTING = [
  rec("portable-network-graphics-1-2", { puid: ["fmt/13"] }),
  rec("portable-network-graphics", { wikidata: ["Q178051"] }),
  rec("png-family-pronom", { puid: ["fmt/11", "fmt/12", "fmt/13"] }), // several PUIDs: never a match key
];

const PNG: Spec = { path: "image/png.ksy", meta: { id: "png", title: "PNG (Portable Network Graphics) file", "file-extension": ["png", "apng"], license: "CC0-1.0",
  xref: { pronom: ["fmt/11", "fmt/12", "fmt/13", "fmt/935"], wikidata: ["Q178051", "Q433224"], mime: ["image/png"] } } };
const BOOT: Spec = { path: "executable/android_img.ksy", meta: { id: "android_img", title: "Android Boot Image", "file-extension": "img", license: "CC0-1.0", xref: { wikidata: "Q999999" } } };
const TCP: Spec = { path: "network/tcp_segment.ksy", meta: { id: "tcp_segment", title: "TCP segment", license: "CC0-1.0" } };
const HELPER: Spec = { path: "common/vlq_base128_le.ksy", meta: { id: "vlq_base128_le", license: "CC0-1.0" } };

test("a spec is attached to every record holding one of its ids, with its licence", () => {
  const out = toRecords([PNG], EXISTING, "2026-10-24").map(compactRecord);
  assert.deepEqual(out.map((r) => r.id).sort(), ["portable-network-graphics", "portable-network-graphics-1-2"]);
  for (const r of out) {
    assert.deepEqual(validate(r), [], r.id);
    assert.deepEqual(r.parsers, [{ engine: "kaitai", url: "https://github.com/kaitai-io/kaitai_struct_formats/blob/master/image/png.ksy", license: "CC0-1.0" }]);
    assert.equal(r.status, "partial");
    assert.equal(r.identifiers, undefined); // attached records carry no ids: they merge by id
  }
  const merged = mergeAll([EXISTING, out]).find((r) => r.id === "portable-network-graphics-1-2")!;
  assert.deepEqual(merged.identifiers!.puid, ["fmt/13"]);
  assert.equal(merged.parsers!.length, 1);
});

test("a spec matching nothing becomes its own record; protocols and helpers are skipped", () => {
  const out = toRecords([BOOT, TCP, HELPER], EXISTING, "2026-10-24").map(compactRecord);
  assert.deepEqual(out.map((r) => r.id), ["android-boot-image"]);
  assert.deepEqual(validate(out[0]), []);
  assert.deepEqual(out[0].identifiers, { extensions: ["img"], wikidata: ["Q999999"] });
  assert.equal(out[0].category, "executable");
});
