// Engines: what the WebAssembly converters of packages/engines read and write, as tools and
// conversion edges carrying `engine`, so the site and the MCP server know which steps they can
// run on the user's machine. Read from the engines registry, not from a binary: nothing needs
// to be installed. Extensions map onto records like the converters source does.
import { ENGINES, type EngineInfo, type FormatDecl } from "@openformatdb/engines";
import { loadCurated, loadSnapshots, mergeAll, linkFamilies, today, type FormatRecord } from "@openformatdb/core";
import { resolver } from "./converters.ts";
import type { Source } from "../lib.ts";

const COMMAND = "In the browser at https://openformatdb.org/convert/, or convert_file in the OpenFormatDB MCP server";

/** One record per format an engine handles: the engine as a tool, and its conversions. */
export function toRecords(engines: EngineInfo[], resolve: ReturnType<typeof resolver>, on = today(), byId = new Map<string, FormatRecord>()): FormatRecord[] {
  const out = new Map<string, FormatRecord>();
  const entry = (r: FormatRecord) => {
    let e = out.get(r.id);
    if (!e) out.set(r.id, (e = { id: r.id, name: r.name, ...(r.version ? { version: r.version } : {}), category: r.category, status: "unknown", tools: [], conversions: [], provenance: { sources: ["engines"] }, updated: on }));
    return e;
  };
  for (const eng of engines) {
    const categories = [...new Set(eng.formats.map((f) => f.category))];
    const rec = (f: FormatDecl) => (f.id && byId.get(f.id)) || resolve([f.ext, ...(f.exts ?? [])], [f.category, ...categories]);
    const tool = { name: eng.name, url: eng.url, license: eng.license, open_source: true };
    const handled = new Map<string, { r: FormatRecord; reads: boolean; writes: boolean }>();
    for (const f of eng.formats) {
      const r = rec(f);
      if (!r) continue;
      const h = handled.get(r.id) ?? { r, reads: false, writes: false };
      h.reads ||= !!f.read;
      h.writes ||= !!f.write;
      handled.set(r.id, h);
    }
    for (const { r, reads, writes } of handled.values()) {
      const e = entry(r);
      e.tools!.push({ ...tool, reads, writes });
      e.status = writes && reads ? "writable" : reads && e.status === "unknown" ? "readable" : e.status;
    }
    for (const from of eng.formats.filter((f) => f.read)) {
      const src = rec(from);
      if (!src) continue;
      for (const t of eng.targets) {
        const to = eng.formats.find((f) => f.ext === t);
        if (!to?.write || to.ext === from.ext || (eng.pairs && !eng.pairs(from, to))) continue;
        const dst = rec(to);
        if (!dst || dst.id === src.id) continue;
        const e = entry(src);
        if (e.conversions!.some((c) => c.to === dst.id && c.engine === eng.id)) continue;
        e.conversions!.push({ to: dst.id, tool: eng.name, command: COMMAND, ...eng.fidelity(from, to), url: "https://openformatdb.org/convert/", engine: eng.id });
      }
    }
  }
  return [...out.values()];
}

const source: Source = {
  source: "engines",
  name: "WebAssembly engines (ImageMagick, FFmpeg, Pandoc, 7-Zip, GDAL, Assimp, resvg)",
  url: "https://github.com/openformatdb/openformatdb/blob/main/packages/engines/src/registry.ts",
  license: "CC0-1.0",
  async fetch() {
    const records = linkFamilies(mergeAll([loadCurated().map((c) => c.record), ...loadSnapshots().filter((s) => s.source !== "engines").map((s) => s.records)]));
    return toRecords(ENGINES, resolver(records), today(), new Map(records.map((r) => [r.id, r])));
  },
};

export default source;
