// Validate every curated record and snapshot; exit 1 on any error.
import { loadAll, loadCurated, loadSnapshots, validate, curatedPath, REPO_ROOT } from "./index.ts";
import { relative } from "node:path";

let errors = 0;
const curated = loadCurated();
for (const { file, record } of curated) {
  const errs = validate(record);
  if (relative(REPO_ROOT, curatedPath(record.id)) !== file) errs.push(`/id "${record.id}" does not match file path`);
  for (const e of errs) console.error(`${file}: ${e}`);
  errors += errs.length;
}
let imported = 0;
for (const snap of loadSnapshots()) {
  const ids = new Set<string>();
  for (const r of snap.records) {
    const errs = validate(r);
    if (ids.has(r.id)) errs.push(`duplicate id in snapshot`);
    ids.add(r.id);
    for (const e of errs.slice(0, 3)) console.error(`imported/${snap.source} ${r.id}: ${e}`);
    errors += errs.length;
  }
  imported += snap.records.length;
}
// Conversion targets name records by id; ids move when a source is refreshed alone.
const ids = new Set(loadAll().map((r) => r.id));
const dangling = loadSnapshots().flatMap((s) => s.records.flatMap((r) => (r.conversions ?? []).filter((c) => !ids.has(c.to)).map((c) => `${s.source} ${r.id} → ${c.to}`)));
if (dangling.length) console.warn(`warning: ${dangling.length} conversion(s) point to unknown ids (re-run the converters import), e.g. ${dangling.slice(0, 3).join(", ")}`);
console.log(`${curated.length} curated, ${imported} imported, ${errors} error(s)`);
process.exit(errors ? 1 : 0);
