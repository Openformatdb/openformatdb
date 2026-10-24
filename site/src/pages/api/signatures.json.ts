// /api/signatures.json — {id: {signatures, priority_over}}: full PRONOM signatures and their
// priorities, for the "Identify a file" page and the MCP server's identify_file.
import { db } from "../../lib/data.ts";

export function GET() {
  const out: Record<string, { signatures: unknown[]; priority_over?: string[] }> = {};
  for (const r of db().records) {
    const ids = r.identifiers ?? {};
    if (ids.signatures?.length) out[r.id] = { signatures: ids.signatures, ...(ids.priority_over?.length ? { priority_over: ids.priority_over } : {}) };
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
}
