// OpenFormatDB website. Static build of the repository: see SPEC.md "Static API".
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import formatJson from "./src/integrations/format-json.ts";
import sitemap from "./src/integrations/sitemap.ts";

// The repository root. Core's own REPO_ROOT is derived from import.meta.url, which no longer
// points into packages/core once Vite has bundled it, so the site passes the root explicitly.
// OFDB_REPO (same variable as the MCP server) overrides it at build time.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = () => process.env.OFDB_REPO || repoRoot;

// FFmpeg's and 7-Zip's glue point at their .wasm with new URL(…, import.meta.url), which Vite would
// copy into the site (34 MB). Engines fetch their WebAssembly from a CDN instead (packages/engines),
// so the reference is neutralised.
const noEngineWasm = {
  name: "ofdb-no-engine-wasm",
  enforce: "pre",
  transform(code, id) {
    if (!/[\\/](@ffmpeg[\\/]core|7z-wasm)[\\/]/.test(id)) return null;
    return { code: code.replace(/new URL\((["'])[^"']+\.wasm\1,\s*import\.meta\.url\)/g, 'new URL("data:,")'), map: null };
  },
};

export default defineConfig({
  site: "https://openformatdb.org",
  trailingSlash: "ignore",
  build: { format: "directory", concurrency: 4 },
  integrations: [formatJson({ root: dataRoot }), sitemap({ site: "https://openformatdb.org" })],
  vite: {
    plugins: [noEngineWasm],
    define: { __OFDB_ROOT__: JSON.stringify(repoRoot) },
    // core exports TypeScript source; let Vite transpile and bundle it.
    ssr: { noExternal: ["@openformatdb/core", "@openformatdb/engines"] },
    // The engine worker loads each engine as its own chunk, on demand: that needs ES workers.
    worker: { format: "es", plugins: () => [noEngineWasm] },
    server: { fs: { allow: [repoRoot] } },
  },
});
