// npm run import -- <source>|all
// Fetch each source, validate and dedupe its records, write data/imported/<source>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "@openformatdb/core";
import { SOURCES, finalize, snapshot, stringifySnapshot } from "./index.ts";

const arg = process.argv[2];
const names = SOURCES.map((s) => s.source);
if (!arg || (arg !== "all" && !names.includes(arg))) {
  console.error(`usage: npm run import -- <${names.join("|")}|all>`);
  process.exit(2);
}

const outDir = join(REPO_ROOT, "data/imported");
mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const src of SOURCES.filter((s) => arg === "all" || s.source === arg)) {
  const started = new Date();
  try {
    const f = finalize(await src.fetch());
    const file = join(outDir, `${src.source}.json`);
    // Same records as the current snapshot: keep it, so a refresh with no news changes no file.
    const unchanged = existsSync(file) && JSON.stringify(JSON.parse(readFileSync(file, "utf8")).records) === JSON.stringify(f.records);
    if (!unchanged) writeFileSync(file, stringifySnapshot(snapshot(src, f.records, started)));
    console.log(`${src.source}: ${f.input} fetched, ${f.invalid} invalid dropped, ${f.merged} merged duplicates, ${f.records.length} ${unchanged ? "unchanged" : "written"}`);
    for (const e of f.errors) console.log(`  invalid ${e}`);
  } catch (e) {
    failed++;
    const cause = (e as any)?.cause; // fetch() puts the network error (DNS, TLS, refused) here
    console.error(`${src.source}: FAILED, snapshot left unchanged: ${(e as Error).message}${cause ? ` (${cause.code ?? ""} ${cause.message ?? cause})` : ""}`);
  }
}
process.exit(failed ? 1 : 0);
