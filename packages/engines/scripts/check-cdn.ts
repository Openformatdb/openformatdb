// Checks that each mirror serves every engine file with its pinned SHA-256, as browsers and the
// MCP server will fetch them. Needs the network: npm run check-cdn -w @openformatdb/engines.
import { createHash } from "node:crypto";
import { ENGINES, PINS, assetKey, assetUrls } from "../src/index.ts";

let missing = 0;
for (const e of ENGINES) {
  for (const a of e.assets) {
    const pin = PINS[assetKey(e, a)];
    let served = 0;
    for (const url of assetUrls(e, a)) {
      const t0 = Date.now();
      try {
        const res = await fetch(url);
        const cors = res.headers.get("access-control-allow-origin");
        const data = new Uint8Array(await res.arrayBuffer());
        const sha = createHash("sha256").update(data).digest("hex");
        const ok = res.ok && sha === pin.sha256 && cors === "*";
        if (ok) served++;
        console.log(`${ok ? "ok  " : "FAIL"} ${url} HTTP ${res.status}, ${data.length} bytes, CORS ${cors ?? "none"}, ${sha === pin.sha256 ? "checksum ok" : "checksum MISMATCH"}, ${Date.now() - t0} ms`);
      } catch (err: any) {
        console.log(`FAIL ${url}: ${err?.message ?? err}`);
      }
    }
    if (!served) { missing++; console.log(`MISSING ${assetKey(e, a)}: no mirror serves it`); }
  }
}
// A failing mirror is tolerated (the next one is tried); a file no mirror serves is not.
process.exit(missing ? 1 : 0);
