// /sitemap.xml and /robots.txt, written after the build from the list of rendered pages.
// One sitemap file holds up to 50,000 URLs; beyond that we write an index of chunks.
import type { AstroIntegration } from "astro";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX = 45_000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const urlset = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join("\n") + `\n</urlset>\n`;

export default function sitemap(opts: { site: string }): AstroIntegration {
  return {
    name: "ofdb-sitemap",
    hooks: {
      "astro:build:done": ({ dir, pages, logger }) => {
        const out = fileURLToPath(dir);
        const base = opts.site.replace(/\/$/, "");
        const urls = pages
          .map((p) => `/${p.pathname}`.replace(/\/+$/, "/"))
          .filter((p) => p !== "/404/" && !p.startsWith("/api/"))
          .sort()
          .map((p) => base + p);
        if (urls.length <= MAX) writeFileSync(join(out, "sitemap.xml"), urlset(urls));
        else {
          const parts: string[] = [];
          for (let i = 0; i < urls.length; i += MAX) {
            const name = `sitemap-${parts.length + 1}.xml`;
            writeFileSync(join(out, name), urlset(urls.slice(i, i + MAX)));
            parts.push(`${base}/${name}`);
          }
          writeFileSync(join(out, "sitemap.xml"),
            `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
            parts.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join("\n") + `\n</sitemapindex>\n`);
        }
        writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
        logger.info(`sitemap: ${urls.length} URLs`);
      },
    },
  };
}
