// OpenFormatDB core: load, validate and merge format records.
// Shared by the site, the MCP server and the importers. See SPEC.md.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import SCHEMA_JSON from "../../../schema/format.schema.json" with { type: "json" };
import { statusRank, mergeKeys, type FormatRecord, type Identifiers, type Snapshot } from "./browser.ts";

export * from "./browser.ts";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SCHEMA_PATH = join(REPO_ROOT, "schema/format.schema.json");
/** The normative record schema, imported so bundles (npm package, site) carry it. */
export const SCHEMA: any = SCHEMA_JSON;

// ---------- validation ----------

let validator: ((r: unknown) => boolean) & { errors?: any[] | null } | undefined;

export function validate(record: unknown): string[] {
  if (!validator) {
    const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
    (addFormats as any)(ajv);
    validator = ajv.compile(SCHEMA);
  }
  if (validator!(record)) return [];
  return (validator!.errors ?? []).map((e: any) => `${e.instancePath || "/"} ${e.message}${e.params?.allowedValues ? " " + JSON.stringify(e.params.allowedValues) : ""}`);
}

// ---------- loading ----------

function walk(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

/** YAML parses bare dates as Date objects; the schema wants ISO strings. */
function normalizeDates(v: any): any {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(normalizeDates);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeDates(x)]));
  return v;
}

export function parseRecordYaml(text: string): FormatRecord {
  return normalizeDates(YAML.parse(text));
}

export function stringifyRecordYaml(record: FormatRecord): string {
  return YAML.stringify(record, { lineWidth: 100 });
}

export function curatedPath(id: string, root = REPO_ROOT): string {
  return join(root, "data/formats", `${id}.yaml`);
}

export function loadCurated(root = REPO_ROOT): { file: string; record: FormatRecord }[] {
  return walk(join(root, "data/formats"), ".yaml").map((file) => ({
    file: relative(root, file),
    record: parseRecordYaml(readFileSync(file, "utf8")),
  }));
}

export function loadSnapshots(root = REPO_ROOT): Snapshot[] {
  return walk(join(root, "data/imported"), ".json").map((f) => JSON.parse(readFileSync(f, "utf8")));
}

// ---------- merging ----------

function uniqBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const it of items) if (!seen.has(key(it))) seen.set(key(it), it);
  return [...seen.values()];
}

function mergeIdentifiers(a: Identifiers = {}, b: Identifiers = {}): Identifiers {
  const out: Identifiers = { ...b, ...a };
  for (const k of ["extensions", "mime", "puid", "wikidata", "loc_fdd", "uti"] as const) {
    if (a[k] || b[k]) out[k] = [...new Set([...(a[k] ?? []), ...(b[k] ?? [])])];
  }
  if (a.magic || b.magic) out.magic = uniqBy([...(a.magic ?? []), ...(b.magic ?? [])], (m) => `${m.offset}:${m.hex}`);
  return out;
}

/** Merge b into a. `a` wins on scalar fields; lists are unioned; status takes the furthest. */
export function mergeRecords(a: FormatRecord, b: FormatRecord): FormatRecord {
  return {
    ...b,
    ...a,
    aliases: [...new Set([...(a.aliases ?? []), ...(b.aliases ?? [])])],
    identifiers: mergeIdentifiers(a.identifiers, b.identifiers),
    status: statusRank(a.status) >= statusRank(b.status) ? a.status : b.status,
    summary: a.summary ?? b.summary,
    structure: uniqBy([...(a.structure ?? []), ...(b.structure ?? [])], (s) => s.name),
    parsers: uniqBy([...(a.parsers ?? []), ...(b.parsers ?? [])], (p) => p.url),
    tools: uniqBy([...(a.tools ?? []), ...(b.tools ?? [])], (t) => t.url),
    conversions: uniqBy([...(a.conversions ?? []), ...(b.conversions ?? [])], (c) => `${c.to}:${c.tool}`),
    samples: uniqBy([...(a.samples ?? []), ...(b.samples ?? [])], (s) => s.url),
    projects: uniqBy([...(a.projects ?? []), ...(b.projects ?? [])], (p) => p.url),
    claims: uniqBy([...(a.claims ?? []), ...(b.claims ?? [])], (c) => `${c.who}:${c.since}:${c.scope}`),
    verification: [...(a.verification ?? []), ...(b.verification ?? [])],
    provenance: {
      ...b.provenance,
      ...a.provenance,
      sources: [...new Set([...(a.provenance?.sources ?? []), ...(b.provenance?.sources ?? [])])],
    },
    updated: a.updated > b.updated ? a.updated : b.updated,
  };
}

/** Two records whose single PUIDs or single QIDs differ are distinct formats, whatever their names. */
function conflicting(a: FormatRecord, b: FormatRecord): boolean {
  return (["puid", "wikidata"] as const).some((k) => {
    const x = a.identifiers?.[k] ?? [], y = b.identifiers?.[k] ?? [];
    return x.length === 1 && y.length === 1 && x[0] !== y[0];
  });
}

/**
 * Ids are slugs of names, so two sources can give one id to two distinct formats (PRONOM
 * "Apple Disk Image" fmt/1071, Wikidata "Apple Disk Image" fmt/625). The later record is
 * renamed `<id>-<source>`, with the `family` references of its batch, and is not merged by id.
 */
