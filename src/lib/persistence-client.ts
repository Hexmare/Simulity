import {
  deleteTownFn,
  duplicateTownFn,
  exportTownFn,
  getLlmSettingsFn,
  getTownFn,
  importLegacyFn,
  importTownFn,
  listTownsFn,
  putLlmBundleFn,
  getLlmBundleFn,
  putLlmSettingsFn,
  putTownFn,
  renameTownFn,
} from "@/lib/server/persistence";
import {
  LEGACY_INDEX_KEY,
  LEGACY_LAST_KEY,
  LEGACY_TOWN_PREFIX,
  hydrateWorld,
  snapshotWorld,
  townKey,
  type TownMeta,
  type TownSave,
} from "@/sim/persist";
import { World } from "@/sim/world";
import { SETTINGS_KEY, rememberSettings, withDefaults, type LlmSettings } from "@/lib/llm/settings";
import type { LlmBundle } from "@/lib/llm/bundle";

export async function listTowns(): Promise<{ towns: TownMeta[]; lastId: string | null }> {
  return listTownsFn({ data: {} });
}

export async function loadTown(id: string): Promise<World | null> {
  const save = await getTownFn({ data: { id } });
  if (!save) return null;
  return hydrateWorld(save);
}

export async function putTown(world: World): Promise<TownSave> {
  const save = snapshotWorld(world);
  await putTownFn({ data: { save } });
  world.createdAt = save.createdAt;
  return save;
}

export async function createTown(name: string, seed: number): Promise<World> {
  const world = new World(seed);
  // Empty name keeps the kit's label ("Fenwick Ward" by default).
  if (name.trim()) world.townName = name.trim();
  await putTown(world);
  return world;
}

export async function renameTown(id: string, name: string): Promise<boolean> {
  return renameTownFn({ data: { id, name } });
}

export async function deleteTown(id: string): Promise<void> {
  await deleteTownFn({ data: { id } });
}

export async function duplicateTown(id: string): Promise<TownSave | null> {
  return duplicateTownFn({ data: { id } });
}

export async function importTown(raw: unknown): Promise<TownSave | null> {
  return importTownFn({ data: { raw } });
}

export async function exportTown(id: string): Promise<string | null> {
  return exportTownFn({ data: { id } });
}

export async function loadSettings(): Promise<LlmSettings> {
  const next = await getLlmSettingsFn({ data: {} });
  return rememberSettings(next);
}

export async function saveSettings(s: LlmSettings): Promise<LlmSettings> {
  const next = await putLlmSettingsFn({ data: { settings: withDefaults(s) } });
  return rememberSettings(next);
}

export async function loadBundle(): Promise<LlmBundle> {
  return getLlmBundleFn({ data: {} });
}

export async function saveBundle(bundle: LlmBundle): Promise<LlmBundle> {
  return putLlmBundleFn({ data: { bundle } });
}

/**
 * If this browser still has old Fenwick localStorage saves and the server
 * store is empty, lift them once, then drop the browser copies.
 */
export async function migrateBrowserStoreIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;
  let ls: Storage;
  try {
    ls = window.localStorage;
  } catch {
    return;
  }
  const towns: unknown[] = [];
  try {
    const indexRaw = ls.getItem(LEGACY_INDEX_KEY);
    const index = indexRaw ? (JSON.parse(indexRaw) as Array<{ id?: string }>) : [];
    if (Array.isArray(index)) {
      for (const row of index) {
        if (!row?.id) continue;
        const raw = ls.getItem(townKey(row.id));
        if (!raw) continue;
        try {
          towns.push(JSON.parse(raw));
        } catch {
          /* skip corrupt town */
        }
      }
    }
  } catch {
    /* ignore */
  }
  let settings: Partial<LlmSettings> | null = null;
  try {
    const raw = ls.getItem(SETTINGS_KEY);
    if (raw) settings = withDefaults(JSON.parse(raw) as Partial<LlmSettings>);
  } catch {
    settings = null;
  }
  const lastId = ls.getItem(LEGACY_LAST_KEY);
  if (towns.length === 0 && !settings && !lastId) return;

  const result = await importLegacyFn({
    data: { towns, lastId, settings },
  });

  if (result.importedTowns > 0 || result.importedSettings || lastId) {
    try {
      ls.removeItem(LEGACY_INDEX_KEY);
      ls.removeItem(LEGACY_LAST_KEY);
      ls.removeItem(SETTINGS_KEY);
      const toRemove: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i);
        if (key && key.startsWith(LEGACY_TOWN_PREFIX)) toRemove.push(key);
      }
      for (const key of toRemove) ls.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
