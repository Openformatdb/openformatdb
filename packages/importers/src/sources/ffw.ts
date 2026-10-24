// Just Solve the File Format Problem, Archive Team's File Formats Wiki (CC0):
// fileformats.archiveteam.org. Every format page embeds Template:FormatInfo and states its
// identifiers with small templates ({{Ext|png}}, {{Mimetype|image/png}}, {{PRONOM|fmt/13}},
// {{LoCFDD|fdd000153}}, {{Wikidata|Q178051}}, {{Magic|89 50 4E 47}}); its "Software" and
// "Specifications" sections link to tools and documents. Read through the MediaWiki API, or
// from FFW_DIR (one <title>.wiki file per page) without network.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeId, today, type FormatRecord, type Magic, type Tool, type Project } from "@openformatdb/core";
import YAML from "yaml";
import { clean, fetchJson, githubRaw, type Source } from "../lib.ts";

// The wiki is served over plain HTTP (its canonical URLs are http://); HTTPS is the fallback.
const APIS = ["http://fileformats.archiveteam.org/api.php", "https://fileformats.archiveteam.org/api.php"];
const WIKI = "http://fileformats.archiveteam.org/wiki/";

export const pageUrl = (title: string) => WIKI + encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/");

/** Every value of a one-parameter template, e.g. all {{Ext|…}} of a page. */
function templateValues(text: string, name: string): string[] {
  const re = new RegExp(`\\{\\{\\s*${name}\\s*\\|([^{}]*)\\}\\}`, "gi");
  return [...text.matchAll(re)].flatMap((m) => m[1].split("|").map((v) => clean(v)).filter((v) => v && !v.includes("=")));
}

