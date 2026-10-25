// What each WebAssembly engine reads and writes, keyed by file extension. Metadata only: the
// engines themselves (src/run/*) are imported on demand, so this module stays small enough for
// the site's pages, the importer and the MCP server to load eagerly.

export type Fidelity = "lossless" | "lossy" | "partial";

export interface FormatDecl {
  /** Canonical extension, the key used everywhere (jpg, tiff, md). */
  ext: string;
  /** Other extensions meaning the same format (jpeg, tif, markdown). */
  exts?: string[];
  label: string;
  /** OpenFormatDB category, to map the extension onto the right record. */
  category: string;
  read?: boolean;
  write?: boolean;
  /** The engine's own name for it (ImageMagick format, Pandoc reader, GDAL driver…). */
  name?: string;
  /** Engine-specific grouping (GDAL raster or vector, FFmpeg audio or video). */
  kind?: string;
  /** OpenFormatDB record to attach it to, where the extension alone picks the wrong one. */
  id?: string;
}

export interface EngineInfo {
  id: string;
  /** Tool name shown to people and stored on conversions. */
  name: string;
  url: string;
  license: string;
  /** npm package holding the WebAssembly files, pinned. */
  package: { name: string; version: string };
  /** Files fetched at load time, relative to the package root. */
  assets: string[];
  formats: FormatDecl[];
  /** Extensions it converts to (each declared with write). */
  targets: string[];
  pairs?(from: FormatDecl, to: FormatDecl): boolean;
  fidelity(from: FormatDecl, to: FormatDecl): { fidelity: Fidelity; losses?: string };
}

const r = (ext: string, label: string, category: string, extra: Partial<FormatDecl> = {}): FormatDecl => ({ ext, label, category, read: true, ...extra });
const rw = (ext: string, label: string, category: string, extra: Partial<FormatDecl> = {}): FormatDecl => ({ ext, label, category, read: true, write: true, ...extra });
const w = (ext: string, label: string, category: string, extra: Partial<FormatDecl> = {}): FormatDecl => ({ ext, label, category, write: true, ...extra });

// ---------- ImageMagick ----------

