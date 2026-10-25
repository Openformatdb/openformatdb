import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { ENGINES, PINS, plans, targets, extKey, edges, convert, readable, downloadSize, assetKey, assetUrls } from "../src/index.ts";
import { nodeHost } from "../src/node.ts";

const host = nodeHost({ cacheDir: "/nonexistent-no-download" });
const enc = (s: string) => new TextEncoder().encode(s);
const head = (d: Uint8Array, n = 8) => String.fromCharCode(...d.slice(0, n)); // TextDecoder("latin1") is windows-1252

test("registry: every target is declared writable, every asset pinned", () => {
  for (const e of ENGINES) {
    for (const t of e.targets) assert.ok(e.formats.some((f) => f.ext === t && f.write), `${e.id} target ${t}`);
    for (const a of e.assets) assert.ok(PINS[assetKey(e, a)], `${e.id} ${a} pinned`);
  }
  assert.ok(readable().length > 150);
  assert.ok(downloadSize(["pandoc"]) > 50e6);
  // Over jsDelivr's 50 MB limit: unpkg first.
  const pd = ENGINES.find((e) => e.id === "pandoc")!;
  assert.match(assetUrls(pd, pd.assets[0])[0], /^https:\/\/unpkg\.com\//);
  assert.match(assetUrls(ENGINES[0], ENGINES[0].assets[0])[0], /jsdelivr/);
});

test("planning: aliases, direct steps, chains through another engine", () => {
  assert.equal(extKey("Photo.JPEG"), "jpg");
  assert.equal(extKey("tif"), "tiff");
  assert.equal(plans("heic", "webp")[0].steps[0].engine, "imagemagick");
  const svg = plans("svg", "webp")[0];
  assert.deepEqual(svg.steps.map((s) => s.engine), ["resvg", "imagemagick"]);
  assert.equal(plans("wav", "flac")[0].fidelity, "lossless");
  assert.equal(plans("mp3", "mp4").length, 0, "audio does not become video");
  assert.equal(plans("gif", "mp4")[0].steps[0].engine, "ffmpeg");
  assert.equal(plans("tiff", "asc")[0].steps[0].engine, "gdal");
  assert.equal(plans("dxf", "glb")[0].steps[0].engine, "assimp");
  assert.equal(plans("dxf", "geojson")[0].steps[0].engine, "gdal");
  const t = targets("docx").map((x) => x.ext);
  assert.ok(t.includes("odt") && t.includes("html"));
  assert.ok(edges().size > 200);
});

let png: Uint8Array;

test("imagemagick: PPM → PNG → WebP, ICO without a signature", async () => {
  const ppm = enc("P3\n2 2\n255\n255 0 0  0 255 0\n0 0 255  255 255 255\n");
  png = (await convert({ name: "a.ppm", data: ppm }, "png", host)).files[0].data;
  assert.equal(head(png, 4), "\x89PNG");
  const webp = (await convert({ name: "a.png", data: png }, "webp", host)).files[0];
  assert.equal(webp.name, "a.webp");
  assert.equal(head(webp.data, 4), "RIFF");
  const ico = (await convert({ name: "a.png", data: png }, "ico", host)).files[0].data;
  const back = (await convert({ name: "a.ico", data: ico }, "png", host)).files[0].data;
  assert.equal(head(back, 4), "\x89PNG");
});

test("resvg + imagemagick: SVG → JPEG in two steps", async () => {
  const svg = enc('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#08f"/></svg>');
  const steps: string[] = [];
  const { files } = await convert({ name: "logo.svg", data: svg }, "jpg", host, { onStep: (s) => steps.push(s.engine) });
  assert.deepEqual(steps, ["resvg", "imagemagick"]);
  assert.equal(files[0].name, "logo.jpg");
  assert.equal(head(files[0].data, 2), "\xff\xd8");
});

function wav(seconds = 0.2, rate = 8000): Uint8Array {
  const n = Math.floor(seconds * rate), b = new DataView(new ArrayBuffer(44 + n * 2));
  const s = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); s(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); s(36, "data"); b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), true);
  return new Uint8Array(b.buffer);
}

