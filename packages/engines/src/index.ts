// OpenFormatDB engines: WebAssembly converters that run where the file is (the visitor's browser,
// or the machine of the agent running the MCP server), so no file is ever uploaded. Each engine
// is fetched on first use, from a CDN, pinned to a version and checked against its SHA-256.
//
//   plans("heic", "webp")          → the cheapest chains of engine steps
//   convert(file, "webp", host)    → runs them; the host fetches and caches the WebAssembly files
//
// Hosts: ./node.ts (disk cache under ~/.cache/openformatdb) and ./browser.ts (Cache Storage).
import { ENGINES, engineById, type EngineInfo, type FormatDecl, type Fidelity } from "./registry.ts";
import { PINS } from "./assets.ts";

export { ENGINES, engineById, PINS };
export type { EngineInfo, FormatDecl, Fidelity };

export interface EngineFile { name: string; data: Uint8Array }

export interface Runner {
  convert(file: EngineFile, from: FormatDecl, to: FormatDecl): Promise<EngineFile[]>;
}

/** Where the WebAssembly files come from. */
export interface Host {
  kind: "node" | "browser";
  /** The bytes of one of the engine's files, checked against PINS. */
  asset(engine: EngineInfo, path: string): Promise<Uint8Array>;
  /** Node only: the file on disk (engines that read their files by path). */
  assetPath?(engine: EngineInfo, path: string): Promise<string>;
}

export interface Step { engine: string; tool: string; from: string; to: string; fidelity: Fidelity; losses?: string }
export interface Plan { steps: Step[]; fidelity: Fidelity; cost: number }

// ---------- formats ----------

const ALIASES = new Map<string, string>();
for (const e of ENGINES) for (const f of e.formats) for (const x of [f.ext, ...(f.exts ?? [])]) if (!ALIASES.has(x)) ALIASES.set(x, f.ext);

/** The extension key for a file name, an extension or an alias: "Photo.JPEG" → "jpg". */
export function extKey(nameOrExt: string): string {
  const s = nameOrExt.trim().toLowerCase();
  const ext = s.includes(".") ? s.slice(s.lastIndexOf(".") + 1) : s;
  return ALIASES.get(ext) ?? ext;
}

const decl = (e: EngineInfo, ext: string) => e.formats.find((f) => f.ext === ext);

/** A label for an extension key, from the first engine that declares it. */
export function labelOf(ext: string): string {
  for (const e of ENGINES) { const f = decl(e, ext); if (f) return f.label; }
  return ext.toUpperCase();
}

/** Every extension some engine reads. */
export function readable(): string[] {
  return [...new Set(ENGINES.flatMap((e) => e.formats.filter((f) => f.read).map((f) => f.ext)))].sort();
}

// ---------- planning ----------

const COST: Record<Fidelity, number> = { lossless: 1, partial: 2, lossy: 3 };
const WORST: Fidelity[] = ["lossless", "partial", "lossy"];

/** One step per (engine, from, to) the engines declare. */
export function edges(): Map<string, Step[]> {
  const out = new Map<string, Step[]>();
  for (const e of ENGINES) {
    for (const from of e.formats.filter((f) => f.read)) {
      for (const t of e.targets) {
        const to = decl(e, t);
        if (!to?.write || to.ext === from.ext || (e.pairs && !e.pairs(from, to))) continue;
        const list = out.get(from.ext) ?? [];
        // The first engine (registry order) wins a step two engines can do.
        if (list.some((s) => s.to === to.ext)) continue;
        list.push({ engine: e.id, tool: e.name, from: from.ext, to: to.ext, ...e.fidelity(from, to) });
        out.set(from.ext, list);
      }
    }
  }
  return out;
}

let EDGES: Map<string, Step[]> | null = null;

/** The cheapest chains of engine steps from one extension to another, best first. */
export function plans(from: string, to: string, { maxSteps = 3, limit = 3 } = {}): Plan[] {
  EDGES ??= edges();
  const src = extKey(from), dst = extKey(to);
  const found: Plan[] = [];
  let queue: { at: string; steps: Step[]; cost: number }[] = [{ at: src, steps: [], cost: 0 }];
  while (queue.length && found.length < limit) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    if (cur.steps.length && cur.at === dst) {
      found.push({ steps: cur.steps, cost: cur.cost, fidelity: WORST[Math.max(...cur.steps.map((s) => WORST.indexOf(s.fidelity)))] });
      continue;
    }
    if (cur.steps.length >= maxSteps) continue;
    for (const s of EDGES.get(cur.at) ?? []) {
      if (s.to === src || cur.steps.some((p) => p.from === s.to)) continue;
      queue.push({ at: s.to, steps: [...cur.steps, s], cost: cur.cost + COST[s.fidelity] + 0.1 });
    }
  }
  return found;
}