const RAW = ["dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "orf", "rw2", "raf", "pef", "erf", "kdc", "dcr", "mrw", "mos", "3fr", "iiq", "x3f", "rwl", "srw", "mef"];
const LOSSY_IMAGE = new Set(["jpg", "webp", "avif", "gif", "jxl"]);

const imagemagick: EngineInfo = {
  id: "imagemagick",
  name: "ImageMagick (WebAssembly)",
  url: "https://github.com/dlemstra/magick-wasm",
  license: "Apache-2.0",
  package: { name: "@imagemagick/magick-wasm", version: "0.0.45" },
  assets: ["dist/x86/magick.wasm"],
  formats: [
    rw("png", "PNG", "image"),
    rw("jpg", "JPEG", "image", { exts: ["jpeg", "jpe", "jfif"], name: "JPEG" }),
    rw("gif", "GIF", "image"),
    rw("webp", "WebP", "image"),
    rw("avif", "AVIF", "image"),
    rw("jxl", "JPEG XL", "image"),
    r("heic", "HEIF / HEIC", "image", { exts: ["heif"] }),
    rw("tiff", "TIFF", "image", { exts: ["tif"] }),
    rw("bmp", "BMP", "image", { exts: ["dib"] }),
    rw("ico", "Windows icon", "image"),
    r("cur", "Windows cursor", "image"),
    rw("psd", "Photoshop document", "image"),
    rw("psb", "Photoshop large document", "image"),
    rw("tga", "Truevision TGA", "image", { exts: ["icb", "vda", "vst"] }),
    rw("qoi", "QOI", "image"),
    rw("jp2", "JPEG 2000", "image", { exts: ["j2k", "j2c", "jpc"] }),
    rw("pcx", "PCX", "image"),
    rw("ppm", "Portable pixmap", "image"),
    rw("pgm", "Portable graymap", "image"),
    rw("pbm", "Portable bitmap", "image"),
    rw("pnm", "Portable anymap", "image"),
    rw("pam", "Portable arbitrary map", "image"),
    rw("pfm", "Portable float map", "image"),
    rw("xpm", "X PixMap", "image"),
    rw("xbm", "X BitMap", "image"),
    rw("sgi", "Silicon Graphics image", "image", { exts: ["rgb", "bw"] }),
    rw("ras", "Sun raster", "image", { name: "SUN", exts: ["sun"] }),
    rw("dds", "DirectDraw Surface", "image"),
    rw("exr", "OpenEXR", "image"),
    rw("hdr", "Radiance HDR", "image"),
    rw("dpx", "DPX", "image"),
    rw("cin", "Cineon", "image"),
    rw("fits", "FITS", "image", { exts: ["fts", "fit"] }),
    r("xcf", "GIMP image", "image"),
    rw("wbmp", "Wireless bitmap", "image"),
    rw("pict", "Apple PICT", "image", { exts: ["pct"] }),
    rw("mng", "MNG", "image"),
    rw("jng", "JNG", "image"),
    rw("apng", "Animated PNG", "image"),
    rw("miff", "ImageMagick MIFF", "image"),
    rw("viff", "Khoros VIFF", "image", { exts: ["xv"] }),
    rw("wpg", "WordPerfect graphics", "image"),
    rw("ff", "farbfeld", "image", { name: "FARBFELD" }),
    r("dcm", "DICOM image", "medical", { exts: ["dicom"] }),
    rw("sixel", "Sixel", "image", { exts: ["six"] }),
    rw("otb", "Nokia OTA bitmap", "image"),
    rw("vicar", "VICAR", "image", { exts: ["vic"] }),
    rw("mtv", "MTV ray tracer", "image"),
    w("pdf", "PDF", "document"),
    w("eps", "Encapsulated PostScript", "vector-image"),
    ...RAW.map((e) => r(e, `${e.toUpperCase()} raw photo`, "raw-photo")),
  ],
  targets: ["png", "jpg", "webp", "avif", "jxl", "gif", "tiff", "bmp", "ico", "qoi", "pdf"],
  fidelity: (from, to) => {
    if (from.category === "raw-photo") return { fidelity: "partial", losses: "Demosaiced with default settings: raw sensor data and editing latitude are lost." };
    if (to.ext === "pdf") return { fidelity: "partial", losses: "The image is embedded in a PDF page." };
    if (to.ext === "ico") return { fidelity: "lossy", losses: "Icons are limited to 256 × 256 pixels." };
    if (LOSSY_IMAGE.has(to.ext)) return { fidelity: "lossy", losses: to.ext === "gif" ? "Reduced to 256 colours." : "Lossy compression." };
    return { fidelity: "lossless", losses: "Pixels kept; some metadata, colour profiles or layers may be dropped." };
  },
};

// ---------- resvg (SVG rendering: ImageMagick's WebAssembly build cannot read SVG) ----------

const resvg: EngineInfo = {
  id: "resvg",
  name: "resvg (WebAssembly)",
  url: "https://github.com/thx/resvg-js",
  license: "MPL-2.0",
  package: { name: "@resvg/resvg-wasm", version: "2.6.2" },
  assets: ["index_bg.wasm"],
  formats: [r("svg", "SVG", "vector-image"), w("png", "PNG", "image")],
  targets: ["png"],
  fidelity: () => ({ fidelity: "lossy", losses: "Rasterised: vectors and text become pixels. System fonts are not available, so text may be missing." }),
};

// ---------- FFmpeg ----------

const audio = (ext: string, label: string, extra: Partial<FormatDecl> = {}) => rw(ext, label, "audio", { kind: "audio", ...extra });
const video = (ext: string, label: string, extra: Partial<FormatDecl> = {}) => rw(ext, label, "video", { kind: "video", ...extra });
const LOSSY_AUDIO = new Set(["mp3", "ogg", "opus", "m4a"]);
const AUDIO_TARGETS = new Set(["mp3", "wav", "flac", "ogg", "opus", "m4a"]);

const ffmpeg: EngineInfo = {
  id: "ffmpeg",
  name: "FFmpeg (WebAssembly)",
  url: "https://github.com/ffmpegwasm/ffmpeg.wasm",
  license: "GPL-2.0-or-later",
  package: { name: "@ffmpeg/core", version: "0.12.10" },
  assets: ["dist/esm/ffmpeg-core.wasm"],
  formats: [
    audio("mp3", "MP3"), audio("wav", "WAV", { exts: ["wave"] }), audio("flac", "FLAC"), audio("ogg", "Ogg Vorbis", { exts: ["oga"] }),
    audio("opus", "Opus", { id: "ogg-opus-codec-compressed-multimedia-file" }), audio("m4a", "MPEG-4 audio", { exts: ["m4b"], id: "advanced-audio-coding" }), audio("aac", "AAC (ADTS)", { write: false, id: "audio-data-transport-stream" }),
    audio("ac3", "Dolby AC-3", { write: false }), audio("eac3", "Dolby E-AC-3", { write: false }), audio("aiff", "AIFF", { exts: ["aif", "aifc"], write: false }),
    audio("au", "Sun audio", { exts: ["snd"], write: false }), audio("caf", "Core Audio Format", { write: false, id: "core-audio-format" }), audio("amr", "AMR", { write: false }),
    audio("wma", "Windows Media Audio", { write: false }), audio("ape", "Monkey's Audio", { write: false }), audio("wv", "WavPack", { write: false }),
    audio("tta", "True Audio", { write: false }), audio("mka", "Matroska audio", { write: false }), audio("dts", "DTS", { write: false }),
    audio("spx", "Speex", { write: false, id: "speex" }), audio("voc", "Creative Voice", { write: false }),
    audio("w64", "Sony Wave64", { write: false }), audio("mpc", "Musepack", { write: false }), audio("tak", "TAK", { write: false }),
    video("mp4", "MPEG-4 video", { exts: ["m4v"] }), video("mov", "QuickTime", { exts: ["qt"] }), video("mkv", "Matroska", { name: "matroska" }),
    video("webm", "WebM"), video("avi", "AVI"), video("flv", "Flash Video", { write: false }), video("wmv", "Windows Media Video", { exts: ["asf"], write: false }),
    video("mpg", "MPEG program stream", { exts: ["mpeg", "m2v", "vob"], write: false }), video("ts", "MPEG transport stream", { exts: ["m2ts", "mts"], write: false }),
    video("3gp", "3GPP", { write: false, id: "3gp-and-3g2" }), video("3g2", "3GPP2", { write: false }), video("ogv", "Ogg video", { write: false }), video("mxf", "MXF", { write: false }),
    video("nut", "NUT", { write: false }), video("f4v", "F4V", { write: false }), video("dv", "DV", { write: false }),
    video("y4m", "YUV4MPEG2", { write: false }),
    rw("gif", "GIF", "image", { kind: "animation" }),
  ],
  targets: ["mp4", "webm", "mkv", "mov", "avi", "gif", "mp3", "wav", "flac", "ogg", "opus", "m4a"],
  // Audio stays audio; an animated GIF only becomes a video.
  pairs: (from, to) => (from.kind === "audio" ? AUDIO_TARGETS.has(to.ext) : from.kind === "animation" ? to.kind === "video" : true),
  fidelity: (from, to) => {
    if (to.ext === "flac" || to.ext === "wav") return from.kind === "audio"
      ? { fidelity: "lossless", losses: "Lossless for decoded audio; a lossy source stays as degraded as it was." }
      : { fidelity: "partial", losses: "Audio track only: the video is dropped." };
    if (LOSSY_AUDIO.has(to.ext)) return { fidelity: from.kind === "audio" ? "lossy" : "partial", losses: from.kind === "audio" ? "Lossy re-encoding." : "Lossy audio only: the video is dropped." };
    if (to.ext === "gif") return { fidelity: "lossy", losses: "10 frames per second, at most 480 pixels wide, 256 colours, no sound." };
    return { fidelity: "lossy", losses: "Re-encoded with lossy codecs (H.264/AAC, or VP8/Vorbis for WebM)." };
  },
};

// ---------- Pandoc ----------

const doc = (ext: string, label: string, name: string, category = "document", extra: Partial<FormatDecl> = {}) => rw(ext, label, category, { name, ...extra });

const pandoc: EngineInfo = {
  id: "pandoc",
  name: "Pandoc (WebAssembly)",
  url: "https://pandoc.org",
  license: "GPL-2.0-or-later",
  package: { name: "pandoc-wasm", version: "1.1.0" },
  assets: ["src/pandoc.wasm"],
  formats: [
    doc("md", "Markdown", "markdown", "markup", { exts: ["markdown", "mdown", "mkd"] }),
    doc("docx", "Word document", "docx", "document", { id: "office-open-xml-wordprocessing-document-ecma-376-1st-edition" }),
    doc("odt", "OpenDocument text", "odt"),
    doc("html", "HTML", "html", "markup", { exts: ["htm", "xhtml"] }),
    doc("epub", "EPUB", "epub", "ebook"),
    doc("rtf", "Rich Text Format", "rtf"),
    doc("tex", "LaTeX", "latex", "markup", { exts: ["latex", "ltx"] }),
    doc("rst", "reStructuredText", "rst", "markup"),
    doc("adoc", "AsciiDoc", "asciidoc", "markup", { exts: ["asciidoc"] }),
    doc("org", "Org mode", "org", "markup"),
    doc("textile", "Textile", "textile", "markup"),
    doc("wiki", "MediaWiki markup", "mediawiki", "markup", { exts: ["mediawiki"], id: "mediawiki" }),
    doc("fb2", "FictionBook", "fb2", "ebook"),
    doc("ipynb", "Jupyter notebook", "ipynb", "document"),
    doc("opml", "OPML", "opml", "markup"),
    doc("typ", "Typst", "typst", "markup"),
    doc("dbk", "DocBook", "docbook", "markup", { exts: ["docbook"] }),
    doc("muse", "Emacs Muse", "muse", "markup"),
    doc("t2t", "txt2tags", "t2t", "markup", { write: false }),
    doc("dj", "Djot", "djot", "markup", { exts: ["djot"] }),
    doc("pptx", "PowerPoint presentation", "pptx", "presentation", { id: "office-open-xml-presentation-document-ecma-376-1st-edition" }),
    r("xlsx", "Excel workbook", "spreadsheet", { name: "xlsx", id: "office-open-xml-spreadsheet-document-ecma-376-1st-edition" }),
    r("csv", "CSV", "dataset", { name: "csv" }),
    r("tsv", "TSV", "dataset", { name: "tsv", exts: ["tab"] }),
    r("pod", "Perl POD", "markup", { name: "pod" }),
    w("txt", "Plain text", "text", { name: "plain", exts: ["text"] }),
    w("texi", "Texinfo", "markup", { name: "texinfo", exts: ["texinfo"] }),
    w("icml", "InDesign ICML", "markup", { name: "icml" }),
  ],
  targets: ["docx", "odt", "html", "md", "epub", "rtf", "tex", "txt", "pptx", "typ", "rst", "adoc", "org", "ipynb", "fb2", "dbk"],
  fidelity: (_from, to) => ({ fidelity: "partial", losses: to.ext === "txt" ? "Text only: all formatting is dropped." : "Document structure is kept; layout, styles and unsupported elements are lost." }),
};

// ---------- 7-Zip ----------

const arc = (ext: string, label: string, extra: Partial<FormatDecl> = {}) => r(ext, label, "archive", extra);

const sevenzip: EngineInfo = {
  id: "7zip",
  name: "7-Zip (WebAssembly)",
  url: "https://github.com/use-strict/7z-wasm",
  license: "LGPL-2.1-or-later (unRAR restriction)",
  package: { name: "7z-wasm", version: "1.2.0" },
  assets: ["7zz.wasm"],
  formats: [
    arc("7z", "7z archive", { write: true }), arc("zip", "ZIP archive", { write: true }), arc("tar", "tar archive", { write: true }),
    arc("gz", "gzip", { exts: ["gzip", "tgz"] }), arc("bz2", "bzip2", { exts: ["bzip2", "tbz", "tbz2"], id: "bzip2" }), arc("xz", "xz", { exts: ["txz"], id: "xz" }),
    arc("lzma", "LZMA"), arc("z", "Unix compress", { exts: ["taz"], id: "compress-unix" }), arc("rar", "RAR archive"), arc("cab", "Cabinet archive"),
    arc("arj", "ARJ archive"), arc("lzh", "LHA archive", { exts: ["lha"] }), arc("cpio", "cpio archive"), arc("rpm", "RPM package"),
    arc("deb", "Debian package"), arc("wim", "Windows Imaging"), arc("chm", "Compiled HTML Help", { category: "document" }),
    arc("msi", "Windows Installer package", { category: "executable" }), arc("iso", "ISO 9660 image", { category: "disk-image", id: "iso-image" }),
    arc("dmg", "Apple disk image", { category: "disk-image", id: "apple-disk-image" }), arc("vhd", "Virtual Hard Disk", { category: "disk-image" }),
    arc("vhdx", "Virtual Hard Disk v2", { category: "disk-image" }), arc("squashfs", "SquashFS", { category: "filesystem", exts: ["sfs"] }),
  ],
  targets: ["zip", "7z", "tar"],
  fidelity: (from) => ({ fidelity: "lossless", losses: from.category === "archive" ? "Files are kept; archive comments, permissions or encryption may not be." : "The files inside are extracted and repacked; boot records and filesystem metadata are not kept." }),
};

// ---------- GDAL ----------

const vec = (ext: string, label: string, name: string, extra: Partial<FormatDecl> = {}) => rw(ext, label, "gis", { name, kind: "vector", ...extra });
const ras = (ext: string, label: string, name: string, extra: Partial<FormatDecl> = {}) => rw(ext, label, "gis", { name, kind: "raster", ...extra });

const gdal: EngineInfo = {
  id: "gdal",
  name: "GDAL (WebAssembly)",
  url: "https://gdal3.js.org",
  license: "LGPL-2.1-or-later / MIT",
  package: { name: "gdal3.js", version: "2.8.1" },
  assets: ["dist/package/gdal3WebAssembly.wasm", "dist/package/gdal3WebAssembly.data"],
  formats: [
    vec("geojson", "GeoJSON", "GeoJSON"),
    vec("kml", "KML", "KML"),
    vec("gpx", "GPX", "GPX"),
    vec("gml", "GML", "GML", { id: "geography-markup-language" }),
    vec("gpkg", "GeoPackage", "GPKG"),
    vec("fgb", "FlatGeobuf", "FlatGeobuf"),
    vec("dxf", "AutoCAD DXF", "DXF", { category: "cad", id: "dxf" }),
    vec("csv", "CSV (with WKT geometry)", "CSV", { category: "dataset", read: false }),
    vec("topojson", "TopoJSON", "TopoJSON", { write: false, id: "topojson" }),
    vec("osm", "OpenStreetMap XML", "OSM", { write: false }),
    vec("pbf", "OpenStreetMap PBF", "OSM", { write: false, id: "protocolbuffer-binary-format" }),
    vec("e00", "Arc/Info export", "AVCE00", { write: false }),
    ras("tiff", "GeoTIFF", "GTiff", { exts: ["tif"], id: "geotiff" }),
    ras("asc", "Esri ASCII grid", "AAIGrid", { id: "esri-arc-info-ascii-grid" }),
    ras("xyz", "XYZ grid", "XYZ"),
    ras("hgt", "SRTM height", "SRTMHGT", { write: false }),
    ras("dem", "USGS DEM", "USGSDEM", { write: false }),
    ras("img", "ERDAS Imagine", "HFA", { write: false, id: "erdas-imagine-img" }),
    ras("grb", "GRIB", "GRIB", { exts: ["grib", "grib2", "grb2"], write: false, category: "scientific" }),
    ras("bt", "VTP binary terrain", "BT", { write: false }),
    ras("kap", "BSB nautical chart", "BSB", { write: false }),
    ras("dt0", "DTED", "DTED", { exts: ["dt1", "dt2"], write: false }),
    w("png", "PNG", "image", { name: "PNG", kind: "raster" }),
  ],
  targets: ["geojson", "kml", "gpx", "gpkg", "fgb", "gml", "dxf", "csv", "tiff", "asc", "xyz", "png"],
  // Vector to vector, raster to raster. The GeoTIFF/TIFF and DXF extensions are shared with other
  // engines, which handle them as plain images and 3D models.
  pairs: (from, to) => from.kind === to.kind,
  fidelity: (from, to) => to.ext === "png"
    ? { fidelity: "lossy", losses: "Values scaled to 8-bit greyscale for viewing; georeferencing is dropped." }
    : from.kind === "raster"
      ? { fidelity: "lossless", losses: "Values kept; some metadata or band descriptions may be dropped." }
      : { fidelity: "partial", losses: "Geometries and attributes are kept as far as the target allows (GPX takes only points and lines, DXF drops attributes)." },
};

// ---------- assimp ----------

const m3d = (ext: string, label: string, extra: Partial<FormatDecl> = {}) => r(ext, label, "3d", extra);

const assimp: EngineInfo = {
  id: "assimp",
  name: "Assimp (WebAssembly)",
  url: "https://github.com/kovacsv/assimpjs",
  license: "BSD-3-Clause / MIT",
  package: { name: "assimpjs", version: "0.0.10" },
  assets: ["dist/assimpjs.wasm"],
  formats: [
    m3d("obj", "Wavefront OBJ"), m3d("fbx", "Autodesk FBX"), m3d("dae", "COLLADA"), m3d("3ds", "3D Studio"), m3d("stl", "STL", { category: "cad" }),
    m3d("ply", "PLY"), m3d("glb", "glTF binary", { write: true }), m3d("gltf", "glTF", { write: true }), m3d("blend", "Blender"),
    m3d("x", "DirectX model"), m3d("off", "Object File Format"), m3d("lwo", "LightWave object"), m3d("ac", "AC3D"),
    m3d("ms3d", "MilkShape 3D"), m3d("md2", "Quake II model"), m3d("md3", "Quake III model"), m3d("md5mesh", "Doom 3 model"),
    m3d("3mf", "3D Manufacturing Format", { category: "cad" }), m3d("x3d", "X3D"), m3d("ase", "3ds Max ASCII scene"), m3d("b3d", "Blitz3D", { id: "blitz3d-file-format" }),
    m3d("ogex", "Open Game Engine Exchange"), m3d("smd", "Valve SMD", { id: "studiomdl-data" }), m3d("cob", "Caligari trueSpace"), m3d("dxf", "AutoCAD DXF", { category: "cad", id: "dxf" }),
  ],
  targets: ["glb", "gltf"],
  fidelity: () => ({ fidelity: "partial", losses: "Meshes, materials and the scene graph are kept; animations, cameras and format-specific data may be lost. glTF is written as a .gltf and a .bin." }),
};

/** Engines, in order of preference when two can do the same step. */
export const ENGINES: EngineInfo[] = [imagemagick, resvg, ffmpeg, pandoc, sevenzip, gdal, assimp];

export const engineById = (id: string) => ENGINES.find((e) => e.id === id);
