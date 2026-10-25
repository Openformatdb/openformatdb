// Runs the engines off the main thread. Messages: { name, data, to, plan } in; progress, step,
// done (with the output files) or error out.
import { convert, type Plan } from "@openformatdb/engines";
import { browserHost } from "@openformatdb/engines/browser";

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
const host = browserHost({ onProgress: (e, _path, loaded, total) => post({ type: "progress", engine: e.name, loaded, total }) });

// addEventListener, not onmessage: gdal3.js assigns onmessage when it loads in a worker.
self.addEventListener("message", async (ev: MessageEvent<{ name: string; data: ArrayBuffer; to: string; plan?: Plan }>) => {
  const { name, data, to, plan } = ev.data;
  const t0 = performance.now();
  try {
    const { files } = await convert({ name, data: new Uint8Array(data) }, to, host, { plan, onStep: (step, index, total) => post({ type: "step", step, index, total }) });
    post({ type: "done", files, ms: performance.now() - t0 }, files.map((f) => f.data.buffer as ArrayBuffer));
  } catch (e: any) {
    post({ type: "error", message: String(e?.message ?? e) });
  }
});
