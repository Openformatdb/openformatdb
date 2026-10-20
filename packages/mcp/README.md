# @openformatdb/mcp

MCP server for [OpenFormatDB](https://github.com/openformatdb/openformatdb): before an agent
writes a parser or reverse engineers a file, it asks what the file is, which software already
reads, writes and converts it, and how far the format is documented.

| tool | what it does |
|---|---|
| `identify_file(magic_hex?, extension?, mime?)` | candidate formats, ranked: signature, then MIME type, then extension. The agent reads the first bytes itself (`xxd -p -l 64 file`); the file never leaves the machine |
| `lookup_format(id \| puid \| wikidata \| mime)` | full record: identifiers, software (open source first, inherited from the family when marked `via`), grammars, specification, family and versions, live claims, advice |
| `search_formats(query, category?, status?)` | ranked matches by name, alias, extension, MIME, PUID or QID |
| `list_sources()` | aggregated sources with counts, licences and snapshot dates |

All tools are read-only. Claiming a format and publishing findings come later (see SPEC.md).

## Run it

From a checkout of the repository:

```sh
npm install
npm run mcp                      # stdio; data from this checkout
OFDB_REPO=/path/to/checkout npm run mcp
```

Claude Code: `claude mcp add openformatdb -- node /path/to/openformatdb/packages/mcp/src/server.ts`

Needs Node 22.18 or later (TypeScript sources run directly). An npm package with the data
bundled, and a remote backend reading the site's static API, are planned.
