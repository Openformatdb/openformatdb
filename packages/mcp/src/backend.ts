// Data backend for the MCP server: a local repository checkout. The merged view (all
// snapshots + curated files) takes about a second to build, so it is cached and rebuilt
// only when a data file changes (git pull, a new import, an edit).
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadAll, loadCurated, loadSnapshots, toIndexEntry, today, REPO_ROOT, type FormatRecord, type IndexEntry } from "@openformatdb/core";

export interface SourceInfo { source: string; name: string; url: string; license: string; fetched_at: string; records: number }

export interface SourcesInfo { sources: SourceInfo[]; curated: number | null; total: number }

export interface Backend {
  readonly kind: "local" | "remote";
  readonly location: string;
  /** Repository root when writes are allowed (claim_format, publish_findings). */
  readonly root?: string;
  /** Every record: full locally, slim remotely (ids, names, identifiers, family, conversions). */
  records(): Promise<FormatRecord[]>;
  index(on?: string): Promise<IndexEntry[]>;
  /** Full merged record, or null. */
  get(id: string): Promise<FormatRecord | null>;
  sources(): Promise<SourcesInfo>;
}

/** Paths and mtimes of every data file: changes when anything under data/ changes. */
function signature(root: string): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else parts.push(`${p}:${s.mtimeMs}:${s.size}`);
    }
  };
  walk(join(root, "data"));
  return parts.join("|");
}

export class LocalBackend implements Backend {
  readonly kind = "local" as const;
  readonly root: string;
  readonly location: string;
  private cache?: { sig: string; records: FormatRecord[]; byId: Map<string, FormatRecord>; index?: { on: string; entries: IndexEntry[] } };
  constructor(root: string) {
    this.root = root;
    this.location = root;
  }
  private load() {
    const sig = signature(this.root);
    if (this.cache?.sig !== sig) {
      const records = loadAll(this.root);
      this.cache = { sig, records, byId: new Map(records.map((r) => [r.id, r])) };
    }
    return this.cache;
  }
  async records() { return this.load().records; }
  async get(id: string) { return this.load().byId.get(id) ?? null; }
  async index(on = today()) {
    const c = this.load();
    if (c.index?.on !== on) c.index = { on, entries: c.records.map((r) => toIndexEntry(r, on)) };
    return c.index.entries;
  }
  async sources() {
    return {
      sources: loadSnapshots(this.root).map((s) => ({ source: s.source, name: s.name, url: s.url, license: s.license, fetched_at: s.fetched_at, records: s.records.length })),
      curated: loadCurated(this.root).length,
      total: this.load().records.length,
    };
  }
}

// ---------- remote static API ----------

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * The site's static API (SPEC "Static API"), read-only. The index, signatures and conversion
 * graph are fetched once (and again after CACHE_TTL_MS) into slim records; full records come
 * from /api/formats/<id>.json on demand.
 */
export class RemoteBackend implements Backend {
  readonly kind = "remote" as const;
  readonly root = undefined;
  readonly location: string;
  private cache = new Map<string, { at: number; value: any }>();
  private fetchImpl: FetchLike;
  private now: () => number;
  private slim?: { from: unknown; records: FormatRecord[]; byId: Map<string, FormatRecord>; index?: { on: string; entries: IndexEntry[] } };

  constructor(baseUrl: string, opts: { fetch?: FetchLike; now?: () => number } = {}) {
    this.location = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((u) => fetch(u));
    this.now = opts.now ?? Date.now;
  }

  /** GET a JSON document, cached for CACHE_TTL_MS. Returns null on 404. */
  private async getJson(path: string): Promise<any> {
    const url = `${this.location}${path}`;
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const res = await this.fetchImpl(url);
    let value: any = null;
    if (res.ok) value = await res.json();
    else if (res.status !== 404) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
    this.cache.set(url, { at: this.now(), value });
    return value;
  }

  private async load() {
    const [index, magic, conversions] = await Promise.all([this.getJson("/api/index.json"), this.getJson("/api/magic.json"), this.getJson("/api/conversions.json")]);
    if (!Array.isArray(index)) throw new Error(`${this.location}/api/index.json is missing or not an array`);
    if (this.slim?.from !== index) {
      const records: FormatRecord[] = index.map((e: any) => ({
        id: e.id, name: e.name, ...(e.version ? { version: e.version } : {}), aliases: e.aliases ?? [], ...(e.family ? { family: e.family } : {}),
        category: e.category, status: e.status,
        identifiers: { ...e.identifiers, ...(magic?.[e.id] ? { magic: magic[e.id].map(([offset, hex]: [number, string]) => ({ offset, hex })) } : {}) },
        ...(conversions?.[e.id] ? { conversions: conversions[e.id] } : {}),
        provenance: { sources: e.sources ?? [] }, updated: e.updated ?? "",
        // Counts only: the index carries how many tools, not which ones.
        _tools: e.tools ?? 0, _open_tools: e.open_tools ?? 0,
      }));
      this.slim = { from: index, records, byId: new Map(records.map((r) => [r.id, r])) };
    }
    return this.slim;
  }

  async records() { return (await this.load()).records; }
  async index(on = today()) {
    const s = await this.load();
    if (s.index?.on !== on) {
      s.index = { on, entries: s.records.map((r: any) => ({ ...toIndexEntry(r, on), tools: r._tools, open_tools: r._open_tools })) };
    }
    return s.index.entries;
  }
  async get(id: string) {
    if (!/^[a-z0-9]+([.+-][a-z0-9]+)*$/.test(id)) return null;
    return this.getJson(`/api/formats/${id}.json`);
  }
  async sources(): Promise<SourcesInfo> {
    const s = await this.getJson("/api/sources.json");
    if (s && Array.isArray(s.sources)) return s;
    return { sources: [], curated: null, total: (await this.records()).length };
  }
}

export const DEFAULT_API_URL = "https://openformatdb.org";

/** OFDB_REPO (local, writable) wins over OFDB_API_URL (remote, read-only); default: this
 *  checkout when run from one, otherwise the public site (npm install). */
export function backendFromEnv(env: Record<string, string | undefined> = process.env): Backend {
  if (env.OFDB_REPO) return new LocalBackend(env.OFDB_REPO);
  if (env.OFDB_API_URL) return new RemoteBackend(env.OFDB_API_URL);
  if (existsSync(join(REPO_ROOT, "data/imported"))) return new LocalBackend(REPO_ROOT);
  return new RemoteBackend(DEFAULT_API_URL);
}
