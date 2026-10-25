// OpenFormatDB importers: one module per external source, see SPEC.md (P2).
import pronom from "./sources/pronom.ts";
import wikidata from "./sources/wikidata.ts";
import ffw from "./sources/ffw.ts";
import kaitai from "./sources/kaitai.ts";
import converters from "./sources/converters.ts";
import engines from "./sources/engines.ts";
import type { Source } from "./lib.ts";

export * from "./lib.ts";

/** Registered sources, in run order: kaitai, converters and engines map onto the others, so they run last. */
export const SOURCES: Source[] = [pronom, wikidata, ffw, kaitai, converters, engines];
