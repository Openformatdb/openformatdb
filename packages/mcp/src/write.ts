// Write tools: claim a format before reverse engineering it, publish findings after.
// They write data/formats/<id>.yaml in the local checkout; the contributor opens the PR.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, relative, join } from "node:path";
import { z } from "zod";
import {
  SCHEMA, STATUSES, curatedPath, effectiveStatus, liveClaims, makeId, mergeRecords, parseRecordYaml,
  search, statusRank, stringifyRecordYaml, today, validate,
  type Claim, type FormatRecord, type Status,
} from "@openformatdb/core";
import type { Backend } from "./backend.ts";
import { policyScan, POLICY_POINTER, type PolicyHit } from "./policy.ts";
import type { Context, Result } from "./tools.ts";

const P = SCHEMA.properties;
const en = (values: string[]) => z.enum(values as [string, ...string[]]);
const CATEGORIES: string[] = P.category.enum;
const ID_RE = new RegExp(SCHEMA.$defs.formatId.pattern);
const FIELD_ORDER = Object.keys(P);
export const MAX_CLAIM_DAYS = 90;

const fail = (error: string, extra: Record<string, unknown> = {}): Result => ({ ok: false, error, ...extra });

function readOnly(b: Backend): Result {
  return fail(`This server cannot write to ${b.location}. Restart it with OFDB_REPO=<path to a checkout of the repository>.`);
}

function policyRefusal(hits: PolicyHit[], root: string): Result {
  return fail(
    `Refused by the content policy: ${hits.map((h) => `${h.field} mentions "${h.match}" (${h.rule})`).join("; ")}. ` +
    `Nothing was written. See ${join(root, "POLICY.md")}. If this is a false positive, rephrase and let human review handle it.`,
    { policy: POLICY_POINTER, hits },
  );
}

