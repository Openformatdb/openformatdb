// OpenFormatDB importers: one module per external source, see SPEC.md (P2).
import pronom from "./sources/pronom.ts";
import wikidata from "./sources/wikidata.ts";
import type { Source } from "./lib.ts";

export * from "./lib.ts";

/** Registered sources, in priority order. */
export const SOURCES: Source[] = [pronom, wikidata];
