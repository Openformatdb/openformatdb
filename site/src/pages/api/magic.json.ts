// /api/magic.json — {id: [[offset, hex], …]} for every format with a signature: what the
// "Identify a file" page and the MCP server's identify_file need, nothing more.
import { db } from "../../lib/data.ts";

export function GET() {
  const out: Record<string, [number, string][]> = {};
  for (const r of db().records) if (r.identifiers?.magic?.length) out[r.id] = r.identifiers.magic.map((m) => [m.offset, m.hex]);
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
}
