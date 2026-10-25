// OpenFormatDB agent tools: identify a file, look up and search formats, list sources.
// Pure functions over a Backend; server.ts exposes them over MCP.
import { z } from "zod";
import {
  SCHEMA, STATUSES, identify, search, liveClaims, effectiveStatus, today, conversionPathsBetween, formatsForExtension,
  type FormatRecord, type Status, type Tool,
} from "@openformatdb/core";
import type { Backend } from "./backend.ts";
import { claimFormat, publishFindings } from "./write.ts";
import { convertFile } from "./convert.ts";
import type { Host } from "@openformatdb/engines";

const CATEGORIES: string[] = SCHEMA.properties.category.enum;
const en = (values: string[]) => z.enum(values as [string, ...string[]]);

export interface Context { backend: Backend; today?: string; /** Where convert_file gets its engines (tests: local packages only). */ engineHost?: Host }
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
async function present(backend: Backend, r: FormatRecord, on: string) {
  const tools = rankTools(r.tools ?? []);
  const family = r.family ? await backend.get(r.family) : null;
  const versions = (await backend.records()).filter((x) => x.family === r.id);
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
  run(ctx: Context, args: any): Promise<Result>;
}

const identifyFile: ToolDef = {
  name: "identify_file",
  title: "Identify a file",
  description:
    "Candidate formats for a file, ranked: a signature match beats a MIME type, which beats an extension. " +
    "Read the bytes yourself and pass them as hex; the file never leaves the machine: magic_hex = the first bytes (`xxd -p -l 1024 file`), " +
    "tail_hex = the last bytes (`tail -c 512 file | xxd -p`) so end-of-file signatures can be checked, whole_file when magic_hex is the entire file. " +
    "Full PRONOM signatures and their priorities decide between close formats (PNG 1.0 / 1.2 / APNG). " +
    "Then call lookup_format on the best candidate.",
  shape: {
    magic_hex: z.string().max(20000).optional().describe("First bytes of the file as hex, spaces allowed (1024 bytes recommended)"),
    tail_hex: z.string().max(4096).optional().describe("Last bytes of the file as hex (512 bytes recommended)"),
    whole_file: z.boolean().optional().describe("magic_hex holds the entire file"),
    extension: z.string().max(200).optional().describe("File name or extension, e.g. report.doc or .doc"),
    mime: z.string().max(200).optional().describe("MIME type if known, e.g. from `file --mime-type`"),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async run(ctx, a) {
    if (!a.magic_hex && !a.extension && !a.mime) return fail("Give at least one of magic_hex, extension or mime.");
    const on = ctx.today ?? today();
    const candidates = identify(await ctx.backend.index(on), a, a.limit ?? 10);
    const bySignature = candidates.some((c) => c.matched.some((m) => m.startsWith("signature") || m === "full signature"));
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
            ? `${tied} candidates match equally: ` + (a.tail_hex ? "compare them with lookup_format." : "pass tail_hex (the last 512 bytes) so end-of-file signatures can tell them apart, or compare them with lookup_format.")
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
  async run(ctx, a) {
    const on = ctx.today ?? today();
    const b = ctx.backend;
    let matches: FormatRecord[] = [];
    if (a.id) matches = [await b.get(a.id)].filter((x): x is FormatRecord => !!x);
    else if (a.puid) matches = (await b.records()).filter((r) => r.identifiers?.puid?.includes(a.puid.trim()));
    else if (a.wikidata) matches = (await b.records()).filter((r) => r.identifiers?.wikidata?.includes(a.wikidata.trim().toUpperCase()));
    else if (a.mime) matches = (await b.records()).filter((r) => r.identifiers?.mime?.includes(a.mime.trim().toLowerCase()));
    else return fail("Give one of id, puid, wikidata or mime.");
    if (!matches.length) return { ok: true, found: false, note: "Nothing known under this identifier. Try search_formats or identify_file." };
    // A version holds one PUID, its family several: the most specific record first.
    matches.sort((x, y) => (x.identifiers?.puid?.length ?? 0) - (y.identifiers?.puid?.length ?? 0) || x.id.localeCompare(y.id));
    const [best, ...others] = matches;
    return {
      ok: true,
      found: true,
      ...(await present(b, (await b.get(best.id)) ?? best, on)),
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
  async run(ctx, a) {
    const hits = search(await ctx.backend.index(ctx.today ?? today()), a.query, { category: a.category, status: a.status as Status | undefined, limit: a.limit ?? 20 });
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

/** A format given as an id, or every format an extension / file name may mean (most handled first). */
async function resolveFormats(backend: Backend, s: string, on: string): Promise<FormatRecord[]> {
  const direct = await backend.get(s.trim());
  if (direct) return [direct];
  const records = new Map((await backend.records()).map((r) => [r.id, r]));
  return formatsForExtension(await backend.index(on), s).map((e) => records.get(e.id)!).filter(Boolean);
}

const findConversion: ToolDef = {
  name: "find_conversion",
  title: "Find a conversion",
  description:
    "How to convert a file from one format to another with open tools: the cheapest chains (lossless first), each step with " +
    "its tool, command and what is lost. Formats as ids or extensions (\"docx\", \"report.wpd\"). Without `to`, lists the direct conversions.",
  shape: {
    from: z.string().max(200).describe("Source format id, extension or file name"),
    to: z.string().max(200).optional().describe("Target format id, extension or file name"),
    max_steps: z.number().int().min(1).max(4).optional().describe("Longest chain (default 3)"),
  },
  async run(ctx, a) {
    const on = ctx.today ?? today();
    const b = ctx.backend;
    const names = new Map((await b.records()).map((r) => [r.id, r]));
    const srcs = await resolveFormats(b, a.from, on);
    if (!srcs.length) return fail(`Unknown source format "${a.from}". Try identify_file or search_formats.`);
    // Without a target, the direct conversions of the first candidate that has any.
    const src = srcs.find((r) => r.conversions?.length) ?? srcs[0];
    const from = { id: src.id, name: src.name, ...(src.version ? { version: src.version } : {}) };
    if (!a.to) {
      const direct = [...(src.conversions ?? [])].sort((x, y) => ["lossless", "partial", "lossy"].indexOf(x.fidelity) - ["lossless", "partial", "lossy"].indexOf(y.fidelity));
      return {
        ok: true, from, count: direct.length,
        conversions: direct.map((c) => ({ ...c, to_name: names.get(c.to)?.name })),
        note: direct.length ? undefined : "No conversion recorded from this format. lookup_format lists the software that reads it; one of them may export it.",
      };
    }
    const dsts = await resolveFormats(b, a.to, on);
    if (!dsts.length) return fail(`Unknown target format "${a.to}". Try search_formats.`);
    if (srcs.length === 1 && dsts.length === 1 && srcs[0].id === dsts[0].id) return fail("Source and target are the same format.");
    const paths = conversionPathsBetween(await b.records(), srcs.map((r) => r.id), dsts.map((r) => r.id), { maxSteps: a.max_steps ?? 3 });
    const pick = (id: string | undefined, list: FormatRecord[]) => names.get(id ?? "") ?? list[0];
    const s0 = pick(paths[0]?.steps[0].from, srcs), d0 = pick(paths[0]?.steps.at(-1)?.to, dsts);
    return {
      ok: true,
      from: { id: s0.id, name: s0.name, ...(s0.version ? { version: s0.version } : {}) },
      to: { id: d0.id, name: d0.name, ...(d0.version ? { version: d0.version } : {}) },
      found: paths.length > 0,
      paths: paths.map((p) => ({ fidelity: p.fidelity, steps: p.steps.map((st) => ({ ...st, to_name: names.get(st.to)?.name })) })),
      note: [
        paths.some((p) => p.steps.some((st) => st.engine)) ? "Steps with an `engine` run on this machine with convert_file (pass the file path and the target extension)." : "",
        paths.length
          ? (srcs.length > 1 || dsts.length > 1 ? "An extension can mean several formats: paths were searched from and to each of them; pass ids to be exact." : "")
          : "No chain of recorded conversions links them. lookup_format on both lists the software that reads or writes each.",
      ].filter(Boolean).join(" ") || undefined,
    };
  },
};

const listSources: ToolDef = {
  name: "list_sources",
  title: "List sources",
  description: "Sources aggregated in OpenFormatDB, with record counts, licences and snapshot dates.",
  shape: {},
  async run(ctx) {
    return { ok: true, ...(await ctx.backend.sources()) };
  },
};

export const TOOLS: ToolDef[] = [identifyFile, lookupFormat, searchFormats, findConversion, convertFile, listSources, claimFormat, publishFindings];

export const READ_ONLY = new Set(["identify_file", "lookup_format", "search_formats", "find_conversion", "list_sources"]);

/** Tools that reach the network: convert_file downloads an engine on first use. */
export const OPEN_WORLD = new Set(["convert_file"]);
