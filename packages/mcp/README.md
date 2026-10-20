# @openformatdb/mcp

MCP server for [OpenFormatDB](https://github.com/openformatdb/openformatdb): before an agent
writes a parser or reverse engineers a file, it asks what the file is, which software already
reads, writes and converts it, and how far the format is documented.

| tool | what it does |
|---|---|
| `identify_file(magic_hex?, extension?, mime?)` | candidate formats, ranked: signature, then MIME type, then extension. The agent reads the first bytes itself (`xxd -p -l 64 file`); the file never leaves the machine |
| `lookup_format(id \| puid \| wikidata \| mime)` | full record: identifiers, software (open source first, inherited from the family when marked `via`), grammars, specification, family and versions, live claims, advice |
| `search_formats(query, category?, status?)` | ranked matches by name, alias, extension, MIME, PUID or QID |
| `find_conversion(from, to?)` | cheapest chains of open tools from one format to another (lossless first), each step with its command and what is lost; formats as ids or extensions |
| `list_sources()` | aggregated sources with counts, licences and snapshot dates |
| `claim_format(id \| name+category, who, contact, scope, days?)` | says you are documenting a format (up to 90 days), so nobody duplicates the work |
| `publish_findings(id, patch, release_claim_of?)` | merges structure, grammars, tools, conversions, spec, identifiers, verification; status only moves forward |

The two write tools change `data/formats/<id>.yaml` in the checkout and print the git commands
to open a pull request; they never run git. Text is screened against POLICY.md (no DRM removal,
no keys, no copies of paywalled standards).

## Run it

Without a checkout it reads the static API of [openformatdb.org](https://openformatdb.org)
(read-only; `OFDB_API_URL` points elsewhere). From a checkout of the repository it reads the
data files and can write:

```sh
npm install
npm run mcp                      # stdio; data from this checkout
OFDB_REPO=/path/to/checkout npm run mcp
```

Claude Code: `claude mcp add openformatdb -- node /path/to/openformatdb/packages/mcp/src/server.ts`

Needs Node 22.18 or later (TypeScript sources run directly).
