# OpenFormatDB — specification (prototype v0)

## Problem

Someone has a file they cannot open: an old word-processor document, a game save, a
camera's raw format, a firmware blob, a CAD export from software that no longer runs.
Since AI agents made reverse engineering cheap, many people now re-derive the same file
structures, and the results stay on private disks. The knowledge that does exist is
split across silos that each answer one question:

- **identification registries** (PRONOM, Wikidata, Library of Congress FDD, TrID,
  libmagic, Tika) say *what* a file is, by extension, MIME type or signature;
- **parsing grammars** (Kaitai Struct, ImHex patterns, fq, 010 Editor templates) say
  *how its bytes are laid out*, each for its own engine;
- **converters** (FFmpeg, Pandoc, LibreOffice, ImageMagick, ConvertX…) know *what they
  can turn it into*, but only inside their own code;
- **wikis** (Archive Team's File Formats Wiki) hold prose, specs and tool lists that no
  program can query.

The closest aggregator, the digipres.org Format Index, merges about a dozen
identification registries but stops at identification: no tools, no parsers, no
conversions, no reverse-engineering status, no API. No source answers, for one format:

- how do I recognise it, and which open tools read it, write it, convert it?
- is its structure documented (official spec or reverse engineered), and how far?
- what is lost when converting it to something else?
- is someone working on it right now?

## Goal

One open directory, keyed by file format, that:

1. **agents query by themselves** before trying to open, convert or reverse engineer a
   file (MCP tool), and publish to when they find something;
2. **humans browse** as a website: directory, format pages, "what is this file?",
   news, how to contribute;
3. **aggregates** the existing registries, grammar collections and converter
   capabilities instead of competing with them, so coverage is broad from day one and
   every record links back to its source.

## Principles

- **P1 — Files in git are the database.** One YAML file per curated format under
  `data/formats/<id>.yaml`, validated by `schema/format.schema.json`, changed by pull
  request. No server-side database; the site and the API are static builds of the
  repository.
- **P2 — Aggregate, don't duplicate.** Importers snapshot external sources into
  `data/imported/<source>.json` (slim records + link back + the source's licence).
  Curated files override and enrich imported records for the same format id.
  Grammars and specs whose licence does not allow it are linked, never copied.
- **P3 — Stable keys, not extensions.** Extensions and MIME types collide (`.dat`,
  `.bin`, `.sav` mean hundreds of formats). Two records are merged only when they share
  the id, or hold the same single Wikidata QID, PRONOM PUID or LoC FDD id. A record with
  several PUIDs or QIDs is a family (e.g. one Wikidata item for every PNG version): it is
  linked to the versions, never merged into them. Extensions and MIME types only give
  candidate lists. An identifier that two records of the same source share (PRONOM
  gives one LoC id to every Access version) is family-level there and is not used to
  merge. The merged record keeps the first id: curated, then by source.
- **P4 — Claims prevent duplicate work.** A `claims` entry says "someone is
  reverse engineering this format, scope X, until date Y, contact Z". Claims expire.
- **P5 — AI output is not trusted by default.** Every structure description carries a
  `confidence`, every record a `verification` list. The "verified" badge requires a
  replayable check: a parser run against public sample files, with the tool version.
- **P6 — Legally boring.** We host descriptions written by contributors, original
  code and links. We never host paywalled standards, proprietary SDK code, keys, or
  sample files whose licence does not allow it. See `POLICY.md`.
- **P7 — Independent and open.** Code AGPL-3.0-or-later, data CC-BY-SA-4.0. No vendor
  affiliation. Sister project of [OpenDeviceDB](https://opendevicedb.org).

## Format record (summary — the JSON Schema is normative)

| field | meaning |
|---|---|
| `id` | lowercase slug, `[a-z0-9]` with `-`, `.`, `+`; a version or variant is a separate record pointing to its `family` (e.g. `pdf` and `pdf-1-7`) |
| `name`, `version`, `aliases` | display names; `version` when the record is one version of a family |
| `family` | id of the parent format, for versions and variants |
| `category` | enum, see schema |
| `identifiers` | `extensions`, `mime`, `puid` (PRONOM), `wikidata` (QID), `loc_fdd`, `uti` (Apple), `magic[]` (`offset`, `hex`, `notes`) |
| `status` | `unknown` → `in-progress` → `partial` → `readable` → `writable` |
| `spec` | `availability` (`open-standard`, `paywalled-standard`, `vendor-published`, `reverse-engineered`, `none`), `url`, `standard` (e.g. ISO 32000-2) |
| `summary` | one paragraph, plain text |
| `structure[]` | what is documented, part by part: `name`, `status`, `confidence`, `spec` (url), `notes` |
| `parsers[]` | machine-readable grammars: `engine` (kaitai, imhex, fq, 010, hachoir, polyfile, dfdl…), `url`, `license`, `coverage` |
| `tools[]` | software that handles it: `name`, `url`, `license`, `open_source`, `reads`, `writes`, `platforms` |
| `conversions[]` | `to` (format id), `tool`, `command`, `fidelity` (`lossless`, `lossy`, `partial`), `losses`, `url` |
| `samples[]` | links to public sample files: `url`, `license`, `notes` |
| `projects[]` | reverse-engineering and documentation work: `name`, `url`, `kind`, `license` |
| `claims[]` | `who`, `contact`, `scope`, `since`, `expires` |
| `verification[]` | `method`, `by`, `date`, `tool`, `notes` |
| `provenance` | `sources[]`, `ai_assisted`, `tools[]` |
| `updated` | ISO date |

Status meaning:

- `unknown` — the format is listed, nothing public is known about its structure.
- `in-progress` — at least one live claim, no usable result yet.
- `partial` — part of the structure is documented (e.g. the header and the index, not
  the compressed payload).
- `readable` — open code can read the whole format and extract its content.
- `writable` — open code can also write valid files that the original software accepts.

Identification registries such as PRONOM say nothing about open implementations, so
their records come in as `unknown`; the status rises when a parser, tool or curated
record says more. The Wikidata importer sets `readable` or `writable` when software
under an open-source licence (P275) is said to read (P1072) or write (P1073) the format.

`status` describes what open implementations can do; `spec.availability` describes
whether a specification exists. A paywalled ISO standard can be `writable`; a format
with no spec at all can be `readable` thanks to reverse engineering.

## Repository layout

```
schema/format.schema.json     normative record schema
data/formats/*.yaml           curated records (hand- or agent-written, PR reviewed)
data/imported/<source>.json   importer snapshots {source, license, fetched_at, records[]}
news/YYYY-MM-DD-slug.md       news posts (frontmatter: title, date, summary, tags)
packages/core                 load + validate + merge + search (TypeScript, used by all)
packages/importers            one module per external source, `npm run import -- <source>`
packages/mcp                  MCP server for agents (identify, lookup, convert-path, claim, publish)
site/                         static site: directory, format pages, identify page, news, API json
```

## Sources (first importers)

| source | brings | access | licence |
|---|---|---|---|
| PRONOM (github.com/nationalarchives/pronom) | reference ids (PUID), signatures | JSON in git | MIT (to confirm against OGL) |
| Wikidata | id hub (QID ↔ PUID ↔ LoC), readers/writers (P1072/P1073) | SPARQL / dump | CC0 |
| File Formats Wiki (Archive Team) | prose, specs, tool lists, legacy formats | MediaWiki API / dump | CC0 |
| Library of Congress FDD | qualified descriptions, PUID/QID crosswalk | XML | US public domain (to confirm) |
| mime-db, shared-mime-info, Tika | MIME types, extensions, globs | JSON / XML | MIT / GPL-2.0+ (facts only) / Apache-2.0 |
| Kaitai Struct formats | grammars + xref to PUID/QID | git | per file — link, copy only when allowed |
| ImHex-Patterns, fq, PolyFile | grammars, decoders | git | GPL-2.0 (link only) / MIT / Apache-2.0 |
| FFmpeg, Pandoc, LibreOffice, ImageMagick | conversion edges | each tool's own format listing | facts extracted, no code copied |

Later: TrID, libmagic, Linguist, NARA, COPTR, digipres.org's `registries.db` as a
cross-check. Every licence marked "to confirm" is checked before its importer is merged.

## Static API (built by the site)

- `/api/index.json` — `[{id, name, category, status, identifiers, sources[]}]`
- `/api/formats/<id>.json` — full merged record
- `/api/by-extension/<ext>.json`, `/api/by-mime/<type>/<subtype>.json` — candidate ids
- `/api/conversions.json` — the conversion graph, `[{from, to, tool, fidelity}]`

The MCP server reads this API remotely (`OFDB_API_URL`) or the local repository
(`OFDB_REPO`), so it works before and after the site is online.

## MCP tools (v0)

| tool | effect |
|---|---|
| `identify_file(extension?, mime?, magic_hex?)` | candidate formats ranked by signature match, then MIME, then extension; never reads or uploads the file itself |
| `lookup_format(id or puid or wikidata or mime)` | full record + live claims; says explicitly "nothing known" when so |
| `search_formats(query, category?, status?)` | ranked matches by name, alias, identifiers |
| `find_conversion(from, to)` | shortest paths in the conversion graph, preferring lossless edges and open tools, with the commands and the losses |
| `claim_format(id, who, contact, scope, days)` | adds a claim (creates a stub record if needed) |
| `publish_findings(id, record_patch)` | merges findings into the record, validates, writes it |
| `list_sources()` | imported sources with record counts, licences and snapshot dates |

`identify_file` takes the first bytes as hex from the agent, which reads the file
locally; nothing about the user's file leaves their machine beyond that prefix.
In v0 writes go to the local repository checkout; the contributor opens the PR.

## Out of scope for v0

Accounts, comments, a write API, hosting sample files, running conversions on our
servers, automatic verification.

## Roadmap (ideas, to be specified before any code)

- **R1 — "What is this file?" in the browser.** Drop a file on the site; the page
  reads its first bytes locally (nothing is uploaded) and matches signatures from the
  static index, then shows the candidate format pages.
- **R2 — Conversion paths.** Format pages show how to get to a common open format
  (e.g. to PDF/A, PNG, FLAC, ODF) with the open tool, the command and what is lost.
- **R3 — Verified parsers.** CI runs linked Kaitai/fq/ImHex grammars against public
  sample corpora and records the result as a `verification` entry.
- **R4 — Bridge with OpenDeviceDB.** Device records link the formats their firmware,
  saves or exports use, and format records link back.
