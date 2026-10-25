# OpenFormatDB

[![Code: AGPL-3.0](https://img.shields.io/badge/code-AGPL--3.0-blue)](LICENSE)
[![Data: CC BY-SA 4.0](https://img.shields.io/badge/data-CC%20BY--SA%204.0-green)](LICENSE-DATA.md)

An open directory of file formats: how to recognise each one, which open tools read,
write and convert it, how far its structure is documented or reverse engineered, and
what a conversion loses — so that nobody, human or AI agent, redoes work that already exists.

- **Humans**: browse the directory and format pages, identify a file, and convert it in the
  browser (nothing is uploaded) or find a chain of tools, on [openformatdb.org](https://openformatdb.org) (`site/`).
- **Agents**: query it through the MCP server ([`packages/mcp`](packages/mcp)) before opening,
  converting or reverse engineering a file: `identify_file`, `lookup_format`, `search_formats`, `find_conversion`,
  `convert_file`, `claim_format`, `publish_findings`.
- **Engines** ([`packages/engines`](packages/engines)): ImageMagick, FFmpeg, Pandoc, 7-Zip, GDAL,
  Assimp and resvg compiled to WebAssembly, run where the file is (browser or the agent's machine),
  each downloaded once on first use, pinned and checksummed.
- **Existing sources** (PRONOM, Wikidata, Archive Team's File Formats Wiki, Library of
  Congress FDD, Kaitai Struct, MIME databases, converter format lists…) are aggregated by
  importers (`packages/importers`; PRONOM, Wikidata, the File Formats Wiki, Kaitai Struct, converters (FFmpeg, ImageMagick, Pandoc, LibreOffice) and the engines today), with a link back to each source.

Sister project of [OpenDeviceDB](https://opendevicedb.org).

See [SPEC.md](SPEC.md) for the design and [POLICY.md](POLICY.md) for what we accept.
The record format is [schema/format.schema.json](schema/format.schema.json).

```sh
npm install
npm test                  # unit tests of every package
npm run validate          # check every record against schema/format.schema.json
npm run import -- all     # refresh data/imported/ snapshots (PRONOM_DIR, WIKIDATA_DIR, FFW_DIR, KAITAI_DIR: local copies)
npm run mcp               # MCP server on stdio
npm run build             # static site and JSON API in site/dist (npm run dev: localhost)
```

Code: AGPL-3.0-or-later (see LICENSE). Data: CC BY-SA 4.0 (see LICENSE-DATA.md).