/** A FormatInfo parameter (`|subcat=Graphics`). */
function infoParam(text: string, name: string): string {
  return clean(text.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^|}\\n]*)`, "i"))?.[1]);
}

/** Wiki markup → plain text: templates, refs, files and tags out; links to their label. */
export function plain(s: string): string {
  let t = s;
  for (let i = 0; i < 3; i++) t = t.replace(/\{\{[^{}]*\}\}/g, ""); // nested templates
  return clean(t
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/[^\]\s]+\]/g, "")
    .replace(/'''?/g, ""));
}

/** Lines of a level-2 section whose heading matches. */
function section(text: string, heading: RegExp): string {
  const parts = text.split(/^==\s*([^=].*?)\s*==\s*$/m);
  for (let i = 1; i < parts.length; i += 2) if (heading.test(parts[i])) return parts[i + 1] ?? "";
  return "";
}

/** External links `[url label]` of a block of wikitext. */
function links(block: string): { url: string; label: string }[] {
  return [...block.matchAll(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g)].map((m) => ({ url: m[1], label: plain(m[2]) })).filter((l) => l.label);
}

/** Subcategory or category names → our category, by keyword. */
const CATEGORY: [RegExp, string][] = [
  [/raw|camera/i, "raw-photo"], [/vector/i, "vector-image"], [/graphic|image|bitmap|icon/i, "image"],
  [/audio|music|sound/i, "audio"], [/video|animation|movie/i, "video"], [/font/i, "font"],
  [/archiv|compress/i, "archive"], [/disk image/i, "disk-image"], [/file ?system/i, "filesystem"],
  [/executable|object code|binary program/i, "executable"], [/firmware/i, "firmware"], [/spreadsheet/i, "spreadsheet"],
  [/presentation/i, "presentation"], [/e-?book/i, "ebook"], [/document|word process|page desc|office/i, "document"],
  [/markup/i, "markup"], [/text/i, "text"], [/database/i, "database"], [/e-?mail|mailbox/i, "email"],
  [/3d|cad/i, "3d"], [/gis|geospatial|map/i, "gis"], [/scientific|medical/i, "scientific"], [/game/i, "game"],
  [/config/i, "config"], [/subtitle/i, "subtitle"], [/playlist/i, "playlist"],
];

function category(text: string): string {
  const hints = [infoParam(text, "subcat"), infoParam(text, "formattype"), ...[...text.matchAll(/\[\[Category:([^\]|]+)/gi)].map((m) => m[1])].join(" ");
  for (const [re, c] of CATEGORY) if (re.test(hints)) return c;
  return "other";
}

const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+_-]+$/;
const EXT = /^[a-z0-9_+~-]+(\.[a-z0-9_+~-]+)*$/;

/** One page → a record, or null when it states no identifier (overview pages, people, software). */
export function toRecord(title: string, text: string, on = today()): FormatRecord | null {
  if (/^#redirect/i.test(text.trim())) return null;
  const extensions = templateValues(text, "Ext").map((e) => e.toLowerCase().replace(/^\./, "")).filter((e) => EXT.test(e));
  const mime = templateValues(text, "Mimetype").map((m) => m.toLowerCase().split(";")[0].trim()).filter((m) => MIME.test(m));
  const puid = templateValues(text, "PRONOM").filter((p) => /^(x-)?fmt\/[0-9]+$/.test(p));
  const wikidata = templateValues(text, "Wikidata").filter((q) => /^Q[0-9]+$/.test(q));
  const loc = templateValues(text, "LoCFDD").filter((f) => /^fdd[0-9]+$/.test(f));
  const uti = templateValues(text, "UTI");
  if (!extensions.length && !mime.length && !puid.length && !wikidata.length) return null;
  // {{Magic}} gives bytes without an offset; hex sequences are taken as the start of the file.
  const magic: Magic[] = [];
  for (const v of templateValues(text, "Magic")) {
    const hex = v.toLowerCase().replace(/\s+/g, "");
    if (/^([0-9a-f]{2})+$/.test(hex) && hex.length >= 4 && !magic.some((m) => m.hex === hex)) magic.push({ offset: 0, hex, notes: "File Formats Wiki" });
  }
  const tools: Tool[] = links(section(text, /software|tools|programs|utilities/i)).slice(0, 40)
    .map((l) => ({ name: l.label.slice(0, 120), url: l.url }));
  const docs: Project[] = links(section(text, /specification|format detail|documentation|references|links/i)).slice(0, 20)
    .map((l) => ({ name: l.label.slice(0, 160), url: l.url, kind: "format-doc" }));
  const intro = plain(text.split(/^==/m)[0]);
  return {
    id: makeId(title),
    name: title,
    category: category(text),
    identifiers: { extensions, mime, puid, wikidata, loc_fdd: loc, uti, magic },
    status: "unknown",
    ...(intro ? { summary: intro.slice(0, 1000) } : {}),
    tools,
    projects: [{ name: "File Formats Wiki", url: pageUrl(title), kind: "wiki" }, ...docs],
    provenance: { sources: ["ffw"] },
    updated: on,
  };
}

/**
 * Fallback when the wiki itself cannot be reached (it times out from GitHub's runners): the
 * harvest digipres.org publishes of the same pages (_sources/registries/mediawikis/ffw.yml),
 * with identifiers, magic and categories, but no summary nor software links.
 */
export function fromHarvest(f: any, on = today()): FormatRecord | null {
  const title = clean(f?.name);
  if (!title) return null;
  const tpl = (name: string, vals: unknown) => (Array.isArray(vals) ? vals : []).map((v) => `{{${name}|${clean(v)}}}`).join(" ");
  const text = [tpl("Ext", f.extensions), tpl("Mimetype", f.mimetypes), tpl("PRONOM", f.pronom), tpl("Wikidata", f.wikidata),
    tpl("LoCFDD", f.fdd), tpl("UTI", f.uti), tpl("Magic", f.magic),
    ...(Array.isArray(f.categories) ? f.categories : []).map((c: unknown) => `[[Category:${clean(c)}]]`)].join("\n");
  // pageStartText is the page with templates cut out, often a list of links: not used as summary.
  return toRecord(title, text, on);
}

/** Ids from titles; titles slugging alike get a numbered suffix in title order. */
export function assignIds(records: FormatRecord[]): FormatRecord[] {
  const seen = new Map<string, number>();
  return records.map((r) => {
    const n = (seen.get(r.id) ?? 0) + 1;
    seen.set(r.id, n);
    return n > 1 ? { ...r, id: `${r.id}-${n}` } : r;
  });
}

let apiBase: string | undefined;
async function api(params: Record<string, string>): Promise<any> {
  const q = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  if (apiBase) return fetchJson(`${apiBase}?${q}`);
  let last: unknown;
  for (const base of APIS) {
    try {
      const r = await fetchJson(`${base}?${q}`, { retries: 2 });
      apiBase = base;
      return r;
    } catch (e) { last = e; }
  }
  throw last;
}

/** Titles of the pages embedding Template:FormatInfo, then their wikitext, 50 at a time. */
async function readAll(): Promise<[string, string][]> {
  const dir = process.env.FFW_DIR;
  if (dir) return readdirSync(dir).filter((f) => f.endsWith(".wiki")).sort().map((f) => [f.slice(0, -5), readFileSync(join(dir, f), "utf8")]);
  const titles: string[] = [];
  let cont: Record<string, string> = {};
  do {
    const r = await api({ action: "query", list: "embeddedin", eititle: "Template:FormatInfo", einamespace: "0", eilimit: "500", ...cont });
    titles.push(...r.query.embeddedin.map((p: any) => p.title));
    cont = r.continue ?? {};
  } while (Object.keys(cont).length);
  const pages: [string, string][] = [];
  for (let i = 0; i < titles.length; i += 50) {
    const r = await api({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: titles.slice(i, i + 50).join("|") });
    for (const p of r.query.pages) {
      const text = p.revisions?.[0]?.slots?.main?.content;
      if (typeof text === "string") pages.push([p.title, text]);
    }
  }
  return pages.sort((a, b) => a[0].localeCompare(b[0]));
}

async function readHarvest(): Promise<any[]> {
  const text = await githubRaw("digipres/digipres.github.io", "main", "_sources/registries/mediawikis/ffw.yml");
  return YAML.parse(text)?.formats ?? [];
}

const source: Source = {
  source: "ffw",
  name: "Just Solve the File Format Problem (File Formats Wiki)",
  url: "http://fileformats.archiveteam.org",
  license: "CC0-1.0",
  async fetch() {
    let records: FormatRecord[];
    try {
      const pages = await readAll();
      if (pages.length < 2000) throw new Error(`only ${pages.length} pages`);
      records = pages.map(([t, text]) => toRecord(t, text)).filter((r): r is FormatRecord => !!r);
    } catch (e) {
      console.log(`  ffw: wiki unreachable (${(e as Error).message}); using the digipres.org harvest`);
      const harvest = await readHarvest();
      if (harvest.length < 2000) throw new Error(`only ${harvest.length} pages in the digipres.org harvest, expected 5000+`);
      records = harvest.map((f) => fromHarvest(f)).filter((r): r is FormatRecord => !!r);
    }
    return assignIds(records.sort((a, b) => a.name.localeCompare(b.name)));
  },
};

export default source;
