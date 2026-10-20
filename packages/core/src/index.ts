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

/**
 * Merge records that share a merge key (same id, or the same single PUID, QID or LoC id,
 * see mergeKeys). Each batch is one origin: the curated files, then one per snapshot.
 * An identifier held by two records of the same batch is a family-level id there (e.g.
 * one LoC description for every Access version), so it is not used to merge. Earlier
 * records win; the merged record keeps the id of the first record of its group.
 */
export function mergeAll(batches: FormatRecord[][]): FormatRecord[] {
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
  return [...groups.values()].sort((x, y) => x.id.localeCompare(y.id));
}

/** All records, curated first (they override), then every snapshot. */
export function loadAll(root = REPO_ROOT): FormatRecord[] {
  return mergeAll([loadCurated(root).map((c) => c.record), ...loadSnapshots(root).map((s) => s.records)]);
}
