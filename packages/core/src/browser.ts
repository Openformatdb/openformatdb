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
export interface Parser { engine: string; url: string; license?: string; coverage?: "full" | "partial" | "header-only" }
export interface Tool { name: string; url: string; license?: string; open_source?: boolean; reads?: boolean; writes?: boolean; platforms?: string[]; notes?: string }
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
