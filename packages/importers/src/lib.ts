// Shared helpers for importers: HTTP with retries, GitHub listing and snapshot
// finalisation (validate, dedupe, compact, sort).
import { validate, mergeRecords, type FormatRecord, type Snapshot } from "@openformatdb/core";

export interface Source {
  source: string;   // short id, also the snapshot file name
  name: string;     // display name
  url: string;      // upstream project
  license: string;  // license of the upstream data
  fetch(): Promise<FormatRecord[]>;
}

const UA = "openformatdb-importer/0.1 (+https://github.com/openformatdb)";

// ---------- http ----------

export async function fetchText(url: string, { retries = 6, headers = {} as Record<string, string> } = {}): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, ...headers } });
      if (res.ok) return await res.text();
      last = new Error(`${res.status} ${res.statusText} for ${url}`);
      if (res.status !== 429 && res.status < 500) break; // 4xx other than rate limit: give up
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export async function fetchJson<T = any>(url: string, opts?: Parameters<typeof fetchText>[1]): Promise<T> {
  return JSON.parse(await fetchText(url, opts));
}

/** Run fn over items with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- github ----------

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Paths of every blob in a repository branch (one API call). */
export async function githubFiles(repo: string, branch: string): Promise<string[]> {
  const tree = await fetchJson(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { headers: githubHeaders() });
  if (tree.truncated) throw new Error(`git tree of ${repo} is truncated`);
  return tree.tree.filter((x: any) => x.type === "blob").map((x: any) => x.path as string);
}

export function githubRaw(repo: string, branch: string, path: string): Promise<string> {
  return fetchText(`https://raw.githubusercontent.com/${repo}/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`);
}

// ---------- records ----------

export const clean = (s: unknown): string => (typeof s === "string" || typeof s === "number" ? String(s) : "").replace(/\s+/g, " ").trim();

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

/** Drop empty values at any depth so snapshots stay small; dedupe string lists. */
export function compactRecord<T>(v: T): T {
  if (Array.isArray(v)) {
    const items = v.map(compactRecord).filter((x) => !isEmpty(x));
    return (items.every((x) => typeof x === "string") ? [...new Set(items)] : items) as T;
  }
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, compactRecord(x)] as const).filter(([, x]) => !isEmpty(x)),
    ) as T;
  }
  return typeof v === "string" ? (v.trim() as T) : v;
}

export interface Finalized { records: FormatRecord[]; input: number; invalid: number; merged: number; errors: string[] }

/** Validate, merge duplicates by id, compact and sort the records of one source. */
export function finalize(records: FormatRecord[]): Finalized {
  const byId = new Map<string, FormatRecord>();
  const errors: string[] = [];
  let invalid = 0, merged = 0;
  for (const raw of records) {
    const r = compactRecord(raw);
    const errs = validate(r);
    if (errs.length) {
      invalid++;
      if (errors.length < 20) errors.push(`${r.id ?? "?"}: ${errs[0]}`);
      continue;
    }
    const prev = byId.get(r.id);
    if (prev) merged++;
    byId.set(r.id, prev ? compactRecord(mergeRecords(prev, r)) : r);
  }
  const out = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { records: out, input: records.length, invalid, merged, errors };
}

export function snapshot(src: Source, records: FormatRecord[], fetchedAt = new Date()): Snapshot {
  return { source: src.source, name: src.name, url: src.url, license: src.license, fetched_at: fetchedAt.toISOString(), records };
}

/** Snapshot as JSON with one record per line: small, and diffs stay readable. */
export function stringifySnapshot(s: Snapshot): string {
  const { records, ...head } = s;
  const top = JSON.stringify(head, null, 1).slice(0, -2); // drop the closing "\n}"
  return `${top},\n "records": [\n${records.map((r) => "  " + JSON.stringify(r)).join(",\n")}\n ]\n}\n`;
}
