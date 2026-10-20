// Wikidata (CC0): the identifier hub (QID ↔ PUID ↔ LoC FDD ↔ File Formats Wiki) and the
// only large open source of "software X reads/writes format Y" (P1072/P1073).
// Three SPARQL queries on query.wikidata.org; the format query follows the one Siegfried
// and digipres.org use (by Ross Spencer). Set WIKIDATA_DIR to a folder holding the raw
// SPARQL JSON results (formats.json, reads.json, writes.json) to import without network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeId, today, type FormatRecord, type Magic, type Tool } from "@openformatdb/core";
import { clean, fetchJson, type Source } from "../lib.ts";

const ENDPOINT = "https://query.wikidata.org/sparql";

export const FORMATS_QUERY = `
SELECT DISTINCT ?uri ?uriLabel ?desc ?parent ?puid ?extension ?mimetype ?ffw ?lcfdd ?sig ?encodingLabel ?relativityLabel ?offset
WHERE {
  { ?uri wdt:P31/wdt:P279* wd:Q235557 } UNION { ?uri wdt:P31/wdt:P279* wd:Q26085352 }.
  FILTER EXISTS { ?uri wdt:P2748|wdt:P1195|wdt:P1163|wdt:P3266 [] }.
  OPTIONAL { ?uri wdt:P2748 ?puid. }
  OPTIONAL { ?uri wdt:P1195 ?extension. }
  OPTIONAL { ?uri wdt:P1163 ?mimetype. }
  OPTIONAL { ?uri wdt:P3381 ?ffw. }
  OPTIONAL { ?uri wdt:P279|wdt:P361 ?parent. }  # subclass of / part of: a version points to its format
  OPTIONAL { ?uri wdt:P3266 ?lcfdd. }
  OPTIONAL { ?uri schema:description ?desc. FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?uri p:P4152 ?object.
    OPTIONAL { ?object ps:P4152 ?sig. }
    OPTIONAL { ?object pq:P3294 ?encoding. }
    OPTIONAL { ?object pq:P2210 ?relativity. }
    OPTIONAL { ?object pq:P4153 ?offset. }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

const softwareQuery = (prop: string) => `
SELECT DISTINCT ?item ?itemLabel ?website ?licenseLabel ?format
WHERE {
  ?item wdt:${prop} ?format.
  OPTIONAL { ?item wdt:P856 ?website. }
  OPTIONAL { ?item wdt:P275 ?license. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

type Binding = Record<string, { value: string } | undefined>;

const qid = (uri: string | undefined) => uri?.match(/Q[0-9]+$/)?.[0];
const val = (b: Binding, k: string) => clean(b[k]?.value);

/** Licences we count as open source when Wikidata names them (P275). Anything else stays unset. */
const FOSS = /\b((a|l)?gpl(v?[0-9.]+)?|gnu (affero |lesser )?general public|mit|expat|bsd|apache|mpl|mozilla public|eclipse public|isc|zlib|artistic|unlicense|cc0|public domain|eupl|cecill|boost software|historical permission notice|imagemagick license|python software foundation|openssl|sil open font|gnu library general public|common public license|libpng license|libtiff license|matplotlib license|wtfpl|open-source license|public-domain software|x11 license|zope public|ncsa open source|info-zip license|ibm public license|european union public licen[cs]e|academic free license|nasa open source)\b/i;

/** MIME top-level type → category, for formats PRONOM does not know. */
function category(mime: string[]): string {
  const top: Record<string, string> = { image: "image", audio: "audio", video: "video", font: "font", text: "text", model: "3d" };
  for (const m of mime) if (top[m.split("/")[0]]) return top[m.split("/")[0]];
  return "other";
}

const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+_-]+$/;
const EXT = /^[a-z0-9_+~-]+(\.[a-z0-9_+~-]+)*$/;

/** A Wikidata signature as our magic, when it is hex at a fixed offset from the start. */
function magic(b: Binding): Magic | null {
  const enc = val(b, "encodingLabel").toLowerCase();
  const rel = val(b, "relativityLabel").toLowerCase();
  if (enc && enc !== "hexadecimal") return null;
  if (rel && !/beginning|start/.test(rel)) return null;
  const hex = val(b, "sig").toLowerCase().replace(/\s+/g, "");
  const offset = Number(val(b, "offset") || 0);
  if (!/^([0-9a-f]{2}|\?\?)+$/.test(hex) || hex.length < 4 || !Number.isInteger(offset) || offset < 0) return null;
  return { offset, hex };
}

interface Acc { name: string; desc: string; puid: Set<string>; ext: Set<string>; mime: Set<string>; fdd: Set<string>; ffw: Set<string>; parent: Set<string>; magic: Map<string, Magic> }

/** Format query rows (one per combination of values) → one accumulator per QID. */
export function groupFormats(rows: Binding[]): Map<string, Acc> {
  const out = new Map<string, Acc>();
  for (const b of rows) {
    const q = qid(b.uri?.value);
    if (!q) continue;
    let a = out.get(q);
    if (!a) out.set(q, (a = { name: val(b, "uriLabel") || q, desc: val(b, "desc"), puid: new Set(), ext: new Set(), mime: new Set(), fdd: new Set(), ffw: new Set(), parent: new Set(), magic: new Map() }));
    const puid = val(b, "puid");
    if (/^(x-)?fmt\/[0-9]+$/.test(puid)) a.puid.add(puid);
    const ext = val(b, "extension").toLowerCase().replace(/^\./, "");
    if (EXT.test(ext)) a.ext.add(ext);
    const mime = val(b, "mimetype").toLowerCase().split(";")[0].trim();
    if (MIME.test(mime)) a.mime.add(mime);
    const fdd = val(b, "lcfdd");
    if (/^fdd[0-9]+$/.test(fdd)) a.fdd.add(fdd);
    if (val(b, "ffw")) a.ffw.add(val(b, "ffw"));
    const parent = qid(b.parent?.value);
    if (parent && parent !== q) a.parent.add(parent);
    const m = magic(b);
    if (m) a.magic.set(`${m.offset}:${m.hex}`, m);
  }
  return out;
}

/** Software query rows → tools per format QID, one entry per software, reads/writes combined. */
export function groupTools(reads: Binding[], writes: Binding[]): Map<string, Tool[]> {
  const byPair = new Map<string, { format: string; tool: Tool; licenses: Set<string> }>();
  const add = (rows: Binding[], mode: "reads" | "writes") => {
    for (const b of rows) {
      const format = qid(b.format?.value), item = qid(b.item?.value);
      if (!format || !item) continue;
      const key = `${format}|${item}`;
      let e = byPair.get(key);
      if (!e) {
        const website = val(b, "website");
        const url = /^https?:\/\//.test(website) ? website : `https://www.wikidata.org/wiki/${item}`;
        byPair.set(key, (e = { format, tool: { name: val(b, "itemLabel") || item, url, reads: false, writes: false }, licenses: new Set() }));
      }
      e.tool[mode] = true;
      const lic = val(b, "licenseLabel");
      if (lic && !/^Q[0-9]+$|^https?:/.test(lic)) e.licenses.add(lic); // QID or blank node: no English label
    }
  };
  add(reads, "reads");
  add(writes, "writes");
  const out = new Map<string, Tool[]>();
  for (const { format, tool, licenses } of byPair.values()) {
    const lic = [...licenses].sort();
    const t: Tool = { ...tool, ...(lic.length ? { license: lic.join(" / ") } : {}), ...(lic.some((l) => FOSS.test(l)) ? { open_source: true } : {}) };
    (out.get(format) ?? out.set(format, []).get(format)!).push(t);
  }
  for (const tools of out.values()) tools.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * The family of a version item: a parent (subclass of / part of) that is itself a format
 * here and shares an extension or MIME type with it, so genre classes ("raster graphics
 * format") are not taken as families. Several candidates: the first by id.
 */
function familyOf(a: Acc, accs: Map<string, Acc>, idOf: Map<string, string>): string | undefined {
  const shares = (p: Acc) => [...a.ext].some((e) => p.ext.has(e)) || [...a.mime].some((m) => p.mime.has(m));
  return [...a.parent].filter((q) => accs.has(q) && shares(accs.get(q)!)).map((q) => idOf.get(q)!).sort()[0];
}

/** Records from the three query results. Ids from the label; a label shared by several items gets its QID appended. */
export function toRecords(formats: Binding[], reads: Binding[], writes: Binding[], on = today()): FormatRecord[] {
  const accs = groupFormats(formats);
  const tools = groupTools(reads, writes);
  const count = new Map<string, number>();
  for (const a of accs.values()) count.set(makeId(a.name), (count.get(makeId(a.name)) ?? 0) + 1);
  const idOf = new Map([...accs].map(([q, a]) => {
    const base = makeId(a.name);
    return [q, count.get(base)! > 1 || base === "x" ? `${base}-${q.toLowerCase()}` : base];
  }));
  return [...accs].map(([q, a]) => {
    const ts = tools.get(q) ?? [];
    const open = ts.filter((t) => t.open_source);
    const mime = [...a.mime].sort();
    const family = familyOf(a, accs, idOf);
    return {
      id: idOf.get(q)!,
      name: a.name,
      ...(family ? { family } : {}),
      category: category(mime),
      identifiers: {
        extensions: [...a.ext].sort(),
        mime,
        puid: [...a.puid].sort(),
        wikidata: [q],
        loc_fdd: [...a.fdd].sort(),
        magic: [...a.magic.values()],
      },
      // Open-source software that Wikidata says writes (or reads) it: the format is open to code.
      status: open.some((t) => t.writes) ? "writable" : open.some((t) => t.reads) ? "readable" : "unknown",
      summary: a.desc,
      tools: ts,
      projects: [
        { name: `Wikidata ${q}`, url: `https://www.wikidata.org/wiki/${q}`, kind: "wiki" },
        ...[...a.ffw].map((p) => ({ name: "File Formats Wiki", url: `http://fileformats.archiveteam.org/wiki/${encodeURIComponent(p.replace(/ /g, "_"))}`, kind: "wiki" })),
      ],
      provenance: { sources: ["wikidata"] },
      updated: on,
    } satisfies FormatRecord;
  });
}

async function query(sparql: string): Promise<Binding[]> {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`;
  const data = await fetchJson(url, { headers: { accept: "application/sparql-results+json" } });
  return data.results.bindings;
}

async function readAll(): Promise<[Binding[], Binding[], Binding[]]> {
  const dir = process.env.WIKIDATA_DIR;
  if (dir) {
    const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")).results.bindings as Binding[];
    return [load("formats.json"), load("reads.json"), load("writes.json")];
  }
  // One query at a time: the public endpoint limits concurrent queries per client.
  const formats = await query(FORMATS_QUERY);
  const reads = await query(softwareQuery("P1072"));
  const writes = await query(softwareQuery("P1073"));
  return [formats, reads, writes];
}

const source: Source = {
  source: "wikidata",
  name: "Wikidata",
  url: "https://www.wikidata.org/wiki/Wikidata:WikiProject_Informatics/File_formats",
  license: "CC0-1.0",
  async fetch() {
    const [formats, reads, writes] = await readAll();
    const records = toRecords(formats, reads, writes);
    if (records.length < 2000) throw new Error(`only ${records.length} Wikidata formats, expected 10000+`);
    return records;
  },
};

export default source;
