# @openformatdb/mcp

MCP server for [OpenFormatDB](https://github.com/openformatdb/openformatdb): before an agent
writes a parser or reverse engineers a file, it asks what the file is, which software already
reads, writes and converts it, and how far the format is documented.

| tool | what it does |
|---|---|
| `identify_file(magic_hex?, tail_hex?, extension?, mime?)` | candidate formats, ranked: full PRONOM signature (with priorities), prefix, MIME type, extension. The agent reads the bytes itself (`xxd -p -l 1024 file`, `tail -c 512 file \| xxd -p`); the file never leaves the machine |
| `lookup_format(id \| puid \| wikidata \| mime)` | full record: identifiers, software (open source first, inherited from the family when marked `via`), grammars, specification, family and versions, live claims, advice |
| `search_formats(query, category?, status?)` | ranked matches by name, alias, extension, MIME, PUID or QID |
| `find_conversion(from, to?)` | cheapest chains of open tools from one format to another (lossless first), each step with its command and what is lost; formats as ids or extensions. Steps with an `engine` run with `convert_file` |
| `convert_file(path, to?, output?)` | converts a file of this machine with open-source converters compiled to WebAssembly: ImageMagick, resvg, FFmpeg, Pandoc, 7-Zip, GDAL, Assimp. Nothing is uploaded; each engine (2 to 59 MB) is downloaded once on first use, pinned and SHA-256 checked, into `~/.cache/openformatdb/engines` (`OFDB_ENGINES_DIR`). Without `to`, lists what the file can become. Writes next to the input and never overwrites |
| `list_sources()` | aggregated sources with counts, licences and snapshot dates |
| `claim_format(id \| name+category, who, contact, scope, days?)` | says you are documenting a format (up to 90 days), so nobody duplicates the work |
| `publish_findings(id, patch, release_claim_of?)` | merges structure, grammars, tools, conversions, spec, identifiers, verification; status only moves forward |

`convert_file` is the only tool that reaches the network (an engine's first download) and writes
outside the checkout (the converted file). The two write tools change `data/formats/<id>.yaml` in the checkout and print the git commands
to open a pull request; they never run git. Text is screened against POLICY.md (no DRM removal,
no keys, no copies of paywalled standards).

## Install

```sh
npx -y @openformatdb/mcp
claude mcp add openformatdb -- npx -y @openformatdb/mcp     # Claude Code
```

## Release

Bump the version in `package.json`, `server.json` and `src/server.ts`, then run the **Release MCP
server** workflow: it tests, publishes to npm (trusted publishing) and to the MCP Registry as
`org.openformatdb/openformatdb` (secret `MCP_REGISTRY_PRIVATE_KEY`, whose public half is served at
`https://openformatdb.org/.well-known/mcp-registry-auth`).

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
