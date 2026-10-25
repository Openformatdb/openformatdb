// Assimp (assimpjs): imports about 40 3D formats, exports glTF 2.
import { engineById, type Host, type Runner } from "../index.ts";

let ready: Promise<any> | null = null;

export async function load(host: Host): Promise<Runner> {
  const info = engineById("assimp")!;
  ready ??= (async () => {
    const { default: assimpjs } = await import("assimpjs");
    return assimpjs({ wasmBinary: await host.asset(info, info.assets[0]) });
  })();
  ready.catch(() => { ready = null; });
  const ajs = await ready;
  return {
    async convert(file, from, to) {
      const list = new ajs.FileList();
      list.AddFile(`input.${from.ext}`, file.data);
      const res = ajs.ConvertFileList(list, to.ext === "glb" ? "glb2" : "gltf2");
      if (!res.IsSuccess() || !res.FileCount()) throw new Error(`Assimp could not read it as ${from.label}: ${res.GetErrorCode?.() ?? "import failed"}`);
      const base = file.name.replace(/\.[^.]*$/, "");
      const out = [];
      for (let i = 0; i < res.FileCount(); i++) {
        const f = res.GetFile(i);
        const path: string = f.GetPath(); // result.gltf, result.bin
        let data = new Uint8Array(f.GetContent());
        if (path.endsWith(".gltf")) data = new TextEncoder().encode(new TextDecoder().decode(data).replaceAll('"result.bin"', JSON.stringify(`${base}.bin`)));
        out.push({ name: base + path.slice(path.indexOf(".")), data });
      }
      return out;
    },
  };
}
