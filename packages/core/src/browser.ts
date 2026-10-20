// Browser-safe part of core: types, ids, statuses and claims. No Node imports, so the
// website can ship it to the client. index.ts re-exports all of it.

export type Status = "unknown" | "in-progress" | "partial" | "readable" | "writable";

export const STATUSES: Status[] = ["unknown", "in-progress", "partial", "readable", "writable"];

export interface Magic { offset: number; hex: string; notes?: string }
export interface Identifiers {
  extensions?: string[];
  mime?: string[];
  puid?: string[];
  wikidata?: string[];
  loc_fdd?: string[];
  uti?: string[];
  magic?: Magic[];
}
export interface Spec { availability: "open-standard" | "paywalled-standard" | "vendor-published" | "reverse-engineered" | "none"; url?: string; standard?: string }
export interface StructurePart { name: string; status: "unknown" | "partial" | "documented"; confidence?: "low" | "medium" | "high"; spec?: string; notes?: string }
export interface Parser { engine: string; url: string; license?: string; coverage?: "full" | "partial" | "header-only"; via?: string }
export interface Tool { name: string; url: string; license?: string; open_source?: boolean; reads?: boolean; writes?: boolean; platforms?: string[]; notes?: string; via?: string }
export interface Conversion { to: string; tool: string; command?: string; fidelity: "lossless" | "lossy" | "partial"; losses?: string; url?: string }
export interface Sample { url: string; license?: string; notes?: string }
export interface Project { name: string; url: string; kind: string; license?: string; official?: boolean }
export interface Claim { who: string; contact: string; scope: string; since: string; expires: string; agent?: string }
export interface Verification { method: string; by: string; date: string; tool?: string; notes?: string }

export interface FormatRecord {
  id: string;
  name: string;
  version?: string;
  aliases?: string[];
  family?: string;
  category: string;
  identifiers?: Identifiers;
  status: Status;
  spec?: Spec;
  summary?: string;
  structure?: StructurePart[];
  parsers?: Parser[];
  tools?: Tool[];
  conversions?: Conversion[];
  samples?: Sample[];
  projects?: Project[];
  claims?: Claim[];
  verification?: Verification[];
  provenance?: { sources?: string[]; ai_assisted?: boolean; tools?: string[] };
  updated: string;
}

/** An importer snapshot, stored as data/imported/<source>.json */
export interface Snapshot {
  source: string;        // short id, e.g. "pronom"
  name: string;          // display name, e.g. "PRONOM"
  url: string;           // upstream project
  license: string;       // license of the upstream data
  fetched_at: string;    // ISO datetime
  records: FormatRecord[];
}

// ---------- ids ----------

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";
}

/** Record id from a name and optional version, cut at a word boundary to stay readable. */
export function makeId(name: string, version?: string, max = 80): string {
  const id = slugify(version ? `${name} ${version}` : name);
  if (id.length <= max) return id;
  const dash = id.lastIndexOf("-", max);
  return id.slice(0, dash > 0 ? dash : max);
}

// ---------- claims ----------

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function liveClaims(r: FormatRecord, on = today()): Claim[] {
  return (r.claims ?? []).filter((c) => c.expires >= on);
}

/** Status as displayed: a record with nothing known but a live claim is "in-progress". */
export function effectiveStatus(r: FormatRecord, on = today()): Status {
  if (r.status === "unknown" && liveClaims(r, on).length) return "in-progress";
  if (r.status === "in-progress" && !liveClaims(r, on).length) return "unknown";
  return r.status;
}

export const statusRank = (s: Status) => STATUSES.indexOf(s);

// ---------- merge keys ----------

/**
 * Keys under which two records describe the same format (SPEC P3): the id, and each
 * external identifier the record holds exactly one of. A record with several PUIDs or
 * QIDs is a family (e.g. a Wikidata item for all PNG versions): it is linked to the
 * versions, never merged into them. Extensions and MIME types are never merge keys.
 */
export function mergeKeys(r: FormatRecord): string[] {
  const keys = [`id:${r.id}`];
  for (const k of ["puid", "wikidata", "loc_fdd"] as const) {
    const v = r.identifiers?.[k] ?? [];
    if (v.length === 1) keys.push(`${k}:${v[0]}`);
  }
  return keys;
}

// ---------- index & search ----------

export interface IndexEntry {
  id: string;
  name: string;
  version?: string;
  aliases: string[];
  family?: string;
  category: string;
  status: Status;
  identifiers: Identifiers;
  sources: string[];
  /** Software known to handle it (own and inherited), and how many of them are open source. */
  tools: number;
  open_tools: number;
  claims: number;
  updated: string;
}

export function toIndexEntry(r: FormatRecord, on = today()): IndexEntry {
  const tools = r.tools ?? [];
  return {
    id: r.id,
    name: r.name,
    ...(r.version ? { version: r.version } : {}),
    aliases: r.aliases ?? [],
    ...(r.family ? { family: r.family } : {}),
    category: r.category,
    status: effectiveStatus(r, on),
    identifiers: r.identifiers ?? {},
    sources: r.provenance?.sources ?? [],
    tools: tools.length,
    open_tools: tools.filter((t) => t.open_source).length,
    claims: liveClaims(r, on).length,
    updated: r.updated,
  };
}