function gitNextStep(root: string, file: string, id: string, verb: string): string {
  return `cd ${root} && git checkout -b ofdb/${verb}-${id} && git add ${file} && git commit -m "${verb}: ${id}" && gh pr create --fill  ` +
    "(this server never runs git: you open the pull request; maintainers review and merge it)";
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

/** Drop empty values and inherited entries, order keys like the schema: stable, reviewable YAML. */
function tidy(r: FormatRecord): FormatRecord {
  const out: any = {};
  for (const k of [...FIELD_ORDER, ...Object.keys(r).filter((k) => !FIELD_ORDER.includes(k))]) {
    let v = (r as any)[k];
    if ((k === "tools" || k === "parsers") && Array.isArray(v)) v = v.filter((x: any) => !x.via);
    if (v && typeof v === "object" && !Array.isArray(v)) v = Object.fromEntries(Object.entries(v).filter(([, x]) => !isEmpty(x)));
    if (!isEmpty(v)) out[k] = v;
  }
  return out;
}

function readCurated(root: string, id: string): FormatRecord | null {
  const file = curatedPath(id, root);
  return existsSync(file) ? parseRecordYaml(readFileSync(file, "utf8")) : null;
}

function writeRecord(root: string, r: FormatRecord): string {
  const file = curatedPath(r.id, root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringifyRecordYaml(r));
  return relative(root, file);
}

/**
 * Curated stub for a format known from imported snapshots. It carries the id and the single
 * PUID/QID of the known record, so it merges back into it on load.
 */
function stub(known: FormatRecord, on: string): FormatRecord {
  const ids: FormatRecord["identifiers"] = {};
  for (const k of ["puid", "wikidata"] as const) if (known.identifiers?.[k]?.length === 1) ids[k] = known.identifiers[k];
  return { id: known.id, name: known.name, ...(known.version ? { version: known.version } : {}), category: known.category, ...(Object.keys(ids).length ? { identifiers: ids } : {}), status: "unknown", updated: on };
}

// ---------- claim_format ----------

export const claimFormat = {
  name: "claim_format",
  title: "Claim a format",
  description:
    "Say you are reverse engineering or documenting a format, so nobody duplicates the work: adds a claim (who, contact, scope, " +
    `up to ${MAX_CLAIM_DAYS} days) to data/formats/<id>.yaml, creating the record if the format is new. Call lookup_format first.`,
  shape: {
    id: z.string().max(200).optional().describe("Format id if it exists (from identify_file, lookup_format or search_formats). Otherwise give name + category."),
    name: z.string().max(200).optional().describe("Format name, for a format not in OpenFormatDB yet"),
    version: z.string().max(100).optional(),
    category: en(CATEGORIES).optional().describe("Required only for a new format"),
    extensions: z.array(z.string().max(40)).max(20).optional().describe("Extensions of a new format, without the dot"),
    who: z.string().min(1).max(200).describe("Who is working on it: your human's name or handle"),
    contact: z.string().min(1).max(300).describe("How others reach the claimant: email, GitHub handle, issue URL"),
    scope: z.string().min(1).max(500).describe("What you will document, e.g. \"header and index\", \"full read support\""),
    days: z.number().int().min(1).max(MAX_CLAIM_DAYS).optional().describe(`Claim duration (default 30, max ${MAX_CLAIM_DAYS})`),
    agent: z.string().max(200).optional().describe("Agent/tooling used"),
    force_new: z.boolean().optional().describe("Create a new record even though a similar format exists"),
  },
  run(ctx: Context, a: any): Result {
    const on = ctx.today ?? today();
    const { backend } = ctx;
    const root = backend.root;
    if (!root) return readOnly(backend);
    const days = a.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > MAX_CLAIM_DAYS) return fail(`days must be between 1 and ${MAX_CLAIM_DAYS}: claims are short so abandoned work frees the format.`);
    for (const k of ["who", "contact", "scope"]) if (!a[k]?.trim()) return fail(`${k} is required.`);
    const hits = policyScan([["scope", a.scope]]);
    if (hits.length) return policyRefusal(hits, root);

    let id: string = a.id;
    if (!id) {
      if (!a.name) return fail("Give the format id, or name + category for a new format.");
      id = makeId(a.name, a.version);
      if (!backend.get(id) && !a.force_new) {
        const near = search(backend.index(on), `${a.name} ${a.version ?? ""}`, { limit: 3 }).filter((h) => h.score >= 20);
        if (near.length) {
          return fail(`Similar formats exist: ${near.map((n) => `${n.id} (${n.name}${n.version ? " " + n.version : ""})`).join(", ")}. ` +
            `Pass id to claim one of them, or force_new: true if yours is really different.`, { similar: near.map((n) => ({ id: n.id, name: n.name, version: n.version })) });
        }
      }
    }
    if (!ID_RE.test(id)) return fail(`Invalid id "${id}": lowercase [a-z0-9] with - . + separators.`);

    const known = backend.get(id);
    let rec = readCurated(root, id);
    const action = rec ? "updated" : "created";
    if (!rec) {
      if (known) rec = stub(known, on);
      else {
        if (!a.name) return fail(`No format "${id}". Give name and category to create it.`);
        if (!a.category) return fail(`"${id}" is new: give its category, one of ${CATEGORIES.join(", ")}.`);
        rec = { id, name: a.name, ...(a.version ? { version: a.version } : {}), category: a.category, ...(a.extensions?.length ? { identifiers: { extensions: a.extensions.map((e: string) => e.toLowerCase().replace(/^\./, "")) } } : {}), status: "unknown", updated: on };
      }
    }
    const claim: Claim = { who: a.who, contact: a.contact, scope: a.scope, since: on, expires: addDays(on, days), ...(a.agent ? { agent: a.agent } : {}) };
    const others = liveClaims(known ?? rec, on).filter((c) => c.who !== a.who);
    // A renewal by the same claimant for the same scope replaces the live claim.
    rec.claims = [...(rec.claims ?? []).filter((c) => !(c.who === a.who && c.scope === a.scope && c.expires >= on)), claim];
    rec.updated = on;
    rec = tidy(rec);
    const errors = validate(rec);
    if (errors.length) return fail("The record would not validate against schema/format.schema.json; nothing was written.", { errors });
    const file = writeRecord(root, rec);
    return {
      ok: true, action, id, claim,
      effective_status: effectiveStatus(known ? mergeRecords(rec, known) : rec, on),
      warnings: others.map((c) => `Also claimed by ${c.who} (scope: ${c.scope}) until ${c.expires}: coordinate with ${c.contact}.`),
      file_changed: file,
      next_step: gitNextStep(root, file, id, "claim"),
    };
  },
};

