import { createServerFn } from "@tanstack/react-start";
import { withDefaults, type LlmSettings } from "@/lib/llm/settings";
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
import { isSave, migrate, metaOf, type TownMeta, type TownSave } from "@/sim/persist";

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
    if (!isSave(data.save)) throw new Error("Invalid borough save.");
    return writeTown(migrate(data.save));
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
    if (!isSave(data.raw)) return null;
    const save = migrate(data.raw);
    save.id = crypto.randomUUID();
    save.updatedAt = Date.now();
    save.createdAt = save.createdAt || Date.now();
    if (!save.name) save.name = "Fenwick";
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

export const importLegacyFn = createServerFn({ method: "POST" })
  .validator((input: { towns?: unknown[]; lastId?: string | null; settings?: Partial<LlmSettings> | null }) => input)
  .handler(async ({ data }) => importLegacyBatch(data));

export const townMeta = metaOf;
