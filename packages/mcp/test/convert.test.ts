import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeHost } from "@openformatdb/engines/node";
import { LocalBackend } from "../src/backend.ts";
import { TOOLS, type Context } from "../src/tools.ts";
import { makeRepo } from "./fixture.ts";

const tool = TOOLS.find((t) => t.name === "convert_file")!;
// Engines from the installed npm packages only: a test never downloads.
const ctx: Context = { backend: new LocalBackend(makeRepo()), engineHost: nodeHost({ cacheDir: "/nonexistent-no-download" }) };

test("convert_file: lists targets, converts next to the input, never overwrites", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ofdb-convert-"));
  try {
    const md = join(dir, "notes.md");
    writeFileSync(md, "# Notes\n\nHello *there*.");
    const list: any = await tool.run(ctx, { path: md });
    assert.equal(list.ok, true);
    assert.ok(list.targets.some((t: any) => t.to === "docx" && /Pandoc/.test(t.steps[0])));
    const r: any = await tool.run(ctx, { path: md, to: "html" });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.outputs[0].path, join(dir, "notes.html"));
    assert.match(readFileSync(r.outputs[0].path, "utf8"), /<em>there<\/em>/);
    assert.equal(r.steps[0].engine, "pandoc");
    const again: any = await tool.run(ctx, { path: md, to: "html" });
    assert.equal(again.outputs[0].path, join(dir, "notes (2).html"));
    const svg = join(dir, "dot.svg");
    writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><circle cx="2" cy="2" r="2"/></svg>');
    const out = join(dir, "sub-dot.webp");
    const chain: any = await tool.run(ctx, { path: svg, to: "WEBP", output: out });
    assert.equal(chain.ok, true, chain.error);
    assert.deepEqual(chain.steps.map((s: any) => s.engine), ["resvg", "imagemagick"]);
    assert.ok(existsSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("convert_file: clear errors", async () => {
  assert.match((await tool.run(ctx, { path: "/no/such/file.png", to: "webp" }) as any).error, /No such file/);
  const dir = mkdtempSync(join(tmpdir(), "ofdb-convert-"));
  try {
    const f = join(dir, "a.xyzzy");
    writeFileSync(f, "x");
    assert.match((await tool.run(ctx, { path: f }) as any).error, /No engine reads \.xyzzy/);
    const mp3 = join(dir, "a.mp3");
    writeFileSync(mp3, "x");
    const r: any = await tool.run(ctx, { path: mp3, to: "mp4" });
    assert.equal(r.ok, false);
    assert.ok(r.possible_targets.includes("flac"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
