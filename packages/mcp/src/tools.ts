// OpenFormatDB agent tools: identify a file, look up and search formats, list sources.
// Pure functions over a Backend; server.ts exposes them over MCP.
import { z } from "zod";
import {
  SCHEMA, STATUSES, identify, search, liveClaims, effectiveStatus, today,
  type FormatRecord, type Status, type Tool,
} from "@openformatdb/core";
import type { Backend } from "./backend.ts";
import { claimFormat, publishFindings } from "./write.ts";

const CATEGORIES: string[] = SCHEMA.properties.category.enum;
const en = (values: string[]) => z.enum(values as [string, ...string[]]);

export interface Context { backend: Backend; today?: string }
export type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string; [k: string]: unknown };

const fail = (error: string, extra: Record<string, unknown> = {}): Result => ({ ok: false, error, ...extra });

/** Tools shown per record: open source first, then writers, then by name. */
export const MAX_TOOLS = 25;

function rankTools(tools: Tool[]): Tool[] {
  const w = (t: Tool) => (t.open_source ? 4 : 0) + (t.writes ? 2 : 0) + (t.via ? 0 : 1);
  return [...tools].sort((a, b) => w(b) - w(a) || a.name.localeCompare(b.name));
}

const names = (ts: Tool[], n = 5) => ts.slice(0, n).map((t) => t.name).join(", ") + (ts.length > n ? ` and ${ts.length - n} more` : "");

/** What an agent should do with this record, in one paragraph. */
export function advice(r: FormatRecord, on: string): string {
  const tools = rankTools(r.tools ?? []);
  const open = tools.filter((t) => t.open_source);
  const writers = open.filter((t) => t.writes);
  const inherited = tools.length > 0 && tools.every((t) => t.via);
  const parts: string[] = [];
  const claims = liveClaims(r, on);
  if (claims.length) parts.push(`Someone is working on it: ${claims.map((c) => `${c.who} (scope: ${c.scope}) until ${c.expires}, contact ${c.contact}`).join("; ")}. Coordinate before starting.`);
  if (writers.length) parts.push(`Open-source software reads and writes it: ${names(writers)}. Use it rather than writing a parser.`);
  else if (open.length) parts.push(`Open-source software reads it: ${names(open)}. Use it to open or convert the file.`);
  else if (tools.length) parts.push(`Only software of unknown or closed licence is listed: ${names(tools)}.`);
  if (inherited) parts.push(`The software is listed for the family (${tools[0].via}), not for this version: check it handles this version.`);
  if (r.parsers?.length) parts.push(`Machine-readable grammars exist: ${r.parsers.map((p) => `${p.engine} (${p.url})`).join(", ")}.`);
  if (r.spec) parts.push(`Specification: ${r.spec.availability}${r.spec.url ? ` (${r.spec.url})` : ""}.`);
  if (!tools.length && !r.parsers?.length && !r.spec) {
    parts.push(r.family
      ? `Nothing open is recorded for this version; look up its family ${r.family}.`
      : "Nothing open is recorded. Check the linked sources (projects) for documentation before reverse engineering it.");
  }
  return parts.join(" ");
}

/** A record as returned to agents: tools ranked and capped, family and versions summarised. */
function present(backend: Backend, r: FormatRecord, on: string) {
  const tools = rankTools(r.tools ?? []);
  const family = r.family ? backend.get(r.family) : null;
  const versions = backend.records().filter((x) => x.family === r.id);
  return {
    ...r,
    status: effectiveStatus(r, on),
    tools: tools.slice(0, MAX_TOOLS),
    tools_total: tools.length,
    tools_open_source: tools.filter((t) => t.open_source).length,
    ...(family ? { family_record: { id: family.id, name: family.name, status: effectiveStatus(family, on), tools: family.tools?.length ?? 0 } } : {}),
    ...(versions.length ? { versions: versions.slice(0, 50).map((v) => ({ id: v.id, name: v.name, version: v.version })), versions_total: versions.length } : {}),
    live_claims: liveClaims(r, on),
    advice: advice(r, on),
  };
}

// ---------- tools ----------

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  shape: z.ZodRawShape;
  run(ctx: Context, args: any): Result;
}

