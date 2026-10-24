// PRONOM (The National Archives, UK): the reference identification registry.
// Source: one JSON file per format in github.com/nationalarchives/pronom (MIT),
// signatures/fmt/<n>.json and signatures/x-fmt/<n>.json. Set PRONOM_DIR to a local
// clone to import without network.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeId, slugify, today, type FormatRecord, type Magic, type Signature } from "@openformatdb/core";
import { clean, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "nationalarchives/pronom";
const BRANCH = "develop";

/** PRONOM formatTypes → our category. The first listed type wins. */
const CATEGORY: Record<string, string> = {
  "audio": "audio",
  "video": "video",
  "image (raster)": "image",
  "image (vector)": "vector-image",
  "text (mark-up)": "markup",
  "text (structured)": "text",
  "text (unstructured)": "text",
  "word processor": "document",
  "page description": "document",
  "spreadsheet": "spreadsheet",
  "presentation": "presentation",
  "database": "database",
  "dataset": "dataset",
  "aggregate": "archive",
  "email": "email",
  "font": "font",
  "gis": "gis",
  "model": "3d",
};

export function category(formatTypes: string | null | undefined): string {
  for (const t of (formatTypes ?? "").split(",")) {
    const c = CATEGORY[t.trim().toLowerCase()];
    if (c) return c;
  }
  return "other";
}

/**
 * The fixed prefix of a PRONOM byte sequence, as our magic hex. PRONOM sequences mix
 * hex with wildcards (`??`), gaps (`*`, `{n-m}`), ranges (`[..]`) and alternatives
 * (`(a|b)`); we keep the literal run from the start (`??` allowed), at least 2 bytes.
 */
export function magicPrefix(seq: string): string | null {
  const m = seq.toLowerCase().replace(/\s+/g, "").match(/^(?:[0-9a-f]{2}|\?\?)+/);
  if (!m) return null;
  const hex = m[0].replace(/(\?\?)+$/, "");
  return hex.length >= 4 ? hex : null;
}

function magics(raw: any): Magic[] {
  const out: Magic[] = [];
  for (const sig of raw.internalSignatures ?? []) {
    for (const b of sig.byteSequences ?? []) {
      if (b.positionType !== "Absolute from BOF") continue;
      const offset = b.offset ?? 0;
      if (b.maxOffset != null && b.maxOffset !== offset) continue; // floating start: not a fixed signature
      const hex = magicPrefix(b.byteSequence ?? "");
      if (hex && !out.some((x) => x.offset === offset && x.hex === hex)) out.push({ offset, hex, ...(clean(sig.name) ? { notes: clean(sig.name) } : {}) });
    }
  }
  return out;
}

const POSITION: Record<string, "bof" | "eof" | "var"> = { "Absolute from BOF": "bof", "Absolute from EOF": "eof", "Variable": "var" };

/** Every internal signature, sequences kept whole (identify checks them all). */
export function signatures(raw: any): Signature[] {
  const out: Signature[] = [];
  for (const sig of raw.internalSignatures ?? []) {
    const sequences = (sig.byteSequences ?? []).flatMap((b: any) => {
      const position = POSITION[b.positionType];
      const pattern = clean(b.byteSequence).toLowerCase().replace(/\s+/g, "");
      if (!position || !pattern) return [];
      const offset = Number.isInteger(b.offset) ? b.offset : 0;
      return [{ position, ...(position !== "var" ? { offset } : {}), ...(position !== "var" && Number.isInteger(b.maxOffset) && b.maxOffset !== offset ? { max_offset: b.maxOffset } : {}), pattern }];
    });
    if (sequences.length) out.push({ ...(clean(sig.name) ? { name: clean(sig.name) } : {}), sequences });
  }
  return out;
}

/** "02 Aug 2005" → "2005-08-02"; unparsable → undefined. */
export function isoDate(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(`${s} UTC`);
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+_-]+$/;
const EXT = /^[a-z0-9_+~-]+(\.[a-z0-9_+~-]+)*$/;

/** One PRONOM JSON record → our record. The id is set later by `assignIds`. */
export function toRecord(raw: any): FormatRecord & { puid: string } {
  const ids = (type: string) => (raw.identifiers ?? []).filter((i: any) => i.identifierType === type).map((i: any) => clean(i.identifierText)).filter(Boolean);
  const puid = ids("PUID")[0];
  const name = clean(raw.formatName);
  const version = clean(raw.version);
  return {
    puid,
    id: makeId(name, version),
    name,
    ...(version ? { version } : {}),
    aliases: clean(raw.formatAliases).split(/\s*,\s*/).filter((a) => a && a !== name),
    category: category(raw.formatTypes),
    identifiers: {
      extensions: (raw.externalSignatures ?? [])
        .filter((e: any) => e.signatureType === "File extension")
        .map((e: any) => clean(e.externalSignature).toLowerCase())
        .filter((e: string) => EXT.test(e)),
      mime: ids("MIME").map((m: string) => m.toLowerCase().split(";")[0].trim()).filter((m: string) => MIME.test(m)),
      puid: [puid],
      wikidata: ids("Wikidata QID Identifier").filter((q: string) => /^Q[0-9]+$/.test(q)),
      loc_fdd: ids("Library of Congress Format Description Identifier").filter((f: string) => /^fdd[0-9]+$/.test(f)),
      uti: ids("Apple Uniform Type Identifier"),
      magic: magics(raw),
      signatures: signatures(raw),
      priority_over: (raw.relationships ?? []).filter((r: any) => r.relationshipType === "Has priority over")
        .map((r: any) => clean(r.relatedFormatPUID)).filter((p: string) => /^(x-)?fmt\/[0-9]+$/.test(p)),
    },
    status: "unknown",
    summary: clean(raw.formatDescription),
    projects: [{ name: `PRONOM ${puid}`, url: `https://www.nationalarchives.gov.uk/PRONOM/${puid}`, kind: "format-doc" }],
    provenance: { sources: ["pronom"] },
    updated: isoDate(raw.lastUpdatedDate) ?? today(),
  };
}

/**
 * Ids from name + version; when several PRONOM records share one, each of them gets
 * its PUID appended (e.g. "-fmt-1234") so no two distinct formats are merged by id.
 */
export function assignIds(records: (FormatRecord & { puid: string })[]): FormatRecord[] {
  const count = new Map<string, number>();
  for (const r of records) count.set(r.id, (count.get(r.id) ?? 0) + 1);
  return records.map(({ puid, ...r }) => (count.get(r.id)! > 1 ? { ...r, id: `${r.id}-${slugify(puid)}` } : r));
}

async function readAll(): Promise<any[]> {
  const dir = process.env.PRONOM_DIR;
  if (dir) {
    return ["fmt", "x-fmt"].flatMap((kind) =>
      readdirSync(join(dir, "signatures", kind)).filter((f) => f.endsWith(".json")).sort()
        .map((f) => JSON.parse(readFileSync(join(dir, "signatures", kind, f), "utf8"))));
  }
  const paths = (await githubFiles(REPO, BRANCH)).filter((p) => /^signatures\/(x-)?fmt\/[^/]+\.json$/.test(p)).sort();
  return mapLimit(paths, 16, async (p) => JSON.parse(await githubRaw(REPO, BRANCH, p)));
}

const source: Source = {
  source: "pronom",
  name: "PRONOM",
  url: "https://github.com/nationalarchives/pronom",
  license: "MIT",
  async fetch() {
    const raws = await readAll();
    if (raws.length < 1000) throw new Error(`only ${raws.length} PRONOM records, expected 2000+`);
    return assignIds(raws.map(toRecord).filter((r) => r.puid));
  },
};

export default source;
