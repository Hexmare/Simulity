import { createServerFn } from "@tanstack/react-start";
import { withDefaults, type LlmSettings } from "@/lib/llm/settings";
import { maskBundle, readBundle, writeBundle, type LlmBundle } from "@/lib/server/profiles";
import {
  importLegacyBatch,
  listTownMetas,
  readLastTownId,
  readLlmSettings,
  readTown,
  removeTown,
  writeLastTownId,
  writeLlmSettings,
  writeTown,
} from "@/lib/server/store";
import { getKit } from "@/sim/kits";
import { hydrateWorld, metaOf, snapshotWorld, type TownMeta, type TownSave } from "@/sim/persist";

function asSave(raw: unknown): TownSave | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as TownSave;
  if (typeof s.id !== "string" || typeof s.name !== "string" || !s.map || !s.player) return null;
  try {
    return snapshotWorld(hydrateWorld(s));
  } catch {
    return null;
  }
}

export const listTownsFn = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(async (): Promise<{ towns: TownMeta[]; lastId: string | null }> => {
    const [towns, lastId] = await Promise.all([listTownMetas(), readLastTownId()]);
    return { towns, lastId };
  });

export const getTownFn = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<TownSave | null> => {
    const id = String(data.id ?? "").trim();
    if (!id) return null;
    const save = await readTown(id);
    if (save) await writeLastTownId(id);
    return save;
  });

export const putTownFn = createServerFn({ method: "POST" })
  .validator((input: { save: unknown }) => input)
  .handler(async ({ data }): Promise<TownMeta> => {
    const save = asSave(data.save);
    if (!save) throw new Error("Invalid borough save.");
    return writeTown(save);
  });

export const renameTownFn = createServerFn({ method: "POST" })
  .validator((input: { id: string; name: string }) => input)
  .handler(async ({ data }): Promise<boolean> => {
    const save = await readTown(String(data.id ?? ""));
    if (!save) return false;
    save.name = String(data.name ?? "").trim() || save.name;
    save.updatedAt = Date.now();
    await writeTown(save);
    return true;
  });

export const deleteTownFn = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<void> => {
    const id = String(data.id ?? "").trim();
    if (id) await removeTown(id);
  });

export const duplicateTownFn = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<TownSave | null> => {
    const save = await readTown(String(data.id ?? ""));
    if (!save) return null;
    const copy: TownSave = {
      ...structuredClone(save),
      id: crypto.randomUUID(),
      name: `${save.name} copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await writeTown(copy);
    return copy;
  });

export const importTownFn = createServerFn({ method: "POST" })
  .validator((input: { raw: unknown }) => input)
  .handler(async ({ data }): Promise<TownSave | null> => {
    const parsed = asSave(data.raw);
    if (!parsed) return null;
    const save = parsed;
    save.id = crypto.randomUUID();
    save.updatedAt = Date.now();
    save.createdAt = save.createdAt || Date.now();
    if (!save.name) {
      try {
        save.name = getKit(save.kitId).label;
      } catch {
        save.name = "Shadows Veil"; // Unknown saved kit — default city label.
      }
    }
    await writeTown(save);
    return save;
  });

export const exportTownFn = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<string | null> => {
    const save = await readTown(String(data.id ?? ""));
    if (!save) return null;
    return JSON.stringify(save, null, 2);
  });

export const getLlmSettingsFn = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(async (): Promise<LlmSettings> => withDefaults(await readLlmSettings()));

export const putLlmSettingsFn = createServerFn({ method: "POST" })
  .validator((input: { settings: LlmSettings }) => input)
  .handler(async ({ data }): Promise<LlmSettings> => writeLlmSettings(withDefaults(data.settings)));

export const getLlmBundleFn = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(async (): Promise<LlmBundle> => maskBundle(await readBundle()));

export const putLlmBundleFn = createServerFn({ method: "POST" })
  .validator((input: { bundle: LlmBundle }) => input)
  .handler(async ({ data }): Promise<LlmBundle> => {
    const prev = await readBundle();
    const next = data.bundle;
    // Keep real keys if the client sent a mask.
    for (const p of next.profiles) {
      const old = prev.profiles.find((x) => x.id === p.id);
      if (old && (!p.apiKey || p.apiKey.startsWith("••••"))) p.apiKey = old.apiKey;
    }
    await writeBundle(next);
    return maskBundle(next);
  });

export const importLegacyFn = createServerFn({ method: "POST" })
  .validator((input: { towns?: unknown[]; lastId?: string | null; settings?: Partial<LlmSettings> | null }) => input)
  .handler(async ({ data }) => importLegacyBatch(data));

export const townMeta = metaOf;
