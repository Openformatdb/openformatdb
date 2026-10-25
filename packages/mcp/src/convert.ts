// convert_file: run the WebAssembly engines (packages/engines) on a file of this machine. The file
// never leaves it; an engine is downloaded once, on first use, pinned and checksummed.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, basename } from "node:path";
import { z } from "zod";
import { ENGINES, convert, downloadSize, extKey, labelOf, plans, readable, targets, outputName, type Host } from "@openformatdb/engines";
import { nodeHost } from "@openformatdb/engines/node";
import type { Context, Result, ToolDef } from "./tools.ts";

/** Engines load the whole file into WebAssembly memory (4 GB at most, shared with the engine). */
export const MAX_BYTES = 1024 ** 3;

let defaultHost: (Host & { downloaded: string[]; cacheDir: string }) | null = null;
const hostOf = (ctx: Context) => ctx.engineHost ?? (defaultHost ??= nodeHost());

const mb = (n: number) => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;

/** `name.ext`, or `name (2).ext`… : never overwrite a file. */
function freePath(path: string): string {
  if (!existsSync(path)) return path;
  const ext = extname(path), stem = path.slice(0, path.length - ext.length);
  for (let i = 2; ; i++) if (!existsSync(`${stem} (${i})${ext}`)) return `${stem} (${i})${ext}`;
}

export const convertFile: ToolDef = {
  name: "convert_file",
  title: "Convert a file locally",
  description:
    "Convert a file on this machine to another format with open-source converters compiled to WebAssembly: ImageMagick (images, raw photos), " +
    "resvg (SVG), FFmpeg (audio, video), Pandoc (documents, markup), 7-Zip (archives), GDAL (geodata), Assimp (3D). Nothing is uploaded. " +
    "Each engine is downloaded once on first use (2 to 59 MB, pinned versions, SHA-256 checked) into ~/.cache/openformatdb/engines. " +
    "Call with only `path` to list what the file can become; chains of two engines are planned automatically (svg → png → webp). " +
    "Writes next to the input unless `output` is given, and never overwrites a file.",
  shape: {
    path: z.string().max(4096).describe("File to convert (absolute, or relative to the server's working directory)"),
    to: z.string().max(40).optional().describe("Target extension: webp, mp3, docx, kml, glb, zip…"),
    output: z.string().max(4096).optional().describe("Output file path (default: next to the input, same name, new extension)"),
  },
  async run(ctx, a): Promise<Result> {
    const path = resolve(a.path);
    if (!existsSync(path) || !statSync(path).isFile()) return { ok: false, error: `No such file: ${path}` };
    const from = extKey(path);
    if (!a.to) {
      const host = hostOf(ctx);
      const list = targets(from);
      if (!list.length) return { ok: false, error: readable().includes(from) ? `Nothing converts .${from} further.` : `No engine reads .${from} files. Use identify_file to check the format, then find_conversion for other tools.` };
      return {
        ok: true, file: path, read_as: labelOf(from),
        targets: list.map((t) => ({
          to: t.ext, label: t.label, fidelity: t.plan.fidelity,
          steps: t.plan.steps.map((s) => `${s.tool}: .${s.from} → .${s.to}`),
          losses: t.plan.steps.map((s) => s.losses).filter(Boolean).join(" ") || undefined,
          first_use_download: mb(downloadSize(t.plan.steps.map((s) => s.engine))),
        })),
        cache: host.kind === "node" ? (host as any).cacheDir : undefined,
      };
    }
    const to = extKey(a.to);
    const plan = plans(from, to, { limit: 1 })[0];
    if (!plan) {
      const reachable = targets(from).map((t) => t.ext);
      return { ok: false, error: `No engine converts .${from} to .${to}.`, ...(reachable.length ? { possible_targets: reachable } : { hint: "find_conversion lists other open tools, to run yourself." }) };
    }
    const size = statSync(path).size;
    if (size > MAX_BYTES) return { ok: false, error: `The file is ${mb(size)}; the WebAssembly engines take up to ${mb(MAX_BYTES)}. Use the native tool (find_conversion gives the command).` };
    const host = hostOf(ctx);
    const before = [...((host as any).downloaded ?? [])];
    const t0 = Date.now();
    const { files } = await convert({ name: basename(path), data: new Uint8Array(readFileSync(path)) }, to, host, { plan });
    const first = a.output ? resolve(a.output) : join(dirname(path), outputName(path, to));
    const outputs = files.map((f, i) => {
      const target = freePath(i === 0 ? first : join(dirname(first), f.name));
      writeFileSync(target, f.data);
      return { path: target, bytes: f.data.length };
    });
    const downloaded = ((host as any).downloaded ?? []).filter((k: string) => !before.includes(k));
    return {
      ok: true,
      input: path,
      outputs,
      fidelity: plan.fidelity,
      steps: plan.steps.map((s) => ({ engine: s.engine, tool: s.tool, from: s.from, to: s.to, fidelity: s.fidelity, losses: s.losses })),
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      ...(downloaded.length ? { downloaded } : {}),
    };
  },
};

export const ENGINE_NAMES = ENGINES.map((e) => e.name);
