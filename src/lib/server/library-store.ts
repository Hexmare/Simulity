import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Kit } from "@/sim/types";
import type { JsonValue, LibraryCatalog, LibraryCollection } from "@/lib/library-shared";
import { LIBRARY_COLLECTIONS } from "@/lib/library-shared";

export { LIBRARY_COLLECTIONS, type JsonValue, type LibraryCatalog, type LibraryCollection } from "@/lib/library-shared";

/** Writable server directory for custom Library files (override for tests). */
export function libraryRoot(): string {
  const override = typeof process !== "undefined" ? process.env.SIMULITY_LIBRARY_DIR?.trim() : "";
  return override || "./data/library";
}

const kitsDir = (root: string) => path.join(root, "kits");
const catalogDir = (root: string) => path.join(root, "catalog");
const catalogFile = (root: string, collection: string) => path.join(catalogDir(root), `${collection}.json`);

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertKitFileId(id: string): void {
  if (!UUID_V4_RE.test(id)) throw new Error(`Refusing to touch a kit file with a non-UUID name.`);
}

function assertCollection(collection: string): asserts collection is LibraryCollection {
  if (!(LIBRARY_COLLECTIONS as readonly string[]).includes(collection)) {
    throw new Error(`Unknown collection “${collection}”.`);
  }
}

function isKitLike(k: unknown): k is Kit {
  return !!k && typeof (k as Kit).id === "string" && Array.isArray((k as Kit).buildings);
}

function isRowLike(r: unknown): r is Record<string, JsonValue> {
  return !!r && typeof r === "object" && !Array.isArray(r);
}

/** Atomic write (tmp + rename) so a crash never leaves half a file. */
async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

async function readJsonFile(file: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    console.warn(`[library] skipping unparseable file (kept on disk): ${file}`);
    return undefined;
  }
}