test("ffmpeg: WAV → FLAC and MP3", async () => {
  const flac = (await convert({ name: "tone.wav", data: wav() }, "flac", host)).files[0].data;
  assert.equal(head(flac, 4), "fLaC");
  const mp3 = (await convert({ name: "tone.wav", data: wav() }, "mp3", host)).files[0].data;
  assert.ok(head(mp3, 3) === "ID3" || mp3[0] === 0xff);
});

test("pandoc: Markdown → DOCX → HTML", async () => {
  const docx = (await convert({ name: "n.md", data: enc("# Title\n\nSome *text*.") }, "docx", host)).files[0].data;
  assert.equal(head(docx, 2), "PK");
  const html = new TextDecoder().decode((await convert({ name: "n.docx", data: docx }, "html", host)).files[0].data);
  assert.match(html, /<h1[^>]*>Title<\/h1>/);
  assert.match(html, /<em>text<\/em>/);
});

test("7zip: gzip → ZIP", async () => {
  const gz = gzipSync(Buffer.from("hello archive\n"));
  const zip = (await convert({ name: "note.txt.gz", data: new Uint8Array(gz) }, "zip", host)).files[0];
  assert.equal(zip.name, "note.txt.zip");
  assert.equal(head(zip.data, 2), "PK");
});

test("gdal: GeoJSON → KML and GPX", async () => {
  const gj = enc(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Paris" }, geometry: { type: "Point", coordinates: [2.35, 48.85] } }] }));
  const kml = new TextDecoder().decode((await convert({ name: "p.geojson", data: gj }, "kml", host)).files[0].data);
  assert.match(kml, /<kml/);
  assert.match(kml, /2\.35/);
  const gpx = new TextDecoder().decode((await convert({ name: "p.geojson", data: gj }, "gpx", host)).files[0].data);
  assert.match(gpx, /<wpt/);
});

test("assimp: OBJ → GLB, and glTF written with its .bin", async () => {
  const obj = enc("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
  const glb = (await convert({ name: "tri.obj", data: obj }, "glb", host)).files[0];
  assert.equal(head(glb.data, 4), "glTF");
  const gltf = (await convert({ name: "tri.obj", data: obj }, "gltf", host)).files;
  assert.deepEqual(gltf.map((f) => f.name).sort(), ["tri.bin", "tri.gltf"]);
  assert.match(new TextDecoder().decode(gltf.find((f) => f.name === "tri.gltf")!.data), /"tri\.bin"/);
});

test("node host: downloads from the first mirror that serves the pinned bytes, caches, rejects a corrupt file", async () => {
  const { mkdtempSync, readFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { findPackageDir } = await import("../src/node.ts");
  const e = ENGINES.find((x) => x.id === "7zip")!;
  const real = readFileSync(join(findPackageDir(e.package.name, e.package.version)!, e.assets[0]));
  const dir = mkdtempSync(join(tmpdir(), "ofdb-engines-"));
  const asked: string[] = [];
  try {
    // jsDelivr serves a corrupt file, unpkg the right one.
    const h = nodeHost({ cacheDir: dir, local: false, fetch: (async (url: string) => {
      asked.push(url);
      return new Response(url.includes("jsdelivr") ? new Uint8Array([0, 97, 115, 109]) : new Uint8Array(real));
    }) as any });
    const bytes = await h.asset(e, e.assets[0]);
    assert.equal(bytes.length, real.length);
    assert.deepEqual(asked.map((u) => new URL(u).host), ["cdn.jsdelivr.net", "unpkg.com"]); // 7zz.wasm is small: jsDelivr first
    assert.ok(existsSync(join(dir, `7z-wasm@${e.package.version}/7zz.wasm`)));
    assert.deepEqual(h.downloaded, [`7z-wasm@${e.package.version}/7zz.wasm`]);
    // Cached: no second download.
    await nodeHost({ cacheDir: dir, local: false, fetch: (async () => { throw new Error("no network"); }) as any }).asset(e, e.assets[0]);
    // Nothing serves it: a clear error naming each mirror.
    await assert.rejects(nodeHost({ cacheDir: join(dir, "empty"), local: false, fetch: (async () => new Response("nope", { status: 403 })) as any }).asset(e, e.assets[0]), /jsdelivr.*HTTP 403.*unpkg.*HTTP 403/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
