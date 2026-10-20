// OpenFormatDB importers: one module per external source, see SPEC.md (P2).
import pronom from "./sources/pronom.ts";
import wikidata from "./sources/wikidata.ts";
import converters from "./sources/converters.ts";
import type { Source } from "./lib.ts";

export * from "./lib.ts";

/** Registered sources, in run order: converters maps onto the others, so it runs last. */
export const SOURCES: Source[] = [pronom, wikidata, converters];
