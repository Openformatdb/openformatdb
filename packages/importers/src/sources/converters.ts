// Converters: what FFmpeg, ImageMagick, Pandoc and LibreOffice read and write, as tools and
// conversion edges on the format records (SPEC "Conversion paths"). FFmpeg, ImageMagick and
// Pandoc are asked directly (`ffmpeg -formats`, `convert -list format`, `pandoc --list-*`);
// LibreOffice has no such listing, so its common filters are a table here. A tool that is not
// installed is skipped. Format names are mapped to records through extensions, restricted to
// the categories the tool handles, preferring the record most software handles (usually the
// family, so the edge reaches every version through inheritance).
import { execFileSync } from "node:child_process";
import { loadCurated, loadSnapshots, mergeAll, linkFamilies, today, type Conversion, type FormatRecord, type Tool } from "@openformatdb/core";
import type { Source } from "../lib.ts";

type Fidelity = Conversion["fidelity"];

export interface ToolFormats {
  tool: Omit<Tool, "reads" | "writes">;
  /** Categories the tool handles: a name only maps to a record of one of them. */
  categories: string[];
  /** Tool format name → extensions it stands for (default: the name itself). */
  aliases?: Record<string, string[]>;
  reads: string[];
  writes: string[];
  /** Target names to convert to (each must be in `writes`). */
  targets: string[];
  /** Only these (from, to) pairs convert, when set (LibreOffice: a spreadsheet does not become a .docx). */
  pairs?(from: string, to: string): boolean;
  command(from: string, to: string, fromExt: string, toExt: string): string;
  fidelity(fromCategory: string, to: string): { fidelity: Fidelity; losses?: string };
}

// ---------- listings ----------

/** `ffmpeg -formats`: " DE name1,name2   Description" lines after the "--" separator. */
export function parseFfmpeg(out: string): { reads: string[]; writes: string[] } {
  const reads: string[] = [], writes: string[] = [];
  const body = out.slice(out.indexOf("--") + 2);
  for (const line of body.split("\n")) {
    const m = line.match(/^ ([D ])([E ])\S?\s+(\S+)\s/);
    if (!m) continue;
    for (const n of m[3].split(",")) {
      if (m[1] === "D") reads.push(n);
      if (m[2] === "E") writes.push(n);
    }
  }
  return { reads, writes };
}

/** `convert -list format`: "  NAME* MODULE  rw+  Description"; the module column can be empty. */
export function parseImageMagick(out: string): { reads: string[]; writes: string[] } {
  const reads: string[] = [], writes: string[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9][A-Z0-9_-]*)\*?\s+(?:[A-Z0-9_-]+\s+)?([r-])([w-])([+-])\s/);
    if (!m) continue;
    const n = m[1].toLowerCase();
    if (m[2] === "r") reads.push(n);
    if (m[3] === "w") writes.push(n);
  }
  return { reads, writes };
}

function run(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 });
  } catch {
    return null;
  }
}

const lines = (s: string | null) => (s ?? "").split("\n").map((x) => x.trim()).filter(Boolean);

// ---------- tools ----------

const LOSSY_AUDIO = new Set(["mp3", "ogg", "opus"]);

export function ffmpeg(listing = run("ffmpeg", ["-hide_banner", "-formats"])): ToolFormats | null {
  if (!listing) return null;
  const { reads, writes } = parseFfmpeg(listing);
  return {
    tool: { name: "FFmpeg", url: "https://ffmpeg.org", license: "LGPL-2.1-or-later / GPL-2.0-or-later", open_source: true },
    categories: ["audio", "video"],
    aliases: { matroska: ["mkv", "mka"], mpegts: ["ts", "m2ts"], mpeg: ["mpg", "mpeg"], asf: ["asf", "wmv", "wma"], ipod: ["m4a"], wv: ["wv"], mov: ["mov"], mp4: ["mp4"], aiff: ["aiff", "aif"] },
    reads, writes,
    targets: ["flac", "wav", "mp3", "ogg", "opus", "mp4", "matroska", "webm"],
    command: (_f, _t, fe, te) => `ffmpeg -i in.${fe} out.${te}`,
    fidelity: (fromCategory, to) => {
      if (to === "flac" || to === "wav") return fromCategory === "audio"
        ? { fidelity: "lossless", losses: "Lossless for decoded audio; a lossy source stays as degraded as it was. WAV may reduce bit depth or drop metadata." }
        : { fidelity: "partial", losses: "Audio track only: the video is dropped." };
      if (LOSSY_AUDIO.has(to)) return { fidelity: "lossy", losses: fromCategory === "video" ? "Lossy audio only: the video is dropped." : "Lossy re-encoding." };
      return { fidelity: "lossy", losses: "Re-encoded with lossy codecs by default; try `-c copy` to remux without re-encoding when the codecs fit the container." };
    },
  };
}