export async function readLibraryKits(root: string = libraryRoot()): Promise<Kit[]> {
  await ensureLibraryMigrated(root);
  let names: string[];
  try {
    names = await readdir(kitsDir(root));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  const kits: Kit[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const raw = await readJsonFile(path.join(kitsDir(root), name));
    if (isKitLike(raw)) kits.push(raw);
    else console.warn(`[library] skipping non-kit file (kept on disk): ${name}`);
  }
  return kits;
}

export async function putLibraryKit(kit: Kit, root: string = libraryRoot()): Promise<void> {
  assertKitFileId(kit.id);
  if (!isKitLike(kit)) throw new Error("Kit must be an object with a buildings list.");
  await ensureLibraryMigrated(root);
  await writeJsonFile(path.join(kitsDir(root), `${kit.id}.json`), kit);
}

export async function deleteLibraryKit(id: string, root: string = libraryRoot()): Promise<void> {
  assertKitFileId(String(id ?? ""));
  await ensureLibraryMigrated(root);
  try {
    await unlink(path.join(kitsDir(root), `${id}.json`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

export async function readLibraryCatalog(root: string = libraryRoot()): Promise<LibraryCatalog> {
  await ensureLibraryMigrated(root);
  const catalog: LibraryCatalog = {};
  for (const collection of LIBRARY_COLLECTIONS) {
    const raw = await readJsonFile(catalogFile(root, collection));
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      console.warn(`[library] skipping non-array collection file (kept on disk): ${collection}.json`);
      continue;
    }
    catalog[collection] = raw.filter(isRowLike) as JsonValue[];
  }
  return catalog;
}

/**
 * Upsert rows into a collection file (matched by row id). The `names` and
 * `setting` collections are single docs: saving replaces the whole list.
 */
export async function putLibraryCatalogRows(
  collection: string,
  rows: JsonValue[],
  root: string = libraryRoot(),
): Promise<LibraryCatalog> {
  assertCollection(collection);
  if (!Array.isArray(rows)) throw new Error("Rows must be an array.");
  await ensureLibraryMigrated(root);
  const file = catalogFile(root, collection);
  const raw = await readJsonFile(file);
  const prev: JsonValue[] = Array.isArray(raw) ? raw.filter(isRowLike) : [];
  let next: JsonValue[];
  if (collection === "names" || collection === "setting") {
    next = rows.filter(isRowLike);
  } else {
    next = [...prev];
    for (const row of rows) {
      if (!isRowLike(row)) continue;
      const id = (row as { id?: unknown }).id;
      const at = typeof id === "string" ? next.findIndex((x) => isRowLike(x) && (x as { id?: unknown }).id === id) : -1;
      if (at >= 0) next[at] = row;
      else next.push(row);
    }
  }
  await writeJsonFile(file, next);
  return readLibraryCatalog(root);
}

export async function deleteLibraryCatalogRow(
  collection: string,
  id: string,
  root: string = libraryRoot(),
): Promise<LibraryCatalog> {
  assertCollection(collection);
  await ensureLibraryMigrated(root);
  const file = catalogFile(root, collection);
  const raw = await readJsonFile(file);
  const prev: JsonValue[] = Array.isArray(raw) ? raw.filter(isRowLike) : [];
  await writeJsonFile(
    file,
    prev.filter((x) => !isRowLike(x) || (x as { id?: unknown }).id !== String(id ?? "")),
  );
  return readLibraryCatalog(root);
}

// ---- One-time move from the short-lived PGLite kv backend ----

const SENTINEL = ".migrated-kv";
let migrationAttempted = false;

/**
 * The Library shipped once with PGLite `app_kv` storage; the specs require
 * JSON files. If files already exist there is nothing to do. Otherwise copy
 * any kv rows over once, then remove the kv keys so files are the only source
 * of truth. Skipped in unit tests (SIMULITY_NO_DB_BOOT): files are the store.
 */
export async function ensureLibraryMigrated(root: string = libraryRoot()): Promise<void> {
  if (migrationAttempted) return;
  migrationAttempted = true;
  if (typeof process !== "undefined" && process.env.SIMULITY_NO_DB_BOOT) return;
  try {
    const sentinel = path.join(root, SENTINEL);
    const done = await readJsonFile(sentinel);
    if (done !== undefined) return;
    const [kits, catalog] = await Promise.all([readLibraryKitsFromKv(), readLibraryCatalogFromKv()]);
    const hasFiles = (await readLibraryKits(root)).length > 0 || Object.keys(await readLibraryCatalog(root)).length > 0;
    if (!hasFiles) {
      for (const kit of kits) {
        try {
          await putLibraryKit(kit, root);
        } catch {
          /* skip invalid rows */
        }
      }
      for (const [collection, rows] of Object.entries(catalog)) {
        try {
          assertCollection(collection);
          await writeJsonFile(catalogFile(root, collection), rows.filter(isRowLike));
        } catch {
          /* skip invalid rows */
        }
      }
    }
    await removeLibraryKv();
    await writeJsonFile(sentinel, { at: Date.now() });
  } catch (err) {
    console.warn("[library] kv migration skipped:", err instanceof Error ? err.message : err);
  }
}

async function readLibraryKitsFromKv(): Promise<Kit[]> {
  const { readKv, LIBRARY_KV_KEYS } = await import("@/lib/server/store");
  const raw = await readKv(LIBRARY_KV_KEYS.kits);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isKitLike);
}

async function readLibraryCatalogFromKv(): Promise<LibraryCatalog> {
  const { readKv, LIBRARY_KV_KEYS } = await import("@/lib/server/store");
  const raw = await readKv(LIBRARY_KV_KEYS.catalog);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: LibraryCatalog = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter(isRowLike) as JsonValue[];
  }
  return out;
}

async function removeLibraryKv(): Promise<void> {
  const { deleteKv, LIBRARY_KV_KEYS } = await import("@/lib/server/store");
  await deleteKv(LIBRARY_KV_KEYS.kits);
  await deleteKv(LIBRARY_KV_KEYS.catalog);
}
