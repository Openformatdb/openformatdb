// A throwaway fake repository: schema/ copied from the real one, two snapshots.
import { mkdtempSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, type FormatRecord } from "@openformatdb/core";

const GIMP = { name: "GIMP", url: "https://www.gimp.org", license: "GPL-3.0-or-later", open_source: true, reads: true, writes: true };
const PHOTOSHOP = { name: "Photoshop", url: "https://www.wikidata.org/wiki/Q11", license: "proprietary license", reads: true, writes: true };

export const PRONOM: FormatRecord[] = [
  { id: "portable-network-graphics-1-2", name: "Portable Network Graphics", version: "1.2", category: "image", status: "unknown",
    identifiers: { extensions: ["png"], mime: ["image/png"], puid: ["fmt/13"], magic: [{ offset: 0, hex: "89504e470d0a1a0a0000000d49484452" }] },
    provenance: { sources: ["pronom"] }, updated: "2005-08-02" },
  { id: "jpeg-file-interchange-format-1-01", name: "JPEG File Interchange Format", version: "1.01", category: "image", status: "unknown",
    identifiers: { extensions: ["jpg", "jpeg"], mime: ["image/jpeg"], puid: ["fmt/43"], magic: [{ offset: 0, hex: "ffd8ffe0????4a464946000101" }] },
    provenance: { sources: ["pronom"] }, updated: "2005-08-02" },
  { id: "acme-data-file", name: "Acme Data File", category: "dataset", status: "unknown",
    identifiers: { extensions: ["dat"], puid: ["fmt/9999"] }, provenance: { sources: ["pronom"] }, updated: "2020-01-01" },
];

export const WIKIDATA: FormatRecord[] = [
  { id: "portable-network-graphics", name: "Portable Network Graphics", category: "image", status: "writable",
    identifiers: { extensions: ["png"], mime: ["image/png"], wikidata: ["Q178051"] }, tools: [PHOTOSHOP, GIMP],
    provenance: { sources: ["wikidata"] }, updated: "2026-10-20" },
  { id: "portable-network-graphics-version-1-2", name: "Portable Network Graphics, Version 1.2", family: "portable-network-graphics", category: "image", status: "unknown",
    identifiers: { extensions: ["png"], puid: ["fmt/13"], wikidata: ["Q27229642"] }, provenance: { sources: ["wikidata"] }, updated: "2026-10-20" },
];

export function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "ofdb-mcp-test-"));
  cpSync(join(REPO_ROOT, "schema"), join(root, "schema"), { recursive: true });
  mkdirSync(join(root, "data/imported"), { recursive: true });
  const snap = (source: string, name: string, license: string, records: FormatRecord[]) =>
    writeFileSync(join(root, `data/imported/${source}.json`), JSON.stringify({ source, name, url: `https://example.org/${source}`, license, fetched_at: "2026-10-20T00:00:00Z", records }));
  snap("pronom", "PRONOM", "MIT", PRONOM);
  snap("wikidata", "Wikidata", "CC0-1.0", WIKIDATA);
  return root;
}
