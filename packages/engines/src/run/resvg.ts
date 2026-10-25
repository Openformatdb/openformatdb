// resvg renders SVG to PNG (ImageMagick's WebAssembly build has no SVG reader).
import { engineById, type Host, type Runner } from "../index.ts";

let ready: Promise<typeof import("@resvg/resvg-wasm")> | null = null;

export async function load(host: Host): Promise<Runner> {
  const info = engineById("resvg")!;
  ready ??= (async () => {
    const m = await import("@resvg/resvg-wasm");
    await m.initWasm(await host.asset(info, info.assets[0]));
    return m;
  })();
  ready.catch(() => { ready = null; });
  const m = await ready;
  return {
    async convert(file) {
      const svg = new TextDecoder().decode(file.data);
      const png = new m.Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
      return [{ name: file.name.replace(/\.[^.]*$/, "") + ".png", data: new Uint8Array(png) }];
    },
  };
}
