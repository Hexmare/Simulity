import type { Bond, Building, ChronicleEvent, Defs, DefsOverlay, Donor, MapGrid, Npc } from "./types";
import { hashOrientation, normalizeSoul } from "./kin";
import { World } from "./world";

export const SAVE_VERSION = 6;
const INDEX_KEY = "fenwick.v1.index";
const LAST_KEY = "fenwick.v1.last";
const townKey = (id: string) => `fenwick.v1.town.${id}`;

export interface TownMeta {
  id: string;
  name: string;
  seed: number;
  createdAt: number;
  updatedAt: number;
  souls: number;
  buildings: number;
  day: number;
  hour: number;
}

export interface TownSave extends Omit<TownMeta, "buildings" | "souls"> {
  version: number;
  rngState: number;
  tickIndex: number;
  eventSeq: number;
  souls: number;
  map: { w: number; h: number; tiles: MapGrid["tiles"]; blocked: number[] };
  buildings: Building[];
  npcs: Npc[];
  player: Npc;
  bonds: Bond[];
  donors: Donor[];
  events: ChronicleEvent[];
  trees: Defs["trees"];
  defsOverlay: DefsOverlay;
  purse: number;
  settingBible: string;
}

export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = (): KeyStore => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
};

let backend: KeyStore | null = null;
const memFallback = memory();

export function setPersistBackend(store: KeyStore | null) {
  backend = store;
}

