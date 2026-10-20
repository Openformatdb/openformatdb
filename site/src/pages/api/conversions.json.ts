// /api/conversions.json — {id: [conversion, …]} including those inherited from a family (`via`):
// the graph core's conversionPaths searches, for the Convert page and the MCP server.
import { db } from "../../lib/data.ts";

export function GET() {
  const out: Record<string, unknown[]> = {};
  for (const r of db().records) if (r.conversions?.length) out[r.id] = r.conversions;
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
}