const identifyFile: ToolDef = {
  name: "identify_file",
  title: "Identify a file",
  description:
    "Candidate formats for a file, ranked: a signature match beats a MIME type, which beats an extension. " +
    "Read the first bytes yourself (e.g. `xxd -p -l 64 file`) and pass them as magic_hex; the file never leaves the machine. " +
    "Then call lookup_format on the best candidate.",
  shape: {
    magic_hex: z.string().max(4096).optional().describe("First bytes of the file as hex, spaces allowed (64 bytes is usually enough)"),
    extension: z.string().max(200).optional().describe("File name or extension, e.g. report.doc or .doc"),
    mime: z.string().max(200).optional().describe("MIME type if known, e.g. from `file --mime-type`"),
    limit: z.number().int().min(1).max(50).optional(),
  },
  run(ctx, a) {
    if (!a.magic_hex && !a.extension && !a.mime) return fail("Give at least one of magic_hex, extension or mime.");
    const on = ctx.today ?? today();
    const candidates = identify(ctx.backend.index(on), a, a.limit ?? 10);
    const bySignature = candidates.some((c) => c.matched.some((m) => m.startsWith("signature")));
    const tied = candidates.filter((c) => Math.floor(c.score) === Math.floor(candidates[0]?.score ?? -1)).length;
    return {
      ok: true,
      found: candidates.length > 0,
      candidates,
      note: !candidates.length
        ? "No known format matches. Try more bytes, or search_formats with what you know about the file."
        : a.magic_hex && !bySignature
          ? "No signature matched: candidates come from the extension or MIME type only and may be wrong (extensions collide)."
          : tied > 1
            ? `${tied} candidates match equally (signatures here are fixed prefixes, e.g. PNG and APNG share theirs): ` +
              "compare them with lookup_format, or check further into the file."
            : undefined,
    };
  },
};

const lookupFormat: ToolDef = {
  name: "lookup_format",
  title: "Look up a format",
  description:
    "Full record of a format: identifiers, which software reads or writes it (open source first), grammars, specification, " +
    "family and versions, live claims, and advice on what to do next. Find it by id, PRONOM PUID, Wikidata QID, or MIME type.",
  shape: {
    id: z.string().max(200).optional().describe("OpenFormatDB id, from identify_file or search_formats"),
    puid: z.string().max(40).optional().describe("PRONOM id, e.g. fmt/13"),
    wikidata: z.string().max(40).optional().describe("Wikidata QID, e.g. Q178051"),
    mime: z.string().max(200).optional(),
  },
  run(ctx, a) {
    const on = ctx.today ?? today();
    const b = ctx.backend;
    let matches: FormatRecord[] = [];
    if (a.id) matches = [b.get(a.id)].filter((x): x is FormatRecord => !!x);
    else if (a.puid) matches = b.records().filter((r) => r.identifiers?.puid?.includes(a.puid.trim()));
    else if (a.wikidata) matches = b.records().filter((r) => r.identifiers?.wikidata?.includes(a.wikidata.trim().toUpperCase()));
    else if (a.mime) matches = b.records().filter((r) => r.identifiers?.mime?.includes(a.mime.trim().toLowerCase()));
    else return fail("Give one of id, puid, wikidata or mime.");
    if (!matches.length) return { ok: true, found: false, note: "Nothing known under this identifier. Try search_formats or identify_file." };
    // A version holds one PUID, its family several: the most specific record first.
    matches.sort((x, y) => (x.identifiers?.puid?.length ?? 0) - (y.identifiers?.puid?.length ?? 0) || x.id.localeCompare(y.id));
    const [best, ...others] = matches;
    return {
      ok: true,
      found: true,
      ...present(b, best, on),
      ...(others.length ? { other_matches: others.slice(0, 20).map((r) => ({ id: r.id, name: r.name, version: r.version })) } : {}),
    };
  },
};

const searchFormats: ToolDef = {
  name: "search_formats",
  title: "Search formats",
  description: "Ranked formats matching a name, alias, extension, MIME type, PUID or QID, optionally by category or status.",
  shape: {
    query: z.string().max(200),
    category: en(CATEGORIES).optional(),
    status: en(STATUSES).optional().describe("unknown, in-progress, partial, readable (open code reads it), writable (open code writes it)"),
    limit: z.number().int().min(1).max(100).optional(),
  },
  run(ctx, a) {
    const hits = search(ctx.backend.index(ctx.today ?? today()), a.query, { category: a.category, status: a.status as Status | undefined, limit: a.limit ?? 20 });
    return {
      ok: true,
      count: hits.length,
      results: hits.map((h) => ({
        id: h.id, name: h.name, ...(h.version ? { version: h.version } : {}), ...(h.family ? { family: h.family } : {}),
        category: h.category, status: h.status, extensions: h.identifiers.extensions ?? [], tools: h.tools, open_tools: h.open_tools,
      })),
    };
  },
};

const listSources: ToolDef = {
  name: "list_sources",
  title: "List sources",
  description: "Sources aggregated in OpenFormatDB, with record counts, licences and snapshot dates.",
  shape: {},
  run(ctx) {
    return { ok: true, ...ctx.backend.sources() };
  },
};

export const TOOLS: ToolDef[] = [identifyFile, lookupFormat, searchFormats, listSources, claimFormat, publishFindings];

export const READ_ONLY = new Set(["identify_file", "lookup_format", "search_formats", "list_sources"]);
