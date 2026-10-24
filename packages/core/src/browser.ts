// Browser-safe part of core: types, ids, statuses and claims. No Node imports, so the
// website can ship it to the client. index.ts re-exports all of it.

export type Status = "unknown" | "in-progress" | "partial" | "readable" | "writable";

export const STATUSES: Status[] = ["unknown", "in-progress", "partial", "readable", "writable"];

export interface Magic { offset: number; hex: string; notes?: string }
export interface Sequence { position: "bof" | "eof" | "var"; offset?: number; max_offset?: number; pattern: string }
export interface Signature { name?: string; sequences: Sequence[] }
export interface Identifiers {
  extensions?: string[];
  mime?: string[];
  puid?: string[];
  wikidata?: string[];
  loc_fdd?: string[];
  uti?: string[];
  magic?: Magic[];
  signatures?: Signature[];
  priority_over?: string[];
}
export interface Spec { availability: "open-standard" | "paywalled-standard" | "vendor-published" | "reverse-engineered" | "none"; url?: string; standard?: string }
export interface StructurePart { name: string; status: "unknown" | "partial" | "documented"; confidence?: "low" | "medium" | "high"; spec?: string; notes?: string }
export interface Parser { engine: string; url: string; license?: string; coverage?: "full" | "partial" | "header-only"; via?: string }
export interface Tool { name: string; url: string; license?: string; open_source?: boolean; reads?: boolean; writes?: boolean; platforms?: string[]; notes?: string; via?: string }
export interface Conversion { to: string; tool: string; command?: string; fidelity: "lossless" | "lossy" | "partial"; losses?: string; url?: string; via?: string }
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
  /** First bytes of the file as hex (spaces allowed), e.g. from `xxd -p -l 1024 file`. */
  magic_hex?: string;
  /** Last bytes of the file as hex, e.g. from `tail -c 512 file | xxd -p`: checks end-of-file signatures. */
  tail_hex?: string;
  /** True when magic_hex holds the whole file. */
  whole_file?: boolean;
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
  const hex = (s?: string) => (s ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  const bytes = hex(q.magic_hex);
  const tail = hex(q.tail_hex) || undefined;
  const ext = q.extension ? extensionOf(q.extension) : "";
  const mime = (q.mime ?? "").toLowerCase().split(";")[0].trim();
  const out: Candidate[] = [];
  const full = new Set<string>(); // ids whose full signature matched
  const puids = new Map<string, string>(); // puid -> id, for priorities
  for (const e of entries) {
    const matched: string[] = [];
    let score = 0;
    if (bytes) {
      const sigs = e.identifiers.signatures ?? [];
      const results = sigs.map((s) => signatureMatch(s, bytes, tail, q.whole_file));
      if (results.includes("match")) {
        score += 200; matched.push("full signature"); full.add(e.id);
        for (const p of e.identifiers.puid ?? []) puids.set(p, e.id);
      } else {
        const best = Math.max(-1, ...(e.identifiers.magic ?? []).map((m) => magicMatch(bytes, m)));
        // Signatures all checked and none matched: the prefix alone is not evidence.
        const ruledOut = sigs.length > 0 && results.every((r) => r === "fail");
        if (best > 0 && !ruledOut) { score += 100 + best; matched.push(`signature (${best} bytes)`); }
      }
    }
    if (mime && e.identifiers.mime?.includes(mime)) { score += 40; matched.push(`mime ${mime}`); }
    if (ext && e.identifiers.extensions?.includes(ext)) { score += 20; matched.push(`extension .${ext}`); }
    if (!score) continue;
    out.push({ id: e.id, name: e.name, ...(e.version ? { version: e.version } : {}), ...(e.family ? { family: e.family } : {}), category: e.category, status: e.status, score: score + statusRank(e.status) * 0.1 + Math.min(e.open_tools ?? 0, 50) * 0.001, matched });
  }
  // PRONOM priorities: of two full matches, drop the one the other has priority over.
  const beaten = new Set<string>();
  for (const e of entries) {
    if (!full.has(e.id)) continue;
    for (const p of e.identifiers.priority_over ?? []) {
      const loser = puids.get(p);
      if (loser && loser !== e.id) beaten.add(loser);
    }
  }
  const kept = out.filter((c) => !beaten.has(c.id));
  kept.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return kept.slice(0, limit);
}

