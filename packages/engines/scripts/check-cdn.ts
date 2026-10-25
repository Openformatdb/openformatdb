// Checks that each mirror serves every engine file with its pinned SHA-256, as browsers and the
// MCP server will fetch them. Needs the network: npm run check-cdn -w @openformatdb/engines.
import { createHash } from "node:crypto";
import { ENGINES, PINS, assetKey, assetUrls } from "../src/index.ts";

let bad = 0;
for (const e of ENGINES) {
  for (const a of e.assets) {
    const pin = PINS[assetKey(e, a)];
    for (const url of assetUrls(e, a)) {
      const t0 = Date.now();
      try {
        const res = await fetch(url);
        const cors = res.headers.get("access-control-allow-origin");
        const data = new Uint8Array(await res.arrayBuffer());
        const sha = createHash("sha256").update(data).digest("hex");
        const ok = res.ok && sha === pin.sha256 && cors === "*";
        if (!ok) bad++;
        console.log(`${ok ? "ok  " : "FAIL"} ${url} HTTP ${res.status}, ${data.length} bytes, CORS ${cors ?? "none"}, ${sha === pin.sha256 ? "checksum ok" : "checksum MISMATCH"}, ${Date.now() - t0} ms`);
      } catch (err: any) {
        bad++;
        console.log(`FAIL ${url}: ${err?.message ?? err}`);
      }
    }
  }
}
// Every file needs at least one working mirror; report all failures anyway.
process.exit(bad ? 1 : 0);