// ---------- publish_findings ----------

const T = P.tools.items.properties, PA = P.parsers.items.properties, C = P.conversions.items.properties;
const ST = P.structure.items.properties, PR = P.projects.items.properties, V = P.verification.items.properties;

export const patchSchema = z.strictObject({
  summary: z.string().max(4000).optional().describe("One plain-text paragraph: what the format is and what is now known. Replaces the summary."),
  status: en(STATUSES).optional().describe("New status, forward only: unknown → in-progress → partial → readable (open code reads it) → writable"),
  aliases: z.array(z.string()).optional(),
  family: z.string().optional().describe("Id of the parent format, for a version or variant"),
  identifiers: z.strictObject({
    extensions: z.array(z.string()).optional(), mime: z.array(z.string()).optional(), puid: z.array(z.string()).optional(),
    wikidata: z.array(z.string()).optional(), loc_fdd: z.array(z.string()).optional(), uti: z.array(z.string()).optional(),
    magic: z.array(z.strictObject({ offset: z.number().int().min(0), hex: z.string().describe("lowercase hex, ?? = any byte"), notes: z.string().optional() })).optional(),
  }).optional().describe("Identifiers to add (unioned)"),
  spec: z.strictObject({ availability: en(P.spec.properties.availability.enum), url: z.string().optional(), standard: z.string().optional() }).optional(),
  structure: z.array(z.strictObject({
    name: z.string(), status: en(ST.status.enum), confidence: en(ST.confidence.enum).optional().describe("AI-derived, untested work is low or medium"),
    spec: z.string().optional().describe("URL of the description you wrote"), notes: z.string().optional(),
  })).optional().describe("Parts of the format you documented; same name replaces"),
  parsers: z.array(z.strictObject({ engine: en(PA.engine.enum), url: z.string(), license: z.string().optional(), coverage: en(PA.coverage.enum).optional() })).optional(),
  tools: z.array(z.strictObject({
    name: z.string(), url: z.string(), license: z.string().optional(), open_source: z.boolean().optional(),
    reads: z.boolean().optional(), writes: z.boolean().optional(), platforms: z.array(en(T.platforms.items.enum)).optional(), notes: z.string().optional(),
  })).optional(),
  conversions: z.array(z.strictObject({
    to: z.string().describe("Target format id"), tool: z.string(), command: z.string().optional(), fidelity: en(C.fidelity.enum),
    losses: z.string().optional().describe("What does not survive"), url: z.string().optional(),
  })).optional(),
  samples: z.array(z.strictObject({ url: z.string(), license: z.string().optional(), notes: z.string().optional() })).optional().describe("Links to sample files you may share; never upload files here"),
  projects: z.array(z.strictObject({ name: z.string(), url: z.string(), kind: en(PR.kind.enum), license: z.string().optional(), official: z.boolean().optional() })).optional(),
  verification: z.array(z.strictObject({
    method: en(V.method.enum).describe("sample-replay = a parser run against public sample files: this earns the verified badge"),
    by: z.string(), date: z.string().describe("YYYY-MM-DD"), tool: z.string().optional(), notes: z.string().optional(),
  })).optional(),
  provenance: z.strictObject({ sources: z.array(z.string()).optional(), ai_assisted: z.boolean().optional().describe("true if an AI agent did any of the work"), tools: z.array(z.string()).optional() }).optional(),
});

