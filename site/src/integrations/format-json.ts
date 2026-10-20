// SPEC.md "Static API": /api/formats/<id>.json — the full merged record.
// Written straight to dist/ when the build is done instead of going through an Astro endpoint
// (per-route overhead makes 15k JSON routes slow). In `astro dev` a middleware serves them.
import type { AstroIntegration } from "astro";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll, type FormatRecord } from "@openformatdb/core";

const ROUTE = /^\/api\/formats\/([a-z0-9.+-]+)\.json$/;
const formatJson = (r: FormatRecord) => JSON.stringify(r, null, 1);

export default function formatJsonIntegration(opts: { root: () => string }): AstroIntegration {
  return {
    name: "ofdb-format-json",
    hooks: {
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const m = req.url?.split("?")[0].match(ROUTE);
          if (!m) return next();
          const rec = loadAll(opts.root()).find((r) => r.id === m[1]);
          if (!rec) return next();
          res.setHeader("Content-Type", "application/json");
          res.end(formatJson(rec));
        });
      },
      "astro:build:done": ({ dir, logger }) => {
        const t0 = performance.now();
        const out = join(fileURLToPath(dir), "api/formats");
        mkdirSync(out, { recursive: true });
        const records = loadAll(opts.root());
        for (const r of records) writeFileSync(join(out, `${r.id}.json`), formatJson(r));
        logger.info(`wrote ${records.length} format JSON files in ${Math.round(performance.now() - t0)} ms`);
      },
    },
  };
}
