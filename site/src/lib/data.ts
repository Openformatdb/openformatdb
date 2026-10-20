// Build-time data access. Everything is loaded once per build and shared by all pages.
import { loadAll, loadCurated, loadSnapshots, toIndexEntry, today, STATUSES, type FormatRecord, type IndexEntry, type Status } from "@openformatdb/core";
import { REPO_URL } from "./config.ts";

declare const __OFDB_ROOT__: string;

/** Repository root the data is read from (OFDB_REPO overrides). */
export const ROOT: string = process.env.OFDB_REPO || __OFDB_ROOT__;

export interface SourceInfo { id: string; name: string; url: string; license: string; fetched_at?: string; count: number }

interface Db {
  on: string;
  records: FormatRecord[];
  byId: Map<string, FormatRecord>;
  index: IndexEntry[];
  versions: Map<string, FormatRecord[]>;
  curatedIds: Set<string>;
  sources: Map<string, SourceInfo>;
}

let cache: Db | undefined;

export function db(): Db {
  if (cache) return cache;
  const on = today();
  const curated = loadCurated(ROOT);
  const records = loadAll(ROOT);
  const sources = new Map<string, SourceInfo>();
  sources.set("curated", { id: "curated", name: "OpenFormatDB (curated)", url: `${REPO_URL}/tree/main/data/formats`, license: "CC BY-SA 4.0", count: curated.length });
  for (const s of loadSnapshots(ROOT)) sources.set(s.source, { id: s.source, name: s.name, url: s.url, license: s.license, fetched_at: s.fetched_at, count: s.records.length });
  const versions = new Map<string, FormatRecord[]>();
  for (const r of records) if (r.family) versions.set(r.family, [...(versions.get(r.family) ?? []), r]);
  cache = {
    on, records, byId: new Map(records.map((r) => [r.id, r])), index: records.map((r) => toIndexEntry(r, on)),
    versions, curatedIds: new Set(curated.map((c) => c.record.id)), sources,
  };
  return cache;
}

export const formatUrl = (id: string) => `/formats/${id}/`;
export const jsonUrl = (id: string) => `/api/formats/${id}.json`;

export function counts() {
  const { index, sources } = db();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const e of index) byStatus[e.status]++;
  const conversions = db().records.reduce((n, r) => n + (r.conversions ?? []).filter((c) => !c.via).length, 0);
  return { formats: index.length, sources: sources.size - 1, byStatus, conversions };
}

export function facet(key: "category" | "status"): [string, number][] {
  const m = new Map<string, number>();
  for (const e of db().index) m.set(e[key], (m.get(e[key]) ?? 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}

export const sourceName = (id: string) => db().sources.get(id)?.name ?? id;

export function editUrl(r: FormatRecord): string {
  if (db().curatedIds.has(r.id)) return `${REPO_URL}/edit/main/data/formats/${r.id}.yaml`;
  const ids: Record<string, string[]> = {};
  for (const k of ["puid", "wikidata"] as const) if (r.identifiers?.[k]?.length === 1) ids[k] = r.identifiers[k]!;
  const stub = [`id: ${r.id}`, `name: ${JSON.stringify(r.name)}`, ...(r.version ? [`version: ${JSON.stringify(r.version)}`] : []), `category: ${r.category}`,
    ...(Object.keys(ids).length ? ["identifiers:", ...Object.entries(ids).map(([k, v]) => `  ${k}: [${v.join(", ")}]`)] : []),
    `status: ${r.status}`, `provenance:\n  ai_assisted: false`, `updated: ${db().on}`, ""].join("\n");
  return `${REPO_URL}/new/main/data/formats?${new URLSearchParams({ filename: `${r.id}.yaml`, value: stub })}`;
}
