import { test } from "node:test";
import assert from "node:assert/strict";
import type { EngineInfo } from "@openformatdb/engines";
import type { FormatRecord } from "@openformatdb/core";
import { resolver } from "../src/sources/converters.ts";
import { toRecords } from "../src/sources/engines.ts";

const rec = (id: string, category: string, extensions: string[], tools = 0): FormatRecord =>
  ({ id, name: id, category, status: "unknown", identifiers: { extensions }, tools: Array.from({ length: tools }, (_, i) => ({ name: `t${i}` })), provenance: { sources: ["test"] }, updated: "2026-10-25" }) as FormatRecord;

const engine: EngineInfo = {
  id: "toy", name: "Toy (WebAssembly)", url: "https://example.org", license: "MIT", package: { name: "toy", version: "1.0.0" }, assets: [],
  formats: [
    { ext: "aa", label: "AA", category: "image", read: true, write: true, kind: "x" },
    { ext: "bb", label: "BB", category: "image", read: true, write: true, kind: "y", id: "bb-exact" },
    { ext: "cc", label: "CC", category: "image", read: true, kind: "x" },
  ],
  targets: ["aa", "bb"],
  pairs: (from, to) => !(from.kind === "y" && to.ext === "aa"),
  fidelity: () => ({ fidelity: "lossless" }),
};

test("engines source: conversions carry the engine, pairs and id hints are honoured", () => {
  const records = [rec("aa-format", "image", ["aa"], 3), rec("bb-wrong", "image", ["bb"], 9), rec("bb-exact", "image", ["bb"]), rec("cc-format", "image", ["cc"])];
  const out = toRecords([engine], resolver(records), "2026-10-25", new Map(records.map((r) => [r.id, r])));
  const by = new Map(out.map((r) => [r.id, r]));
  assert.ok(!by.has("bb-wrong"), "the id hint wins over the most handled record");
  assert.deepEqual(by.get("cc-format")!.conversions!.map((c) => [c.to, c.engine]).sort(), [["aa-format", "toy"], ["bb-exact", "toy"]]);
  assert.deepEqual(by.get("bb-exact")!.conversions, [], "pairs() forbids bb → aa");
  assert.equal(by.get("aa-format")!.status, "writable");
  assert.equal(by.get("cc-format")!.status, "readable");
  assert.equal(by.get("aa-format")!.conversions![0].url, "https://openformatdb.org/convert/");
});
