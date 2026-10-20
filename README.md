# OpenFormatDB

[![Code: AGPL-3.0](https://img.shields.io/badge/code-AGPL--3.0-blue)](LICENSE)
[![Data: CC BY-SA 4.0](https://img.shields.io/badge/data-CC%20BY--SA%204.0-green)](LICENSE-DATA.md)

An open directory of file formats: how to recognise each one, which open tools read,
write and convert it, how far its structure is documented or reverse engineered, and
what a conversion loses — so that nobody, human or AI agent, redoes work that already exists.

- **Humans**: browse the directory and format pages on the website (`site/`, planned).
- **Agents**: query it through the MCP server (`packages/mcp`, planned) before opening,
  converting or reverse engineering a file; claim the format, publish findings when done.
- **Existing sources** (PRONOM, Wikidata, Archive Team's File Formats Wiki, Library of
  Congress FDD, Kaitai Struct, MIME databases, converter format lists…) are aggregated by
  importers (`packages/importers`, planned), with a link back to each source.

Sister project of [OpenDeviceDB](https://opendevicedb.org).

See [SPEC.md](SPEC.md) for the design and [POLICY.md](POLICY.md) for what we accept.
The record format is [schema/format.schema.json](schema/format.schema.json).

Code: AGPL-3.0-or-later (see LICENSE). Data: CC BY-SA 4.0 (see LICENSE-DATA.md).