function renameConflicts(batches: FormatRecord[][]): FormatRecord[][] {
  const first = new Map<string, FormatRecord>();
  return batches.map((batch, b) => {
    const renamed = new Map<string, string>();
    const out = batch.map((r) => {
      const prev = first.get(r.id);
      if (!prev || !conflicting(prev, r)) {
        if (!prev) first.set(r.id, r);
        return r;
      }
      const id = `${r.id}-${r.provenance?.sources?.[0] ?? `b${b}`}`;
      renamed.set(r.id, id);
      first.set(id, r);
      return { ...r, id };
    });
    return renamed.size ? out.map((r) => (r.family && renamed.has(r.family) ? { ...r, family: renamed.get(r.family)! } : r)) : out;
  });
}

/**
 * Merge records that share a merge key (same id, or the same single PUID, QID or LoC id,
 * see mergeKeys). Each batch is one origin: the curated files, then one per snapshot.
 * An identifier held by two records of the same batch is a family-level id there (e.g.
 * one LoC description for every Access version), so it is not used to merge. Earlier
 * records win; the merged record keeps the id of the first record of its group.
 */
export function mergeAll(input: FormatRecord[][]): FormatRecord[] {
  const batches = renameConflicts(input);
  const records = batches.flat();
  const batchOf = batches.flatMap((b, i) => b.map(() => i));
  const holders = new Map<string, Set<number>>(); // key -> batches holding it twice or more
  const seen = new Map<string, Set<number>>();
  records.forEach((r, i) => {
    for (const k of mergeKeys(r).filter((k) => !k.startsWith("id:"))) {
      const s = seen.get(k) ?? seen.set(k, new Set()).get(k)!;
      if (s.has(batchOf[i])) (holders.get(k) ?? holders.set(k, new Set()).get(k)!).add(batchOf[i]);
      s.add(batchOf[i]);
    }
  });
  const parent = records.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();
  records.forEach((r, i) => {
    for (const k of mergeKeys(r)) {
      if (holders.has(k)) continue;
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else {
        const [x, y] = [find(i), find(j)];
        if (x !== y) parent[Math.max(x, y)] = Math.min(x, y); // the earliest record is the root
      }
    }
  });
  const groups = new Map<number, FormatRecord>();
  records.forEach((r, i) => {
    const root = find(i);
    const prev = groups.get(root);
    groups.set(root, prev ? mergeRecords(prev, r) : r);
  });
  // A `family` names a record by its id in its own source; point it at the merged record.
  const finalId = new Map(records.map((r, i) => [r.id, groups.get(find(i))!.id]));
  return [...groups.values()]
    .map((r) => {
      if (!r.family) return r;
      const family = finalId.get(r.family) ?? r.family;
      if (family !== r.id) return { ...r, family };
      const { family: _, ...rest } = r;
      return rest;
    })
    .sort((x, y) => x.id.localeCompare(y.id));
}

/**
 * Give a family to versions that have none, from the records holding several PUIDs (SPEC
 * P3): a record with fmt/11, fmt/12 and fmt/13 is the family of the records holding just
 * one of them. A version two families claim gets the one with the fewest PUIDs.
 */
export function linkFamilies(records: FormatRecord[]): FormatRecord[] {
  const byPuid = new Map<string, FormatRecord[]>();
  for (const r of records) {
    const p = r.identifiers?.puid ?? [];
    if (p.length === 1) byPuid.set(p[0], [...(byPuid.get(p[0]) ?? []), r]);
  }
  const families = records
    .filter((r) => (r.identifiers?.puid?.length ?? 0) > 1)
    .sort((a, b) => a.identifiers!.puid!.length - b.identifiers!.puid!.length || a.id.localeCompare(b.id));
  const familyOf = new Map<string, string>();
  for (const f of families) {
    for (const p of f.identifiers!.puid!) {
      const holders = byPuid.get(p) ?? [];
      if (holders.length === 1 && !holders[0].family && !familyOf.has(holders[0].id)) familyOf.set(holders[0].id, f.id);
    }
  }
  return records.map((r) => (familyOf.has(r.id) ? { ...r, family: familyOf.get(r.id)! } : r));
}

/**
 * Copy the tools and parsers of a record's families (up the chain) into it, marked with
 * `via: <family id>`, so a version page shows the software known to handle the format.
 * Status is not inherited: a tool that reads PNG is not proof it reads every version.
 */
export function inheritFromFamily(records: FormatRecord[]): FormatRecord[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return records.map((r) => {
    const tools = [...(r.tools ?? [])], parsers = [...(r.parsers ?? [])];
    const seen = new Set([r.id]);
    for (let f = r.family ? byId.get(r.family) : undefined; f && !seen.has(f.id); f = f.family ? byId.get(f.family) : undefined) {
      seen.add(f.id);
      for (const t of f.tools ?? []) if (!t.via && !tools.some((x) => x.url === t.url)) tools.push({ ...t, via: f.id });
      for (const p of f.parsers ?? []) if (!p.via && !parsers.some((x) => x.url === p.url)) parsers.push({ ...p, via: f.id });
    }
    return seen.size > 1 ? { ...r, tools, parsers } : r;
  });
}

/** All records, curated first (they override), then every snapshot; families linked and inherited. */
export function loadAll(root = REPO_ROOT): FormatRecord[] {
  return inheritFromFamily(linkFamilies(mergeAll([loadCurated(root).map((c) => c.record), ...loadSnapshots(root).map((s) => s.records)])));
}
