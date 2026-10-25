// GDAL (gdal3.js): ogr2ogr for vector data, gdal_translate for rasters.
import { engineById, type Host, type Runner } from "../index.ts";

const VECTOR_OPTIONS: Record<string, string[]> = {
  kml: ["-t_srs", "EPSG:4326"],
  gpx: ["-t_srs", "EPSG:4326", "-dsco", "GPX_USE_EXTENSIONS=YES"],
  csv: ["-lco", "GEOMETRY=AS_WKT"],
};
const RASTER_OPTIONS: Record<string, string[]> = {
  png: ["-ot", "Byte", "-scale"],
  tiff: ["-co", "COMPRESS=DEFLATE"],
};

let ready: Promise<any> | null = null;

const PLACEHOLDER = "https://engines.openformatdb.invalid/gdal/";

/** Send requests for the placeholder URLs to blob URLs; everything else is untouched. */
function redirect(map: Map<string, string>) {
  const g = globalThis as any;
  const to = (u: unknown) => (typeof u === "string" && map.get(u)) || (u instanceof URL && map.get(u.href)) || null;
  const origFetch = g.fetch.bind(g);
  g.fetch = (input: any, init?: any) => origFetch(to(input) ?? input, init);
  if (g.XMLHttpRequest) {
    const open = g.XMLHttpRequest.prototype.open;
    g.XMLHttpRequest.prototype.open = function (method: string, url: any, ...rest: any[]) { return open.call(this, method, to(url) ?? url, ...rest); };
  }
}

async function init(host: Host) {
  const info = engineById("gdal")!;
  const [wasmPath, dataPath] = info.assets;
  if (host.kind === "node") {
    // The Node build reads its files with fs, relative to the working directory.
    const { relative, dirname } = await import("node:path");
    const wasm = await host.assetPath!(info, wasmPath);
    await host.assetPath!(info, dataPath);
    const { default: initGdalJs } = await import("gdal3.js/dist/package/gdal3.node.js");
    return initGdalJs({ path: relative(process.cwd(), dirname(wasm)) || ".", useWorker: false });
  }
  // gdal3.js only takes http(s) or absolute paths for its files (it prefixes anything else with
  // "/"), so it gets placeholder https URLs, served by fetch and XHR from the checked bytes.
  const map = new Map<string, string>();
  for (const [p, type] of [[wasmPath, "application/wasm"], [dataPath, "application/octet-stream"]]) {
    map.set(`${PLACEHOLDER}${p.slice(p.lastIndexOf("/") + 1)}`, URL.createObjectURL(new Blob([await host.asset(info, p) as BlobPart], { type })));
  }
  redirect(map);
  // Loaded inside a worker, gdal3.js takes over the worker's onmessage to act as its own worker.
  const g = globalThis as any, onmessage = g.onmessage;
  const { default: initGdalJs } = await import("gdal3.js");
  g.onmessage = onmessage;
  return initGdalJs({ paths: { wasm: `${PLACEHOLDER}${wasmPath.slice(wasmPath.lastIndexOf("/") + 1)}`, data: `${PLACEHOLDER}${dataPath.slice(dataPath.lastIndexOf("/") + 1)}` }, useWorker: false });
}

export async function load(host: Host): Promise<Runner> {
  ready ??= init(host);
  ready.catch(() => { ready = null; });
  const Gdal = await ready;
  return {
    async convert(file, from, to) {
      // The browser build opens File objects; the Node build opens paths on the real filesystem.
      let tmp: string | null = null;
      if (host.kind === "node") {
        const [{ mkdtempSync, writeFileSync }, { tmpdir }, { join }] = await Promise.all([import("node:fs"), import("node:os"), import("node:path")]);
        tmp = mkdtempSync(join(tmpdir(), "ofdb-gdal-"));
        writeFileSync(join(tmp, `input.${from.ext}`), file.data);
      }
      let ds: any = null;
      try {
        const opened = await Gdal.open(tmp ? `${tmp}/input.${from.ext}` : new File([file.data as BlobPart], `input.${from.ext}`));
        ds = opened.datasets?.[0];
        if (!ds) throw new Error(`GDAL could not open it as ${from.label}: ${JSON.stringify(opened.errors ?? []).slice(0, 300)}`);
        const out = from.kind === "vector"
          ? await Gdal.ogr2ogr(ds, ["-f", to.name!, ...(VECTOR_OPTIONS[to.ext] ?? [])], "output")
          : await Gdal.gdal_translate(ds, ["-of", to.name!, ...(RASTER_OPTIONS[to.ext] ?? [])], "output");
        const files = out.all?.length ? out.all : [out];
        const base = file.name.replace(/\.[^.]*$/, "");
        const res = [];
        for (const f of files) {
          const data = new Uint8Array(await Gdal.getFileBytes(f));
          const ext = f.local.slice(f.local.lastIndexOf(".") + 1);
          if (!/\.aux\.xml$/.test(f.local)) res.push({ name: `${base}.${ext === to.ext || f === files[0] ? to.ext : ext}`, data });
        }
        return res;
      } finally {
        if (ds) await Promise.resolve(Gdal.close(ds)).catch(() => {});
        if (tmp) { const { rmSync } = await import("node:fs"); rmSync(tmp, { recursive: true, force: true }); }
      }
    },
  };
}
