// /api/sources.json — aggregated sources with counts, licences and snapshot dates.
import { db } from "../../lib/data.ts";

export function GET() {
  const { sources, index } = db();
  const list = [...sources.values()].filter((s) => s.id !== "curated").map(({ id, ...s }) => ({ source: id, ...s, records: s.count }));
  return new Response(JSON.stringify({ sources: list, curated: sources.get("curated")!.count, total: index.length }), { headers: { "Content-Type": "application/json" } });
}