const LOSSY_IMAGE = new Set(["jpeg", "jpg", "webp", "gif"]);

export function imagemagick(listing = run("convert", ["-list", "format"])): ToolFormats | null {
  if (!listing) return null;
  const { reads, writes } = parseImageMagick(listing);
  return {
    tool: { name: "ImageMagick", url: "https://imagemagick.org", license: "ImageMagick License", open_source: true },
    categories: ["image", "vector-image", "raw-photo"],
    aliases: { jpeg: ["jpg", "jpeg"], tiff: ["tif", "tiff"] },
    reads, writes,
    targets: ["png", "tiff", "jpeg", "webp", "gif"],
    command: (_f, _t, fe, te) => `convert in.${fe} out.${te}`,
    fidelity: (fromCategory, to) => {
      if (fromCategory === "vector-image") return { fidelity: "lossy", losses: "Rasterised: vectors, text and layers become pixels." };
      if (LOSSY_IMAGE.has(to)) return { fidelity: "lossy", losses: to === "gif" ? "Reduced to 256 colours." : "Lossy compression." };
      return { fidelity: fromCategory === "raw-photo" ? "partial" : "lossless", ...(fromCategory === "raw-photo" ? { losses: "Demosaiced with default settings: raw sensor data and editing latitude are lost." } : { losses: "Pixels kept; some metadata, colour profiles or layers may be dropped." }) };
    },
  };
}

/** Pandoc names → extensions. Only names with a well-known file extension are mapped. */
const PANDOC_EXT: Record<string, string[]> = {
  markdown: ["md"], commonmark: ["md"], gfm: ["md"], docx: ["docx"], odt: ["odt"], html: ["html", "htm"], latex: ["tex"],
  epub: ["epub"], rst: ["rst"], rtf: ["rtf"], docbook: ["dbk"], fb2: ["fb2"], ipynb: ["ipynb"], org: ["org"], textile: ["textile"],
  mediawiki: ["wiki"], opml: ["opml"], csv: ["csv"], tsv: ["tsv"], typst: ["typ"], man: ["1"], asciidoc: ["adoc"], pptx: ["pptx"], plain: ["txt"],
  bibtex: ["bib"], ris: ["ris"], jats: ["jats"], tei: ["tei"], texinfo: ["texi"], icml: ["icml"],
};

export function pandoc(inputs = run("pandoc", ["--list-input-formats"]), outputs = run("pandoc", ["--list-output-formats"])): ToolFormats | null {
  if (!inputs || !outputs) return null;
  const known = (n: string) => n in PANDOC_EXT;
  return {
    tool: { name: "Pandoc", url: "https://pandoc.org", license: "GPL-2.0-or-later", open_source: true },
    categories: ["document", "text", "markup", "ebook", "presentation", "dataset"],
    aliases: PANDOC_EXT,
    reads: lines(inputs).filter(known), writes: lines(outputs).filter(known),
    targets: ["odt", "docx", "html", "markdown", "epub", "plain"],
    command: (f, t, fe, te) => `pandoc -f ${f} -t ${t} in.${fe} -o out.${te}`,
    fidelity: (_c, to) => ({ fidelity: "partial", losses: to === "plain" ? "Text only: all formatting is dropped." : "Document structure is kept; layout, styles and unsupported elements are lost." }),
  };
}

/** LibreOffice import filters for common office formats (it cannot list them from the command line). */
export function libreoffice(available = run("soffice", ["--version"]) !== null || !!process.env.ASSUME_LIBREOFFICE): ToolFormats | null {
  if (!available) return null;
  const text = ["doc", "docx", "odt", "rtf", "wpd", "wps", "pages", "fodt", "dot", "dotx", "sxw", "abw", "lwp", "hwp"];
  const sheet = ["xls", "xlsx", "ods", "csv", "numbers", "wk1", "wb2", "dbf", "fods", "sxc", "xlsb"];
  const slides = ["ppt", "pptx", "odp", "key", "fodp", "sxi", "pps", "ppsx"];
  const draw = ["vsd", "vsdx", "cdr", "pub", "odg", "wpg", "cmx", "svg"];
  const kind = (e: string) => (text.includes(e) ? "text" : sheet.includes(e) ? "sheet" : slides.includes(e) ? "slides" : "draw");
  const targetsOf: Record<string, string[]> = { text: ["odt", "docx", "pdf"], sheet: ["ods", "xlsx", "csv", "pdf"], slides: ["odp", "pptx", "pdf"], draw: ["odg", "pdf"] };
  const reads = [...text, ...sheet, ...slides, ...draw];
  return {
    tool: { name: "LibreOffice", url: "https://www.libreoffice.org", license: "MPL-2.0", open_source: true },
    categories: ["document", "spreadsheet", "presentation", "vector-image", "text", "dataset", "database"],
    reads,
    writes: ["odt", "docx", "pdf", "ods", "xlsx", "csv", "odp", "pptx", "odg"],
    targets: ["odt", "docx", "ods", "xlsx", "csv", "odp", "pptx", "odg", "pdf"],
    pairs: (from, to) => targetsOf[kind(from)].includes(to),
    command: (_f, _t, fe, te) => `soffice --headless --convert-to ${te} in.${fe}`,
    fidelity: (_c, to) => ({
      fidelity: to === "csv" ? "lossy" : "partial",
      losses: to === "csv" ? "First sheet only, values only: formulas, formatting and other sheets are lost." : to === "pdf" ? "Fixed layout: the document is no longer editable." : "Layout may shift; macros and some features are not kept.",
    }),
  };
}

