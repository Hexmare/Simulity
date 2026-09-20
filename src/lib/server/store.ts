import { getSql } from "@/lib/db";
import type { LlmSettings } from "@/lib/llm/settings";
import {
  hydrateWorld,
  metaOf,
  snapshotWorld,
  type TownMeta,
  type TownSave,
} from "@/sim/persist";

const SETTINGS_KEY = "llm_settings";
const LAST_TOWN_KEY = "last_town_id";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toSave(raw: unknown): TownSave | null {
  const obj = asObject(raw);
  if (!obj) return null;
  if (typeof obj.id !== "string" || typeof obj.name !== "string" || !obj.map || !obj.player) return null;
  try {
    return snapshotWorld(hydrateWorld(obj as unknown as TownSave));
  } catch {
    return null;
  }
}

function metaFromRow(row: Record<string, unknown>): TownMeta {
  return {
    id: String(row.id),
    name: String(row.name),
    seed: Number(row.seed) || 0,
    createdAt: Number(row.created_at_ms) || 0,
    updatedAt: Number(row.updated_at_ms) || 0,
    souls: Number(row.souls) || 0,
    buildings: Number(row.buildings) || 0,
    day: Number(row.day) || 1,
    hour: Number(row.hour) || 0,
  };
}

export async function listTownMetas(): Promise<TownMeta[]> {
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    "select id, name, seed, created_at_ms, updated_at_ms, souls, buildings, day, hour from towns order by updated_at_ms desc",
  );
  return rows.map(metaFromRow);
}

export async function readTown(id: string): Promise<TownSave | null> {
  const sql = await getSql();
  const rows = await sql.query<{ save: unknown }>("select save from towns where id = $1", [id]);
  if (!rows[0]) return null;
  return toSave(rows[0].save);
}

export async function writeTown(save: TownSave): Promise<TownMeta> {
  const next = toSave(save) ?? save;
  const meta = metaOf(next);
  const sql = await getSql();
  await sql.query(
    `insert into towns (id, name, seed, created_at_ms, updated_at_ms, souls, buildings, day, hour, save)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     on conflict (id) do update set
       name = excluded.name,
       seed = excluded.seed,
       created_at_ms = excluded.created_at_ms,
       updated_at_ms = excluded.updated_at_ms,
       souls = excluded.souls,
       buildings = excluded.buildings,
       day = excluded.day,
       hour = excluded.hour,
       save = excluded.save`,
    [
      meta.id,
      meta.name,
      meta.seed,
      meta.createdAt,
      meta.updatedAt,
      meta.souls,
      meta.buildings,
      meta.day,
      meta.hour,
      JSON.stringify(next),
    ],
  );
  await writeKv(LAST_TOWN_KEY, meta.id);
  return meta;
}

export async function removeTown(id: string): Promise<void> {
  const sql = await getSql();
  await sql.query("delete from towns where id = $1", [id]);
  const last = await readLastTownId();
  if (last === id) {
    const rest = await listTownMetas();
    if (rest[0]) await writeKv(LAST_TOWN_KEY, rest[0].id);
    else await deleteKv(LAST_TOWN_KEY);
  }
}

export async function readLastTownId(): Promise<string | null> {
  const value = await readKv(LAST_TOWN_KEY);
  return typeof value === "string" && value ? value : null;
}

export async function writeLastTownId(id: string): Promise<void> {
  await writeKv(LAST_TOWN_KEY, id);
}

export async function readLlmSettings(): Promise<Partial<LlmSettings>> {
  const value = await readKv(SETTINGS_KEY);
  if (!value || typeof value !== "object") return {};
  return value as Partial<LlmSettings>;
}

export async function writeLlmSettings(settings: LlmSettings): Promise<LlmSettings> {
  await writeKv(SETTINGS_KEY, settings);
  return settings;
}

export async function importLegacyBatch(input: {
  towns?: unknown[];
  lastId?: string | null;
  settings?: Partial<LlmSettings> | null;
}): Promise<{ importedTowns: number; importedSettings: boolean }> {
  const existing = await listTownMetas();
  let importedTowns = 0;
  if (existing.length === 0 && Array.isArray(input.towns)) {
    for (const raw of input.towns) {
      const save = toSave(raw);
      if (!save) continue;
      await writeTown(save);
      importedTowns += 1;
    }
  }
  const currentSettings = await readKv(SETTINGS_KEY);
  let importedSettings = false;
  if (currentSettings == null && input.settings && typeof input.settings === "object") {
    await writeLlmSettings(input.settings as LlmSettings);
    importedSettings = true;
  }
  if (input.lastId && !(await readLastTownId())) {
    const ids = new Set((await listTownMetas()).map((t) => t.id));
    if (ids.has(input.lastId)) await writeLastTownId(input.lastId);
  }
  return { importedTowns, importedSettings };
}

export async function readKv(key: string): Promise<unknown> {
  const sql = await getSql();
  const rows = await sql.query<{ value: unknown }>("select value from app_kv where key = $1", [key]);
  if (!rows[0]) return null;
  const value = rows[0].value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value ?? null;
}

export async function writeKv(key: string, value: unknown): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into app_kv (key, value, updated_at_ms)
     values ($1, $2::jsonb, $3)
     on conflict (key) do update set value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
    [key, JSON.stringify(value), Date.now()],
  );
}

export async function deleteKv(key: string): Promise<void> {
  const sql = await getSql();
  await sql.query("delete from app_kv where key = $1", [key]);
}

// Key names of the short-lived PGLite Library backend. Custom Library content
// now lives as JSON files (`library-store.ts`); these keys exist only so the
// one-time migration can find and remove them.
export const LIBRARY_KV_KEYS = {
  kits: "library_kits",
  catalog: "library_catalog",
} as const;
