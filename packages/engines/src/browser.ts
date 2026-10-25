// Browser host: engine files fetched from the CDNs, checked against their pinned SHA-256 and kept
// in Cache Storage, so each engine is downloaded once per browser. Runs in a page or a worker.
import { PINS } from "./assets.ts";
import { assetKey as key, assetUrls as urls, type EngineInfo, type Host } from "./index.ts";

const CACHE = "openformatdb-engines-v1";

async function sha256(data: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Body as bytes, reporting progress (loaded, total) as it streams in. */
async function readBody(res: Response, total: number, onProgress?: (loaded: number, total: number) => void): Promise<Uint8Array> {
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export interface BrowserHostOptions {
  onProgress?(engine: EngineInfo, path: string, loaded: number, total: number): void;
}

export function browserHost(opts: BrowserHostOptions = {}): Host {
  async function cache(): Promise<Cache | null> {
    try { return await caches.open(CACHE); } catch { return null; } // private windows, file://
  }
  return {
    kind: "browser",
    async asset(e, path) {
      const k = key(e, path);
      const pin = PINS[k];
      if (!pin) throw new Error(`no pinned checksum for ${k}`);
      const c = await cache();
      const hit = await c?.match(`https://engines.openformatdb.org/${k}`);
      if (hit) {
        const data = new Uint8Array(await hit.arrayBuffer());
        if ((await sha256(data)) === pin.sha256) return data;
      }
      const errors: string[] = [];
      for (const url of urls(e, path)) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await readBody(res, pin.size, opts.onProgress && ((l, t) => opts.onProgress!(e, path, l, t)));
          if ((await sha256(data)) !== pin.sha256) throw new Error("checksum mismatch");
          await c?.put(`https://engines.openformatdb.org/${k}`, new Response(data as BodyInit)).catch(() => {}); // quota: works uncached
          return data;
        } catch (err: any) {
          errors.push(`${url}: ${err?.message ?? err}`);
        }
      }
      throw new Error(`could not download ${e.name}: ${errors.join("; ")}`);
    },
  };
}

/** Engines already downloaded in this browser. */
export async function cachedEngines(engines: EngineInfo[]): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const c = await caches.open(CACHE);
    for (const e of engines) {
      const hits = await Promise.all(e.assets.map((a) => c.match(`https://engines.openformatdb.org/${key(e, a)}`)));
      if (hits.every(Boolean)) out.add(e.id);
    }
  } catch { /* no Cache Storage */ }
  return out;
}
