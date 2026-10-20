// Data backend for the MCP server: a local repository checkout. The merged view (all
// snapshots + curated files) takes about a second to build, so it is cached and rebuilt
// only when a data file changes (git pull, a new import, an edit).
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadAll, loadCurated, loadSnapshots, toIndexEntry, today, REPO_ROOT, type FormatRecord, type IndexEntry } from "@openformatdb/core";

export interface SourceInfo { source: string; name: string; url: string; license: string; fetched_at: string; records: number }

export interface Backend {
  readonly location: string;
  records(): FormatRecord[];
  index(on?: string): IndexEntry[];
  get(id: string): FormatRecord | null;
  sources(): { sources: SourceInfo[]; curated: number; total: number };
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
  records() { return this.load().records; }
  get(id: string) { return this.load().byId.get(id) ?? null; }
  index(on = today()) {
    const c = this.load();
    if (c.index?.on !== on) c.index = { on, entries: c.records.map((r) => toIndexEntry(r, on)) };
    return c.index.entries;
  }
  sources() {
    return {
      sources: loadSnapshots(this.root).map((s) => ({ source: s.source, name: s.name, url: s.url, license: s.license, fetched_at: s.fetched_at, records: s.records.length })),
      curated: loadCurated(this.root).length,
      total: this.records().length,
    };
  }
}

/** OFDB_REPO, else this checkout. A read-only remote backend (static API) comes with the site. */
export function backendFromEnv(env: Record<string, string | undefined> = process.env): Backend {
  return new LocalBackend(env.OFDB_REPO || REPO_ROOT);
}
