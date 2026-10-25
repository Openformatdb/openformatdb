// Node host: engine files from an installed npm package when there is one (this checkout), else
// from the disk cache, else downloaded from the CDNs. Every file is checked against its pinned
// SHA-256 before use; a mismatch is never cached.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PINS } from "./assets.ts";
import { assetKey, assetUrls, type EngineInfo, type Host } from "./index.ts";

/** node_modules/<name> of that exact version, looking up from the working directory and from here. */
export function findPackageDir(name: string, version: string): string | null {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    for (let dir = resolve(start); ; dir = dirname(dir)) {
      const pkg = join(dir, "node_modules", name, "package.json");
      if (existsSync(pkg)) {
        try { if (JSON.parse(readFileSync(pkg, "utf8")).version === version) return dirname(pkg); } catch { /* unreadable: keep looking */ }
      }
      if (dirname(dir) === dir) break;
    }
  }
  return null;
}

export const defaultCacheDir = () =>
  process.env.OFDB_ENGINES_DIR || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "openformatdb", "engines");

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export interface NodeHostOptions {
  cacheDir?: string;
  /** Use installed npm packages when present (default true). */
  local?: boolean;
  /** Told about each download, e.g. to log it. */
  onDownload?(url: string, size: number): void;
  fetch?: typeof fetch;
}

export function nodeHost(opts: NodeHostOptions = {}): Host & { cacheDir: string; downloaded: string[] } {
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const downloaded: string[] = [];
  const doFetch = opts.fetch ?? fetch;

  async function ensure(e: EngineInfo, path: string): Promise<string> {
    const key = assetKey(e, path);
    const pin = PINS[key];
    if (!pin) throw new Error(`no pinned checksum for ${key}`);
    if (opts.local !== false) {
      const dir = findPackageDir(e.package.name, e.package.version);
      if (dir && existsSync(join(dir, path))) return join(dir, path);
    }
    const file = join(cacheDir, key);
    if (existsSync(file) && sha256(readFileSync(file)) === pin.sha256) return file;
    const errors: string[] = [];
    for (const url of assetUrls(e, path)) {
      try {
        opts.onDownload?.(url, pin.size);
        const res = await doFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = new Uint8Array(await res.arrayBuffer());
        const got = sha256(data);
        if (got !== pin.sha256) throw new Error(`checksum mismatch (${got})`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file + ".part", data);
        renameSync(file + ".part", file);
        downloaded.push(key);
        return file;
      } catch (err: any) {
        errors.push(`${url}: ${err?.message ?? err}`);
      }
    }
    throw new Error(`could not download ${e.name} (${key}): ${errors.join("; ")}`);
  }

  return {
    kind: "node",
    cacheDir,
    downloaded,
    assetPath: ensure,
    async asset(e, path) { return new Uint8Array(readFileSync(await ensure(e, path))); },
  };
}
