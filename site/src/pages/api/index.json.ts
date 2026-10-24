// SPEC.md "Static API": /api/index.json — one IndexEntry per format (core toIndexEntry), without
// signatures (they are in /api/magic.json and /api/signatures.json). Consumed by the MCP server and the search island.
import { db } from "../../lib/data.ts";

export function GET() {
  const slim = db().index.map(({ identifiers: { magic: _m, signatures: _s, priority_over: _p, ...ids }, ...e }) => ({ ...e, identifiers: ids }));
  return new Response(JSON.stringify(slim), { headers: { "Content-Type": "application/json" } });
}