export const publishFindings = {
  name: "publish_findings",
  title: "Publish findings",
  description:
    "Merge what you found into data/formats/<id>.yaml: structure, grammars, tools, conversions, specification, identifiers, " +
    "verification. Status only moves forward. Optionally release your claim. Then open a pull request.",
  shape: {
    id: z.string().max(200).describe("Format id"),
    patch: patchSchema,
    allow_downgrade: z.boolean().optional().describe("Allow lowering the status (explain why in the summary or a verification note)"),
    release_claim_of: z.string().optional().describe("Remove the live claims of this claimant now that the work is published"),
  },
  run(ctx: Context, a: any): Result {
    const on = ctx.today ?? today();
    const { backend } = ctx;
    const root = backend.root;
    if (!root) return readOnly(backend);
    const parsed = patchSchema.safeParse(a.patch);
    if (!parsed.success) return fail(`Invalid patch: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const patch: any = parsed.data;
    const hits = policyScan([
      ["summary", patch.summary],
      ...(patch.structure ?? []).map((s: any, n: number) => [`structure[${n}].notes`, s.notes] as [string, string]),
      ...(patch.tools ?? []).map((t: any, n: number) => [`tools[${n}].notes`, t.notes] as [string, string]),
      ...(patch.conversions ?? []).map((c: any, n: number) => [`conversions[${n}].losses`, c.losses] as [string, string]),
      ...(patch.verification ?? []).map((v: any, n: number) => [`verification[${n}].notes`, v.notes] as [string, string]),
    ]);
    if (hits.length) return policyRefusal(hits, root);

    const known = backend.get(a.id);
    if (!known) return fail(`No format "${a.id}". Find its id with identify_file or search_formats, or create it with claim_format first.`);
    if (patch.family && !backend.get(patch.family)) return fail(`family "${patch.family}" is not a known format id.`);
    for (const c of patch.conversions ?? []) if (!backend.get(c.to)) return fail(`conversions: target "${c.to}" is not a known format id.`);
    const base = readCurated(root, a.id) ?? stub(known, on);
    if (patch.status && statusRank(patch.status as Status) < statusRank(known.status) && !a.allow_downgrade) {
      return fail(`Status can only move forward: "${a.id}" is "${known.status}" and the patch says "${patch.status}" (${STATUSES.join(" → ")}). ` +
        "Nothing was written. If the current status is wrong, retry with allow_downgrade: true and explain why.");
    }
    const patchRec = { ...patch, id: base.id, name: base.name, category: base.category, status: patch.status ?? base.status, updated: on } as FormatRecord;
    let next = mergeRecords(patchRec, base);
    if (patch.status && a.allow_downgrade) next.status = patch.status;
    let released = 0;
    if (a.release_claim_of) {
      const before = next.claims?.length ?? 0;
      next.claims = (next.claims ?? []).filter((c) => !(c.who === a.release_claim_of && c.expires >= on));
      released = before - next.claims.length;
    }
    next = tidy(next);
    const errors = validate(next);
    if (errors.length) return fail("The record would not validate against schema/format.schema.json; nothing was written.", { errors });
    const file = writeRecord(root, next);
    const merged = mergeRecords(next, known);
    return {
      ok: true, id: a.id,
      effective_status: effectiveStatus(merged, on),
      released_claims: released,
      warnings: [
        ...(patch.provenance?.ai_assisted === undefined && !base.provenance?.ai_assisted ? ["Say whether an AI agent did the work: provenance.ai_assisted."] : []),
        ...((patch.structure ?? []).some((s: any) => !s.confidence) ? ["Give a confidence for each structure part you documented."] : []),
      ],
      file_changed: file,
      next_step: gitNextStep(root, file, a.id, "findings"),
    };
  },
};