// ---------- full signatures ----------

const BYTE = "[0-9a-f]{2}";

/** All bytes from a to b as hex alternatives (a byte range in PRONOM is inclusive). */
function byteRange(a: number, b: number): string {
  const out: string[] = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i.toString(16).padStart(2, "0"));
  return `(?:${out.join("|")})`;
}

/**
 * A PRONOM byte sequence as a regular expression over the file's bytes written as lowercase hex
 * (two characters per byte). Supports hex, ?? (any byte), * (any run), {n} {n-m} {n-*} (gaps),
 * [aa] [aa:bb] [!aa] [!aa:bb] (byte sets) and (a|b) alternatives. Null for anything else.
 */
export function compilePattern(pattern: string): string | null {
  const p = pattern.toLowerCase().replace(/\s+/g, "");
  let i = 0;
  const seq = (stop: string): string | null => {
    let out = "";
    while (i < p.length && !stop.includes(p[i])) {
      const c = p[i];
      if (/[0-9a-f]/.test(c)) {
        if (!/^[0-9a-f]{2}$/.test(p.slice(i, i + 2))) return null;
        out += p.slice(i, i + 2); i += 2;
      } else if (p.startsWith("??", i)) { out += BYTE; i += 2; }
      else if (c === "*") { out += `(?:${BYTE})*?`; i++; }
      else if (c === "{") {
        const m = p.slice(i).match(/^\{(\d+)(?:-(\d+|\*))?\}/);
        if (!m) return null;
        out += `(?:${BYTE}){${m[1]}${m[2] === undefined ? "" : m[2] === "*" ? "," : `,${m[2]}`}}`;
        i += m[0].length;
      } else if (c === "[") {
        const m = p.slice(i).match(/^\[(!?)([0-9a-f]{2})(?::([0-9a-f]{2}))?\]/);
        if (!m) return null;
        const set = byteRange(parseInt(m[2], 16), parseInt(m[3] ?? m[2], 16));
        out += m[1] ? `(?!${set})${BYTE}` : set;
        i += m[0].length;
      } else if (c === "(") {
        i++;
        const alts: string[] = [];
        for (;;) {
          const a = seq("|)");
          if (a === null) return null;
          alts.push(a);
          if (p[i] === "|") { i++; continue; }
          if (p[i] === ")") { i++; break; }
          return null;
        }
        out += `(?:${alts.join("|")})`;
      } else return null;
    }
    return out;
  };
  const re = seq("");
  return re !== null && i === p.length && re ? re : null;
}

const compiled = new Map<string, RegExp | null>();
function sequenceRegex(s: Sequence): RegExp | null {
  const key = `${s.position}:${s.offset ?? 0}:${s.max_offset ?? ""}:${s.pattern}`;
  if (!compiled.has(key)) {
    const body = compilePattern(s.pattern);
    const off = s.offset ?? 0;
    // Some PRONOM records give a max offset below the offset: read it as a fixed offset.
    const max = s.max_offset != null && s.max_offset > off ? s.max_offset : off;
    const gap = `(?:${BYTE}){${off}${max !== off ? `,${max}` : ""}}`;
    let re: RegExp | null = null;
    if (body !== null) {
      try {
        re = new RegExp(s.position === "bof" ? `^${gap}${body}` : s.position === "eof" ? `${body}${gap}$` : `^(?:${BYTE})*?${body}`);
      } catch { re = null; } // a quantifier out of range: treated as unsupported
    }
    compiled.set(key, re);
  }
  return compiled.get(key)!;
}

/**
 * Whether a signature matches, given the first bytes (head) and, optionally, the last bytes (tail)
 * as hex. "unknown" when a sequence cannot be checked: no tail for an end-of-file sequence, or
 * syntax not supported. A whole file small enough to fit in head serves as its own tail.
 */
export function signatureMatch(sig: Signature, head: string, tail?: string, whole = false): "match" | "fail" | "unknown" {
  let unknown = false;
  for (const s of sig.sequences) {
    const re = sequenceRegex(s);
    if (!re) { unknown = true; continue; }
    const data = s.position === "eof" ? (tail ?? (whole ? head : undefined)) : s.position === "var" ? (whole ? head : tail ? head + tail : head) : head;
    if (data === undefined) { unknown = true; continue; }
    if (!re.test(data)) {
      // A sequence searched in a truncated head may lie further in the file.
      if (s.position !== "eof" && !whole) { unknown = true; continue; }
      return "fail";
    }
  }
  return unknown ? "unknown" : "match";
}

