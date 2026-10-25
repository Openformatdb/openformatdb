// 7-Zip (7zz) compiled to WebAssembly: extract everything, repack in the target format.
import { engineById, type Host, type Runner } from "../index.ts";

const TYPE: Record<string, string> = { zip: "zip", "7z": "7z", tar: "tar" };

export async function load(host: Host): Promise<Runner> {
  const info = engineById("7zip")!;
  const wasm = await host.asset(info, info.assets[0]);
  const { default: SevenZip } = await import("7z-wasm/7zz.es6.js");
  return {
    async convert(file, from, to) {
      // A fresh instance per file: 7zz is a command-line program and keeps state between runs.
      const log: string[] = [];
      const z = await SevenZip({ wasmBinary: wasm, print: (s: string) => log.push(s), printErr: (s: string) => log.push(s) });
      const input = `/in.${from.ext}`;
      z.FS.writeFile(input, file.data);
      z.FS.mkdir("/x");
      const run = (args: string[]) => { try { return z.callMain(args); } catch (e: any) { return e?.status ?? 1; } };
      const code = run(["x", input, "-o/x", "-y", "-bd"]);
      if (code > 1 || z.FS.readdir("/x").length <= 2) throw new Error(`7-Zip could not extract it: ${log.slice(-3).join(" | ")}`);
      z.FS.chdir("/x");
      const output = `/out.${to.ext}`;
      const code2 = run(["a", `-t${TYPE[to.ext]}`, output, "*", "-r", "-bd"]);
      if (code2 > 1) throw new Error(`7-Zip could not write .${to.ext}: ${log.slice(-3).join(" | ")}`);
      return [{ name: file.name.replace(/\.[^.]*$/, "") + "." + to.ext, data: new Uint8Array(z.FS.readFile(output)) }];
    },
  };
}