/** Every extension reachable from this one, with its best plan, best first. */
export function targets(from: string, { maxSteps = 2 } = {}): { ext: string; label: string; plan: Plan }[] {
  EDGES ??= edges();
  const src = extKey(from);
  const best = new Map<string, Plan>();
  let frontier: Plan[] = [{ steps: [], fidelity: "lossless", cost: 0 }];
  for (let depth = 0; depth < maxSteps; depth++) {
    const next: Plan[] = [];
    for (const p of frontier) {
      const at = p.steps.at(-1)?.to ?? src;
      for (const s of EDGES.get(at) ?? []) {
        if (s.to === src || p.steps.some((x) => x.from === s.to)) continue;
        const steps = [...p.steps, s];
        const plan: Plan = { steps, cost: p.cost + COST[s.fidelity] + 0.1, fidelity: WORST[Math.max(...steps.map((x) => WORST.indexOf(x.fidelity)))] };
        const old = best.get(s.to);
        if (!old || plan.cost < old.cost) { best.set(s.to, plan); next.push(plan); }
      }
    }
    frontier = next;
  }
  // Most useful first: direct steps, in the order the engine lists its targets (PNG before BMP,
  // MP4 before FLAC), then cheapest.
  const rank = (p: Plan) => { const last = p.steps.at(-1)!; return engineById(last.engine)!.targets.indexOf(last.to); };
  return [...best.entries()].map(([ext, plan]) => ({ ext, label: labelOf(ext), plan }))
    .sort((a, b) => a.plan.steps.length - b.plan.steps.length || rank(a.plan) - rank(b.plan) || a.plan.cost - b.plan.cost || a.ext.localeCompare(b.ext));
}

/** Download size of the engines a plan needs, in bytes (from the pinned asset sizes). */
export function downloadSize(engineIds: Iterable<string>): number {
  let n = 0;
  for (const id of new Set(engineIds)) {
    const e = engineById(id);
    for (const a of e?.assets ?? []) n += PINS[assetKey(e!, a)]?.size ?? 0;
  }
  return n;
}

export const assetKey = (e: EngineInfo, path: string) => `${e.package.name}@${e.package.version}/${path}`;

/** CDN URLs for an asset, tried in order. */
export function assetUrls(e: EngineInfo, path: string): string[] {
  const p = `${e.package.name}@${e.package.version}/${path}`;
  return [`https://cdn.jsdelivr.net/npm/${p}`, `https://unpkg.com/${p}`];
}

// ---------- running ----------

const LOADERS: Record<string, () => Promise<{ load(host: Host): Promise<Runner> }>> = {
  imagemagick: () => import("./run/imagemagick.ts"),
  resvg: () => import("./run/resvg.ts"),
  ffmpeg: () => import("./run/ffmpeg.ts"),
  pandoc: () => import("./run/pandoc.ts"),
  "7zip": () => import("./run/sevenzip.ts"),
  gdal: () => import("./run/gdal.ts"),
  assimp: () => import("./run/assimp.ts"),
};

const loaded = new WeakMap<Host, Map<string, Promise<Runner>>>();

/** An engine, loaded once per host. */
export function loadEngine(id: string, host: Host): Promise<Runner> {
  let m = loaded.get(host);
  if (!m) loaded.set(host, (m = new Map()));
  let p = m.get(id);
  if (!p) {
    const loader = LOADERS[id];
    if (!loader) return Promise.reject(new Error(`unknown engine: ${id}`));
    p = loader().then((mod) => mod.load(host));
    p.catch(() => m!.delete(id)); // a failed download can be retried
    m.set(id, p);
  }
  return p;
}

export interface ConvertOptions {
  /** Force this plan (from plans()); default: the best one. */
  plan?: Plan;
  /** Called before each step, e.g. to tell the user an engine is being downloaded. */
  onStep?(step: Step, index: number, total: number): void;
}

const baseName = (name: string) => {
  const b = name.replace(/^.*[\\/]/, "");
  return b.includes(".") ? b.slice(0, b.lastIndexOf(".")) : b || "file";
};

/**
 * Convert a file to another format with the engines, step by step. Returns the output files:
 * one, except for targets written as several files (glTF and its .bin).
 */
export async function convert(file: EngineFile, to: string, host: Host, opts: ConvertOptions = {}): Promise<{ files: EngineFile[]; plan: Plan }> {
  const from = extKey(file.name);
  const plan = opts.plan ?? plans(from, to, { limit: 1 })[0];
  if (!plan) throw new Error(`no engine converts .${from} to .${extKey(to)}`);
  let current: EngineFile[] = [{ name: `${baseName(file.name)}.${from}`, data: file.data }];
  for (const [i, s] of plan.steps.entries()) {
    opts.onStep?.(s, i, plan.steps.length);
    const e = engineById(s.engine)!;
    const runner = await loadEngine(s.engine, host);
    const out = await runner.convert(current[0], decl(e, s.from)!, decl(e, s.to)!);
    if (!out.length || !out[0].data.length) throw new Error(`${e.name} produced no output for .${s.from} → .${s.to}`);
    current = out;
  }
  return { files: current, plan };
}

export const outputName = (input: string, ext: string) => `${baseName(input)}.${ext}`;