function liveStore(): KeyStore {
  if (backend) return backend;
  try {
    const ls = globalThis.localStorage;
    if (!ls) return memFallback;
    return ls;
  } catch {
    return memFallback;
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = liveStore().getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  const store = liveStore();
  const prev = store.getItem(key);
  try {
    store.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (prev != null) {
      try {
        store.setItem(key, prev);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

function isSave(raw: unknown): raw is TownSave {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as TownSave;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    !!s.map &&
    typeof s.map.w === "number" &&
    typeof s.map.h === "number" &&
    Array.isArray(s.map.tiles) &&
    Array.isArray(s.buildings) &&
    Array.isArray(s.npcs) &&
    !!s.player &&
    typeof s.player.id === "string"
  );
}

export function listTowns(): TownMeta[] {
  const list = readJson<TownMeta[]>(INDEX_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter((t) => t && typeof t.id === "string").slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function lastTownId(): string | null {
  return liveStore().getItem(LAST_KEY);
}

export function getTown(id: string): TownSave | null {
  const save = readJson<unknown>(townKey(id), null);
  if (!isSave(save) || (save.version ?? 1) > SAVE_VERSION) return null;
  return migrate(save);
}

function migrate(save: TownSave): TownSave {
  const s = { ...save };
  if (!s.version) s.version = 1;
  if (!Array.isArray(s.events)) s.events = [];
  if (typeof s.tickIndex !== "number") s.tickIndex = 0;
  if (typeof s.eventSeq !== "number") s.eventSeq = s.events.length;
  if (typeof s.rngState !== "number") s.rngState = s.seed >>> 0;
  if (!s.trees) s.trees = {};
  if (!Array.isArray(s.bonds)) s.bonds = [];
  if (!s.defsOverlay || typeof s.defsOverlay !== "object") s.defsOverlay = { jobs: {}, buildings: {}, ancestries: {}, spells: {} };
  if (!s.defsOverlay.jobs || typeof s.defsOverlay.jobs !== "object") s.defsOverlay.jobs = {};
  if (!s.defsOverlay.buildings || typeof s.defsOverlay.buildings !== "object") s.defsOverlay.buildings = {};
  if (!s.defsOverlay.ancestries || typeof s.defsOverlay.ancestries !== "object") s.defsOverlay.ancestries = {};
  if (!s.defsOverlay.spells || typeof s.defsOverlay.spells !== "object") s.defsOverlay.spells = {};
  if (typeof s.purse !== "number" || !Number.isFinite(s.purse)) s.purse = 50;
  if (!Array.isArray(s.donors)) s.donors = [];
  if (typeof s.settingBible !== "string") s.settingBible = "";
  if (!Array.isArray(s.map.blocked)) {
    const blocked = s.map.blocked as unknown;
    s.map.blocked = Array.isArray(blocked) ? blocked : Object.values((blocked ?? {}) as Record<string, number>).map(Number);
  }
  // Wave 3: furniture objects + room owners. Adopt bed tiles into furniture[].
  for (const b of s.buildings ?? []) {
    for (const f of b.floors ?? []) {
      const fl = f as unknown as { furniture?: { id: string; kind: string; x: number; y: number; floor: number; ownerId?: string }[] };
      if (!Array.isArray(fl.furniture)) {
        fl.furniture = [];
        let n = 0;
        for (let y = 0; y < f.h; y++) {
          for (let x = 0; x < f.w; x++) {
            if (f.tiles[y * f.w + x] === "bed") {
              fl.furniture.push({ id: `legacy-${b.id}-${f.index}-${n++}`, kind: "bed", x, y, floor: f.index });
            }
          }
        }
      }
      for (const item of fl.furniture) {
        if (item.floor == null) item.floor = f.index;
      }
      if (!Array.isArray(f.beds)) f.beds = [];
      if (!Array.isArray(f.spots)) {
        f.spots = [];
        for (let y = 0; y < f.h; y++) {
          for (let x = 0; x < f.w; x++) {
            const t = f.tiles[y * f.w + x];
            if (t === "floor" || t === "rug" || t === "door") f.spots.push({ x, y });
          }
        }
      }
    }
  }
  const souls = [...(s.npcs ?? []), s.player].filter(Boolean);
  let grewUp = 0;
  for (const n of souls) {
    if (normalizeSoul(n).grewUp) grewUp++;
    if (!n.orientation) n.orientation = hashOrientation(n.id);
    if (!Array.isArray(n.parentIds)) n.parentIds = [];
  }
  if ((save.version ?? 1) < 2 && grewUp) {
    s.events.push({
      id: (s.eventSeq ?? s.events.length) + 1,
      tick: s.tickIndex ?? 0,
      type: "data",
      actorId: "world",
      summary: "The borough quietly grew up — everyone is 18 or older.",
      source: "sim",
    });
    s.eventSeq = (s.eventSeq ?? s.events.length) + 1;
  }
  s.version = SAVE_VERSION;
  return s;
}

export function metaOf(save: TownSave): TownMeta {
  return {
    id: save.id,
    name: save.name,
    seed: save.seed,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    souls: save.npcs.length,
    buildings: save.buildings.length,
    day: save.day,
    hour: save.hour,
  };
}

export function snapshotWorld(world: World): TownSave {
  const t = world.time();
  const npcs = world.npcs.map((n) => ({
    ...n,
    bb: { ...n.bb, path: null, pathI: 0, destKey: null },
    relationships: { ...n.relationships },
  }));
  const player = {
    ...world.player,
    bb: { ...world.player.bb, path: null, pathI: 0, destKey: null },
    relationships: { ...world.player.relationships },
  };
  return {
    version: SAVE_VERSION,
    id: world.townId,
    name: world.townName,
    seed: world.seed,
    createdAt: world.createdAt,
    updatedAt: Date.now(),
    souls: world.npcs.length,
    day: t.day,
    hour: t.hour,
    rngState: world.rng.state(),
    tickIndex: world.tickIndex,
    eventSeq: world.eventSeq,
    map: {
      w: world.map.w,
      h: world.map.h,
      tiles: world.map.tiles.slice(),
      blocked: Array.from(world.map.blocked),
    },
    buildings: world.buildings.map((b) => ({
      ...b,
      floors: b.floors.map((f) => ({
        ...f,
        tiles: f.tiles.slice(),
        rooms: f.rooms.map((r) => ({ ...r })),
        stairs: f.stairs.map((s) => ({ ...s })),
        beds: f.beds.map((bed) => ({ ...bed })),
        spots: f.spots.map((s) => ({ ...s })),
        furniture: (f.furniture ?? []).map((item) => ({ ...item })),
      })),
    })),
    npcs,
    player,
    bonds: world.bonds.map((b) => ({ ...b })),
    donors: world.donors.map((d) => ({ ...d })),
    events: world.events.slice(),
    trees: structuredClone(world.defs.trees),
    defsOverlay: structuredClone(world.defsOverlay),
    purse: Math.max(0, Math.floor(world.townPurse)),
    settingBible: world.settingBible,
  };
}

export function hydrateWorld(save: TownSave): World {
  const s = migrate(save);
  return World.fromSave(s);
}

export function putTown(world: World): TownSave {
  const save = snapshotWorld(world);
  writeJson(townKey(save.id), save);
  const index = listTowns().filter((t) => t.id !== save.id);
  index.unshift(metaOf(save));
  writeJson(INDEX_KEY, index);
  liveStore().setItem(LAST_KEY, save.id);
  world.createdAt = save.createdAt;
  return save;
}

export function createTown(name: string, seed: number): World {
  const world = new World(seed);
  world.townName = name.trim() || "Fenwick";
  putTown(world);
  return world;
}

export function loadTown(id: string): World | null {
  const save = getTown(id);
  if (!save) return null;
  liveStore().setItem(LAST_KEY, id);
  return hydrateWorld(save);
}

export function renameTown(id: string, name: string) {
  const save = getTown(id);
  if (!save) return false;
  save.name = name.trim() || save.name;
  save.updatedAt = Date.now();
  writeJson(townKey(id), save);
  const index = listTowns().map((t) => (t.id === id ? metaOf(save) : t));
  writeJson(INDEX_KEY, index);
  return true;
}

export function deleteTown(id: string) {
  liveStore().removeItem(townKey(id));
  const rest = listTowns().filter((t) => t.id !== id);
  writeJson(INDEX_KEY, rest);
  if (lastTownId() === id) {
    if (rest[0]) liveStore().setItem(LAST_KEY, rest[0].id);
    else liveStore().removeItem(LAST_KEY);
  }
}

export function duplicateTown(id: string): TownSave | null {
  const save = getTown(id);
  if (!save) return null;
  const copy: TownSave = {
    ...structuredClone(save),
    id: crypto.randomUUID(),
    name: `${save.name} copy`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeJson(townKey(copy.id), copy);
  const index = listTowns();
  index.unshift(metaOf(copy));
  writeJson(INDEX_KEY, index);
  liveStore().setItem(LAST_KEY, copy.id);
  return copy;
}

export function importTown(raw: unknown): TownSave | null {
  if (!isSave(raw)) return null;
  const save = migrate(raw);
  save.id = crypto.randomUUID();
  save.updatedAt = Date.now();
  save.createdAt = save.createdAt || Date.now();
  save.version = SAVE_VERSION;
  if (!save.name) save.name = "Fenwick";
  writeJson(townKey(save.id), save);
  const index = listTowns();
  index.unshift(metaOf(save));
  writeJson(INDEX_KEY, index);
  return save;
}

export function exportTown(id: string): string | null {
  const save = getTown(id);
  if (!save) return null;
  return JSON.stringify(save, null, 2);
}
