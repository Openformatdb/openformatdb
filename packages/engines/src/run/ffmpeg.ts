// FFmpeg, from ffmpeg.wasm's single-threaded core (no SharedArrayBuffer needed, so it runs on
// GitHub Pages and in Node). The core is built for browsers: in Node it needs a `self`.
import { engineById, type Host, type Runner } from "../index.ts";

/** Output options per target: codecs every player reads. */
export const ARGS: Record<string, string[]> = {
  mp4: ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"],
  mov: ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac"],
  mkv: ["-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac"],
  webm: ["-c:v", "libvpx", "-b:v", "1M", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libvorbis"],
  avi: ["-c:v", "mpeg4", "-q:v", "4", "-c:a", "libmp3lame"],
  gif: ["-vf", "fps=10,scale='min(480,iw)':-2:flags=lanczos", "-an"],
  mp3: ["-vn", "-c:a", "libmp3lame", "-q:a", "2"],
  wav: ["-vn"],
  flac: ["-vn", "-c:a", "flac"],
  ogg: ["-vn", "-c:a", "libvorbis", "-q:a", "5"],
  opus: ["-vn", "-c:a", "libopus", "-b:a", "128k"],
  m4a: ["-vn", "-c:a", "aac", "-b:a", "192k"],
};

let ready: Promise<any> | null = null;

export async function load(host: Host): Promise<Runner> {
  const info = engineById("ffmpeg")!;
  ready ??= (async () => {
    const g = globalThis as any;
    const shim = host.kind === "node" && typeof g.self === "undefined";
    if (shim) g.self = { location: { href: import.meta.url } };
    try {
      const { default: create } = await import("@ffmpeg/core");
      return await create({ wasmBinary: await host.asset(info, info.assets[0]) });
    } finally {
      if (shim) delete g.self;
    }
  })();
  ready.catch(() => { ready = null; });
  const core = await ready;
  let n = 0;
  return {
    async convert(file, from, to) {
      const id = ++n, input = `in${id}.${from.ext}`, output = `out${id}.${to.ext}`;
      const log: string[] = [];
      core.setLogger((m: { message: string }) => { log.push(m.message); if (log.length > 40) log.shift(); });
      core.FS.writeFile(input, file.data);
      try {
        core.reset();
        try { core.exec("-i", input, ...(ARGS[to.ext] ?? []), output); } catch { /* exit() throws; the output tells */ }
        let data: Uint8Array;
        try { data = core.FS.readFile(output); } catch { throw new Error(`FFmpeg failed: ${log.filter((l) => !/^\s*(frame|size)=/.test(l)).slice(-4).join(" | ")}`); }
        if (!data.length) throw new Error(`FFmpeg wrote an empty file: ${log.slice(-3).join(" | ")}`);
        return [{ name: file.name.replace(/\.[^.]*$/, "") + "." + to.ext, data: new Uint8Array(data) }];
      } finally {
        for (const f of [input, output]) try { core.FS.unlink(f); } catch { /* not created */ }
      }
    },
  };
}
