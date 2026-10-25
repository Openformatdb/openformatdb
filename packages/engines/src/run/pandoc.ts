// Pandoc, the official WebAssembly (WASI) build, through pandoc-wasm's wrapper (vendored: the
// package does not export it).
import { engineById, type Host, type Runner } from "../index.ts";

let ready: Promise<any> | null = null;

export async function load(host: Host): Promise<Runner> {
  const info = engineById("pandoc")!;
  ready ??= (async () => {
    const { createPandocInstance } = await import("../vendor/pandoc-core.js");
    return createPandocInstance(await host.asset(info, info.assets[0]));
  })();
  ready.catch(() => { ready = null; });
  const pandoc = await ready;
  return {
    async convert(file, from, to) {
      const input = `input.${from.ext}`, output = `output.${to.ext}`;
      const res = await pandoc.convert(
        { from: from.name ?? from.ext, to: to.name ?? to.ext, "input-files": [input], "output-file": output, standalone: true, "embed-resources": to.ext === "html" },
        null,
        { [input]: new Blob([file.data as BlobPart]) },
      );
      const out = res.files?.[output];
      const data = out ? new Uint8Array(await (out instanceof Blob ? out.arrayBuffer() : new TextEncoder().encode(String(out)).buffer)) : null;
      if (!data?.length) throw new Error(`Pandoc failed: ${String(res.stderr || "no output").trim().slice(0, 400)}`);
      return [{ name: file.name.replace(/\.[^.]*$/, "") + "." + to.ext, data }];
    },
  };
}