export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const compact = (s: string) => norm(s).replace(/ /g, "");

export interface SearchFilters { category?: string; status?: Status; limit?: number }

interface SearchKeys { hay: string; words: Set<string>; ids: string[]; name: string }

const keyCache = new WeakMap<IndexEntry, SearchKeys>();
function keys(e: IndexEntry): SearchKeys {
  let k = keyCache.get(e);
  if (!k) {
    const hay = norm([e.name, e.version ?? "", ...e.aliases].join(" "));
    const { magic: _, ...ids } = e.identifiers;
    k = { hay, words: new Set(hay.split(" ")), ids: Object.values(ids).flat().map((x) => compact(x as string)), name: compact(`${e.name} ${e.version ?? ""}`) };
    keyCache.set(e, k);
  }
  return k;
}

/** Token search over name, version, aliases and identifiers (extension, MIME, PUID, QID…). */
export function search(entries: IndexEntry[], query: string, f: SearchFilters = {}): (IndexEntry & { score: number })[] {
  const tokens = norm(query).split(" ").filter(Boolean);
  const qc = compact(query);
  const out: (IndexEntry & { score: number })[] = [];
  for (const e of entries) {
    if (f.category && e.category !== f.category) continue;
    if (f.status && e.status !== f.status) continue;
    if (!tokens.length) { out.push({ ...e, score: 0 }); continue; }
    const { hay, words, ids, name } = keys(e);
    let score = 0;
    if (qc && ids.includes(qc)) score += 100;
    if (name === qc || compact(e.name) === qc) score += 50;
    let all = true;
    for (const t of tokens) {
      if (words.has(t)) score += 10;
      else if (hay.includes(t) || ids.some((i) => i.includes(t))) score += 4;
      else all = false;
    }
    if (!all && score < 100) continue;
    // Prefer what is better known: open tools, then status, then a family over one of its versions.
    score += Math.min(e.open_tools, 10) * 0.3 + statusRank(e.status) + (e.family ? 0 : 0.5);
    out.push({ ...e, score });
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return out.slice(0, f.limit ?? 50);
}

// ---------- identification ----------

export interface IdentifyQuery {
  /** File name or extension ("report.DOC", ".doc", "doc"). */
  extension?: string;
  mime?: string;
  /** First bytes of the file as hex (spaces allowed), e.g. from `xxd -p -l 64 file`. */
  magic_hex?: string;
}

export interface Candidate { id: string; name: string; version?: string; family?: string; category: string; status: Status; score: number; matched: string[] }

/** Number of literal bytes of `m` found in `bytes`, or -1 when it does not match. */
export function magicMatch(bytes: string, m: Magic): number {
  const start = m.offset * 2;
  if (bytes.length < start + m.hex.length) return -1;
  let literal = 0;
  for (let i = 0; i < m.hex.length; i += 2) {
    const want = m.hex.slice(i, i + 2);
    if (want === "??") continue;
    if (bytes.slice(start + i, start + i + 2) !== want) return -1;
    literal++;
  }
  return literal;
}

export function extensionOf(s: string): string {
  const name = s.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
}

/**
 * Candidate formats for a file. A signature beats a MIME type, which beats an extension:
 * extensions collide (`.dat`), signatures rarely do, and a longer signature is more specific.
 * Nothing about the file is needed beyond its first bytes; the caller reads it locally.
 */
export function identify<T extends Pick<IndexEntry, "id" | "name" | "version" | "family" | "category" | "status" | "identifiers"> & { open_tools?: number }>(entries: T[], q: IdentifyQuery, limit = 10): Candidate[] {
  const bytes = (q.magic_hex ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  const ext = q.extension ? extensionOf(q.extension) : "";
  const mime = (q.mime ?? "").toLowerCase().split(";")[0].trim();
  const out: Candidate[] = [];
  for (const e of entries) {
    const matched: string[] = [];
    let score = 0;
    if (bytes) {
      const best = Math.max(-1, ...(e.identifiers.magic ?? []).map((m) => magicMatch(bytes, m)));
      if (best > 0) { score += 100 + best; matched.push(`signature (${best} bytes)`); }
    }
    if (mime && e.identifiers.mime?.includes(mime)) { score += 40; matched.push(`mime ${mime}`); }
    if (ext && e.identifiers.extensions?.includes(ext)) { score += 20; matched.push(`extension .${ext}`); }
    if (!score) continue;
    out.push({ id: e.id, name: e.name, ...(e.version ? { version: e.version } : {}), ...(e.family ? { family: e.family } : {}), category: e.category, status: e.status, score: score + statusRank(e.status) * 0.1 + Math.min(e.open_tools ?? 0, 50) * 0.001, matched });
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return out.slice(0, limit);
}
