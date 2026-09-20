import {
  deleteCatalogRowFn,
  deleteKitFn,
  listLibraryFn,
  putCatalogRowsFn,
  putKitFn,
  type JsonValue,
  type LibraryCatalog,
} from "@/lib/server/library";
import type { Kit } from "@/sim/types";

export type { JsonValue, LibraryCatalog };

export async function listLibrary(): Promise<{ kits: Kit[]; catalog: LibraryCatalog }> {
  return listLibraryFn({ data: {} });
}

export async function saveKit(kit: Kit): Promise<{ kits: Kit[]; warnings: string[] }> {
  return putKitFn({ data: { kit: kit as unknown as Record<string, JsonValue> } });
}

export async function removeKit(id: string): Promise<{ kits: Kit[] }> {
  return deleteKitFn({ data: { id } });
}

export async function saveCatalogRows(collection: string, rows: JsonValue[]): Promise<{ catalog: LibraryCatalog }> {
  return putCatalogRowsFn({ data: { collection, rows } });
}

export async function removeCatalogRow(collection: string, id: string): Promise<{ catalog: LibraryCatalog }> {
  return deleteCatalogRowFn({ data: { collection, id } });
}