// ---------- conversion paths ----------

export interface Step { from: string; to: string; tool: string; command?: string; fidelity: Conversion["fidelity"]; losses?: string; via?: string }
export interface ConversionPath { steps: Step[]; fidelity: Conversion["fidelity"]; cost: number }

const COST: Record<Conversion["fidelity"], number> = { lossless: 1, partial: 2, lossy: 3 };
const WORST: Conversion["fidelity"][] = ["lossless", "partial", "lossy"];

/**
 * Cheapest conversion chains from one format to another (Dijkstra; a lossless step costs 1,
 * partial 2, lossy 3), at most `maxSteps` steps. Reaching the target's family counts: a
 * converter that writes "PDF" is a way to get a PDF 1.7 file. Up to `limit` paths, each
 * through a different last tool or route.
 */
export function conversionPaths(records: Pick<FormatRecord, "id" | "family" | "conversions">[], from: string, to: string, { maxSteps = 3, limit = 3 } = {}): ConversionPath[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const target = byId.get(to);
  const goals = new Set([to, ...(target?.family ? [target.family] : [])]);
  const found: ConversionPath[] = [];
  // Small graph, small depth: a priority list is enough.
  let queue: { at: string; steps: Step[]; cost: number }[] = [{ at: from, steps: [], cost: 0 }];
  const best = new Map<string, number>();
  while (queue.length && found.length < limit) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    if (cur.steps.length && goals.has(cur.at)) {
      const fidelity = WORST[Math.max(...cur.steps.map((s) => WORST.indexOf(s.fidelity)))];
      const route = cur.steps.map((s) => `${s.tool}:${s.to}`).join(">");
      if (!found.some((p) => p.steps.map((s) => `${s.tool}:${s.to}`).join(">") === route)) found.push({ steps: cur.steps, fidelity, cost: cur.cost });
      continue;
    }
    if (cur.steps.length >= maxSteps) continue;
    const seenHere = (best.get(cur.at) ?? 0) + 1;
    if (seenHere > limit) continue; // enough routes through this node already
    best.set(cur.at, seenHere);
    for (const c of byId.get(cur.at)?.conversions ?? []) {
      if (c.to === from || cur.steps.some((s) => s.from === c.to)) continue;
      const step: Step = { from: cur.at, to: c.to, tool: c.tool, ...(c.command ? { command: c.command } : {}), fidelity: c.fidelity, ...(c.losses ? { losses: c.losses } : {}), ...(c.via ? { via: c.via } : {}) };
      queue.push({ at: c.to, steps: [...cur.steps, step], cost: cur.cost + COST[c.fidelity] + 0.1 });
    }
  }
  return found;
}

/**
 * Paths between any of several sources and any of several targets (e.g. every format with the
 * extension .wpd to every format with .pdf), cheapest first. Each pair keeps its own best paths.
 */
export function conversionPathsBetween(records: Pick<FormatRecord, "id" | "family" | "conversions">[], froms: string[], tos: string[], opts: { maxSteps?: number; limit?: number } = {}): ConversionPath[] {
  const all: ConversionPath[] = [];
  for (const f of froms) for (const t of tos) if (f !== t) all.push(...conversionPaths(records, f, t, opts));
  const seen = new Set<string>();
  return all
    .sort((a, b) => a.cost - b.cost)
    .filter((p) => { const k = p.steps.map((s) => `${s.from}>${s.tool}>${s.to}`).join("|"); return !seen.has(k) && seen.add(k); })
    .slice(0, opts.limit ?? 3);
}

/** Formats an extension may mean, the most handled first (records holding it, by tool count). */
export function formatsForExtension<T extends Pick<IndexEntry, "id" | "identifiers"> & { tools?: number }>(entries: T[], ext: string, max = 8): T[] {
  const e = extensionOf(ext);
  return entries.filter((x) => x.identifiers.extensions?.includes(e)).sort((a, b) => (b.tools ?? 0) - (a.tools ?? 0) || a.id.localeCompare(b.id)).slice(0, max);
}