// ---------- mapping and records ----------

/** Best record for an extension within the tool's categories: the most tools, then family records. */
export function resolver(records: FormatRecord[]) {
  const byExt = new Map<string, FormatRecord[]>();
  for (const r of records) for (const e of r.identifiers?.extensions ?? []) byExt.set(e, [...(byExt.get(e) ?? []), r]);
  return (exts: string[], categories: string[]): FormatRecord | null => {
    // "other": Wikidata-only records get no finer category than their MIME type gives (application/pdf).
    const cands = exts.flatMap((e) => byExt.get(e) ?? []).filter((r) => categories.includes(r.category) || r.category === "other");
    // The format most software handles is the one an extension usually means (generic PDF, not PDF/E).
    cands.sort((a, b) => (b.tools?.length ?? 0) - (a.tools?.length ?? 0) || Number(!!a.family) - Number(!!b.family) || a.id.localeCompare(b.id));
    return cands[0] ?? null;
  };
}

const extsOf = (t: ToolFormats, name: string) => t.aliases?.[name] ?? [name];

/** One record per format a tool handles: the tool (reads/writes) and conversions to its targets. */
export function toRecords(tools: ToolFormats[], resolve: ReturnType<typeof resolver>, on = today()): FormatRecord[] {
  const out = new Map<string, FormatRecord>();
  const entry = (r: FormatRecord) => {
    let e = out.get(r.id);
    if (!e) out.set(r.id, (e = { id: r.id, name: r.name, ...(r.version ? { version: r.version } : {}), category: r.category, status: "unknown", tools: [], conversions: [], provenance: { sources: ["converters"] }, updated: on }));
    return e;
  };
  for (const t of tools) {
    const resolved = new Map<string, FormatRecord | null>();
    const rec = (n: string) => (resolved.has(n) ? resolved.get(n)! : (resolved.set(n, resolve(extsOf(t, n), t.categories)), resolved.get(n)!));
    const handled = new Map<string, { r: FormatRecord; reads: boolean; writes: boolean }>();
    for (const [names, mode] of [[t.reads, "reads"], [t.writes, "writes"]] as const) {
      for (const n of names) {
        const r = rec(n);
        if (!r) continue;
        const h = handled.get(r.id) ?? { r, reads: false, writes: false };
        h[mode] = true;
        handled.set(r.id, h);
      }
    }
    for (const { r, reads, writes } of handled.values()) {
      const e = entry(r);
      e.tools!.push({ ...t.tool, reads, writes });
      e.status = writes && reads ? "writable" : reads && e.status === "unknown" ? "readable" : e.status;
    }
    for (const from of new Set(t.reads)) {
      const src = rec(from);
      if (!src) continue;
      for (const to of t.targets) {
        if (!t.writes.includes(to) || (t.pairs && !t.pairs(from, to))) continue;
        const dst = rec(to);
        if (!dst || dst.id === src.id) continue;
        const e = entry(src);
        if (e.conversions!.some((c) => c.to === dst.id && c.tool === t.tool.name)) continue;
        e.conversions!.push({ to: dst.id, tool: t.tool.name, command: t.command(from, to, extsOf(t, from)[0], extsOf(t, to)[0]), ...t.fidelity(src.category, to), url: t.tool.url });
      }
    }
  }
  return [...out.values()];
}

const source: Source = {
  source: "converters",
  name: "Converters (FFmpeg, ImageMagick, Pandoc, LibreOffice)",
  url: "https://github.com/openformatdb/openformatdb/blob/main/packages/importers/src/sources/converters.ts",
  license: "CC0-1.0",
  async fetch() {
    const tools = [ffmpeg(), imagemagick(), pandoc(), libreoffice()].filter((t): t is ToolFormats => !!t);
    if (tools.length < 2) throw new Error(`only ${tools.length} converter(s) installed; install ffmpeg, imagemagick, pandoc (and libreoffice)`);
    // Map onto every other source, never onto our own previous snapshot.
    const records = linkFamilies(mergeAll([loadCurated().map((c) => c.record), ...loadSnapshots().filter((s) => s.source !== "converters" && s.source !== "engines").map((s) => s.records)]));
    return toRecords(tools, resolver(records));
  },
};

export default source;
