// Kaitai Struct format gallery (github.com/kaitai-io/kaitai_struct_formats): machine-readable
// grammars (.ksy) that compile to parsers in a dozen languages. Each spec's meta.xref names the
// PRONOM ids, Wikidata items, LoC id and MIME types it covers, so the grammar is attached to the
// records already holding those ids; a spec matching none becomes a record of its own. Licence
// is per file (meta.license) and kept on each parser entry. Set KAITAI_DIR to a local clone to
// import without network.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import YAML from "yaml";
import { loadCurated, loadSnapshots, mergeAll, linkFamilies, makeId, today, type FormatRecord } from "@openformatdb/core";
import { clean, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "kaitai-io/kaitai_struct_formats";
const BRANCH = "master";
const BLOB = `https://github.com/${REPO}/blob/${BRANCH}/`;

/** Gallery folders that hold file formats; network protocols and shared helper types are left out. */
const CATEGORY: Record<string, string> = {
  "3d": "3d", archive: "archive", cad: "cad", database: "database", executable: "executable", filesystem: "filesystem",
  firmware: "firmware", font: "font", game: "game", geospatial: "gis", image: "image", log: "text", machine_code: "executable",
  media: "other", scientific: "scientific", serialization: "dataset", windows: "other", macos: "other", hardware: "other", security: "other",
};

export interface Spec { path: string; meta: any }

const list = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => clean(x)).filter(Boolean);

const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+_-]+$/;
const EXT = /^[a-z0-9_+~-]+(\.[a-z0-9_+~-]+)*$/;

/** Category: the folder, refined by the MIME type for media (audio or video). */
function category(spec: Spec): string {
  const dir = spec.path.split("/")[0];
  const mime = list(spec.meta.xref?.mime);
  if (dir === "media") return mime.some((m) => m.startsWith("audio/")) ? "audio" : mime.some((m) => m.startsWith("video/")) ? "video" : "other";
  return CATEGORY[dir] ?? "other";
}

/**
 * Records for the specs. A spec is attached to every existing record holding exactly one of the
 * PUIDs or QIDs it names (a PNG grammar covers PNG 1.0, 1.1, 1.2, APNG and the PNG family);
 * otherwise it becomes a record of its own, from its title, extensions and identifiers.
 */
export function toRecords(specs: Spec[], existing: FormatRecord[], on = today()): FormatRecord[] {
  const byKey = new Map<string, FormatRecord[]>();
  for (const r of existing) {
    for (const k of ["puid", "wikidata"] as const) {
      const v = r.identifiers?.[k] ?? [];
      if (v.length === 1) byKey.set(`${k}:${v[0]}`, [...(byKey.get(`${k}:${v[0]}`) ?? []), r]);
    }
  }
  const out = new Map<string, FormatRecord>();
  for (const spec of specs) {
    const m = spec.meta;
    const dir = spec.path.split("/")[0];
    if (!(dir in CATEGORY) || !m?.id) continue;
    const xref = m.xref ?? {};
    const puid = list(xref.pronom).filter((p) => /^(x-)?fmt\/[0-9]+$/.test(p));
    const wikidata = list(xref.wikidata).filter((q) => /^Q[0-9]+$/.test(q));
    const extensions = list(m["file-extension"]).map((e) => e.toLowerCase()).filter((e) => EXT.test(e));
    if (!puid.length && !wikidata.length && !extensions.length) continue;
    const parser = { engine: "kaitai", url: BLOB + spec.path, ...(clean(m.license) ? { license: clean(m.license) } : {}) };
    const project = { name: `Kaitai Struct: ${m.id}`, url: `https://formats.kaitai.io/${m.id}/`, kind: "grammar", ...(clean(m.license) ? { license: clean(m.license) } : {}) };
    const targets = new Map<string, FormatRecord>();
    for (const p of puid) for (const r of byKey.get(`puid:${p}`) ?? []) targets.set(r.id, r);
    for (const q of wikidata) for (const r of byKey.get(`wikidata:${q}`) ?? []) targets.set(r.id, r);
    const add = (base: Pick<FormatRecord, "id" | "name" | "version" | "category">, extra: Partial<FormatRecord> = {}) => {
      const prev = out.get(base.id);
      if (prev) { prev.parsers!.push(parser); prev.projects!.push(project); return; }
      out.set(base.id, {
        id: base.id, name: base.name, ...(base.version ? { version: base.version } : {}), category: base.category,
        ...extra, status: "partial", parsers: [parser], projects: [project], provenance: { sources: ["kaitai"] }, updated: on,
      });
    };
    if (targets.size) for (const r of targets.values()) add(r);
    else {
      const loc = list(xref.loc).filter((f) => /^fdd[0-9]+$/.test(f));
      const mime = list(xref.mime).map((x) => x.toLowerCase()).filter((x) => MIME.test(x));
      add({ id: makeId(clean(m.title) || m.id), name: clean(m.title) || m.id, category: category(spec) }, {
        identifiers: { extensions, mime, puid, wikidata, loc_fdd: loc },
        ...(clean(m["doc"]) ? { summary: clean(m.doc).slice(0, 1000) } : {}),
      });
    }
  }
  return [...out.values()];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : n.endsWith(".ksy") ? [p] : [];
  });
}

async function readAll(): Promise<Spec[]> {
  const parse = (path: string, text: string): Spec | null => {
    try { return { path, meta: YAML.parse(text)?.meta }; } catch { return null; }
  };
  const dir = process.env.KAITAI_DIR;
  if (dir) return walk(dir).sort().map((f) => parse(relative(dir, f), readFileSync(f, "utf8"))).filter((s): s is Spec => !!s);
  const paths = (await githubFiles(REPO, BRANCH)).filter((p) => p.endsWith(".ksy") && !p.startsWith("_")).sort();
  return (await mapLimit(paths, 16, async (p) => parse(p, await githubRaw(REPO, BRANCH, p)))).filter((s): s is Spec => !!s);
}

const source: Source = {
  source: "kaitai",
  name: "Kaitai Struct format gallery",
  url: "https://formats.kaitai.io",
  license: "per file (meta.license; mostly CC0-1.0)",
  async fetch() {
    const specs = await readAll();
    if (specs.length < 100) throw new Error(`only ${specs.length} Kaitai specs, expected 150+`);
    // Attach to every other source, never to our own previous snapshot.
    const existing = linkFamilies(mergeAll([loadCurated().map((c) => c.record), ...loadSnapshots().filter((s) => s.source !== "kaitai" && s.source !== "converters").map((s) => s.records)]));
    return toRecords(specs, existing);
  },
};

export default source;
