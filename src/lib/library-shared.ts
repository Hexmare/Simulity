/** Client-safe Library types + collection list (no node imports — do not add any). */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type LibraryCatalog = Record<string, JsonValue[]>;

export const LIBRARY_COLLECTIONS = [
  "ancestries",
  "buildings",
  "commodities",
  "goals",
  "jobs",
  "names",
  "needs",
  "setting",
  "social",
  "spells",
  "traits",
  "garments",
  "businessTypes",
] as const;

export type LibraryCollection = (typeof LIBRARY_COLLECTIONS)[number];
