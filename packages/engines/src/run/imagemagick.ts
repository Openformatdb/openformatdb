// ImageMagick, compiled to WebAssembly by magick-wasm. Formats are always given explicitly:
// several (ICO, TGA) have no signature to detect them by.
import { engineById, type Host, type Runner } from "../index.ts";

/** Targets that keep every frame or page; the others take the first one. */
const MULTI = new Set(["gif", "webp", "apng", "tiff", "pdf", "mng", "ico"]);

let ready: Promise<typeof import("@imagemagick/magick-wasm")> | null = null;

export async function load(host: Host): Promise<Runner> {
  const info = engineById("imagemagick")!;
  ready ??= (async () => {
    const m = await import("@imagemagick/magick-wasm");
    await m.initializeImageMagick(await host.asset(info, info.assets[0]));
    return m;
  })();
  ready.catch(() => { ready = null; });
  const m = await ready;
  return {
    async convert(file, from, to) {
      const inFmt = (from.name ?? from.ext).toUpperCase() as any, outFmt = (to.name ?? to.ext).toUpperCase() as any;
      let out: Uint8Array | undefined;
      if (MULTI.has(to.ext)) {
        m.ImageMagick.readCollection(file.data, inFmt, (images: any) => {
          if (to.ext === "gif" || to.ext === "webp" || to.ext === "apng") images.coalesce();
          if (to.ext === "ico") for (const img of images) if (img.width > 256 || img.height > 256) img.resize(256, 256);
          images.write(outFmt, (d: Uint8Array) => { out = new Uint8Array(d); });
        });
      } else {
        m.ImageMagick.read(file.data, inFmt, (img: any) => img.write(outFmt, (d: Uint8Array) => { out = new Uint8Array(d); }));
      }
      if (!out) throw new Error(`ImageMagick wrote nothing for ${from.ext} → ${to.ext}`);
      return [{ name: file.name.replace(/\.[^.]*$/, "") + "." + to.ext, data: out }];
    },
  };
}
