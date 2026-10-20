import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type FormatRecord } from "@openformatdb/core";
import { parseFfmpeg, parseImageMagick, ffmpeg, imagemagick, pandoc, libreoffice, resolver, toRecords } from "../src/sources/converters.ts";

const FFMPEG = `File formats:
 D. = Demuxing supported
 .E = Muxing supported
 --
 D  aac             raw ADTS AAC (Advanced Audio Coding)
 DE flac            raw FLAC
  E mp3             MP3 (MPEG audio layer 3)
 D  mp3             MP2/3 (MPEG audio layer 2/3)
 DE wav             WAV / WAVE (Waveform Audio)
 D  mov,mp4,m4a,3gp,3g2,mj2 QuickTime / MOV
`;
const MAGICK = `   Format  Module    Mode  Description
-------------------------------------------------------------------------------
      3FR  DNG       r--   Hasselblad CFV/H3D39II
     AVIF            r--   AV1 Image File Format (1.17.6)
      PNG* PNG       rw-   Portable Network Graphics
     JPEG* JPEG      rw-   Joint Photographic Experts Group JFIF format
`;

test("listings are parsed, including combined names and an empty module column", () => {
  const f = parseFfmpeg(FFMPEG);
  assert.deepEqual(f.reads, ["aac", "flac", "mp3", "wav", "mov", "mp4", "m4a", "3gp", "3g2", "mj2"]);
  assert.deepEqual(f.writes, ["flac", "mp3", "wav"]);
  const m = parseImageMagick(MAGICK);
  assert.deepEqual(m.reads, ["3fr", "avif", "png", "jpeg"]);
  assert.deepEqual(m.writes, ["png", "jpeg"]);
});

const rec = (id: string, category: string, extensions: string[], tools = 0, family?: string): FormatRecord =>
  ({ id, name: id.toUpperCase(), category, status: "unknown", identifiers: { extensions }, ...(family ? { family } : {}),
     tools: Array.from({ length: tools }, (_, i) => ({ name: `t${i}`, url: `https://t${i}.example` })), updated: "2026-01-01" });

const RECORDS = [
  rec("wav", "audio", ["wav"], 50), rec("flac", "audio", ["flac"], 30), rec("mp3", "audio", ["mp3"], 80),
  rec("mp2", "audio", ["mp2", "mp3"], 5), rec("aac", "audio", ["aac"], 9), rec("mp4", "video", ["mp4"], 60),
  rec("png", "image", ["png"], 90), rec("png-1-2", "image", ["png"], 1, "png"), rec("jpeg", "image", ["jpg", "jpeg"], 90),
  rec("png-text", "text", ["png"], 500), // wrong category for ImageMagick: ignored
  rec("doc", "document", ["doc"], 40), rec("odt", "document", ["odt"], 30), rec("pdf", "other", ["pdf"], 300), rec("xls", "spreadsheet", ["xls"], 30), rec("csv", "text", ["csv"], 40),
];

test("names map to the most used record of the tool's categories; edges carry fidelity and command", () => {
  const out = toRecords([ffmpeg(FFMPEG)!, imagemagick(MAGICK)!], resolver(RECORDS), "2026-10-20");
  for (const r of out) assert.deepEqual(validate(r), [], r.id);
  const wav = out.find((r) => r.id === "wav")!;
  assert.deepEqual(wav.tools, [{ name: "FFmpeg", url: "https://ffmpeg.org", license: "LGPL-2.1-or-later / GPL-2.0-or-later", open_source: true, reads: true, writes: true }]);
  assert.equal(wav.status, "writable");
  const toMp3 = wav.conversions!.find((c) => c.to === "mp3")!; // mp3 means MP3, not MPEG Layer II
  assert.equal(toMp3.fidelity, "lossy");
  assert.equal(toMp3.command, "ffmpeg -i in.wav out.mp3");
  assert.equal(wav.conversions!.find((c) => c.to === "flac")!.fidelity, "lossless");
  assert.equal(out.find((r) => r.id === "mp4")!.conversions!.find((c) => c.to === "wav")!.fidelity, "partial"); // video → audio only
  const png = out.find((r) => r.id === "png")!; // the family, not png-1-2, and not the text record
  assert.equal(png.conversions!.find((c) => c.to === "jpeg")!.command, "convert in.png out.jpg");
  assert.ok(!out.some((r) => r.id === "png-text"));
});

test("LibreOffice converts each kind to its own targets only", () => {
  const out = toRecords([libreoffice(true)!], resolver(RECORDS), "2026-10-20");
  const doc = out.find((r) => r.id === "doc")!;
  assert.deepEqual(doc.conversions!.map((c) => c.to).sort(), ["odt", "pdf"]);
  const xls = out.find((r) => r.id === "xls")!;
  assert.deepEqual(xls.conversions!.map((c) => c.to).sort(), ["csv", "pdf"]);
  assert.match(xls.conversions!.find((c) => c.to === "csv")!.losses!, /First sheet only/);
});

test("pandoc keeps only names with a known extension", () => {
  const p = pandoc("docx\nmarkdown\nnative\n", "html\nodt\njson\n")!;
  assert.deepEqual(p.reads, ["docx", "markdown"]);
  assert.deepEqual(p.writes, ["html", "odt"]);
  assert.equal(p.command("docx", "odt", "docx", "odt"), "pandoc -f docx -t odt in.docx -o out.odt");
});
