import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTown,
  deleteTown,
  duplicateTown,
  exportTown,
  hydrateWorld,
  importTown,
  LEGACY_TOWN_PREFIX,
  listTowns,
  loadTown,
  putTown,
  renameTown,
  SAVE_VERSION,
  setPersistBackend,
  snapshotWorld,
} from "./persist.ts";
import { DEFAULT_KIT_ID, getKit } from "./kits.ts";
import { SHIPPED_JOB_IDS, SYS } from "./defs.ts";
import { World } from "./world.ts";

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

function memoryStoreWithMap() {
  const m = new Map<string, string>();
  const store = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
  return { map: m, store };
}

test("snapshot and hydrate restore souls, time, and the street", () => {
  const a = new World(1742);
  a.townName = "Testwick";
  a.tickIndex += 40;
  a.addVillager({ name: "Pia Reed" });
  const save = snapshotWorld(a);
  const b = hydrateWorld(save);
  assert.equal(b.townName, "Testwick");
  assert.equal(b.npcs.length, a.npcs.length);
  assert.equal(b.buildings.length, a.buildings.length);
  assert.equal(b.tickIndex, a.tickIndex);
  assert.equal(b.player.loc.layer, a.player.loc.layer);
  assert.ok(Math.abs(b.player.px - a.player.px) < 0.01);
  assert.ok(b.npcs.some((n) => n.name === "Pia Reed"));
  assert.equal(b.bonds.length, a.bonds.length);
  assert.ok(b.npcs.every((n) => n.orientation));
});

test("json roundtrip keeps tiles and blocked cells", () => {
  const a = new World(1742);
  const raw = JSON.parse(JSON.stringify(snapshotWorld(a)));
  const b = hydrateWorld(raw);
  assert.equal(b.map.blocked.length, a.map.blocked.length);
  assert.equal(b.map.tiles.length, a.map.tiles.length);
  assert.equal(b.npcs.length, a.npcs.length);
  assert.equal(b.buildings[0]?.floors[0]?.tiles.length, a.buildings[0]?.floors[0]?.tiles.length);
});

test("town store is full CRUD", () => {
  setPersistBackend(memoryStore());
  const w = createTown("Simulity", 9);
  assert.equal(listTowns().length, 1);
  assert.equal(listTowns()[0]!.name, "Simulity");
  assert.equal(typeof listTowns()[0]!.buildings, "number");
  assert.equal(typeof listTowns()[0]!.souls, "number");
  const loaded = loadTown(w.townId);
  assert.ok(loaded);
  assert.equal(loaded!.npcs.length, w.npcs.length);
  assert.equal(renameTown(w.townId, "New Simulity"), true);
  assert.equal(listTowns()[0]!.name, "New Simulity");
  const copy = duplicateTown(w.townId);
  assert.ok(copy);
  assert.equal(listTowns().length, 2);
  const json = exportTown(w.townId);
  assert.ok(json);
  const imported = importTown(JSON.parse(json!));
  assert.ok(imported);
  assert.equal(listTowns().length, 3);
  assert.notEqual(imported!.id, w.townId);
  deleteTown(copy.id);
  deleteTown(imported!.id);
  assert.equal(listTowns().length, 1);
  deleteTown(w.townId);
  assert.equal(listTowns().length, 0);
});

test("adding and removing people and houses mutates the live world", () => {
  const w = new World(1742);
  const n0 = w.npcs.length;
  const b0 = w.buildings.length;
  const jobIdBySlug = (slug: string) => Object.values(w.defs.jobs).find((j) => j.slug === slug)?.id ?? getKit(DEFAULT_KIT_ID).defaultPcJobId;
  const soul = w.addVillager({ name: "Ivor Moss", sex: "m", jobId: jobIdBySlug("night-watch") });
  assert.ok(soul);
  assert.equal(w.npcs.length, n0 + 1);
  assert.equal(w.patchVillager(soul!.id, { jobId: jobIdBySlug("parish-clerk"), age: 41 }), true);
  assert.equal(w.npc(soul!.id)?.bb.jobId, jobIdBySlug("parish-clerk"));
  const homeKind = Object.values(w.defs.buildingKinds).find((k) => k.tags.includes("home"))!;
  const house = w.addHouse(homeKind.id, "Reed House");
  assert.ok(house);
  assert.equal(w.buildings.length, b0 + 1);
  assert.equal(w.removeVillager(soul!.id), true);
  assert.equal(w.npcs.length, n0);
  assert.equal(w.removeBuilding(house!.id), true);
  assert.equal(w.buildings.length, b0);
});

test("putTown then loadTown keeps an added soul", () => {
  setPersistBackend(memoryStore());
  const w = createTown("Keep", 1742);
  w.addVillager({ name: "Una Vale" });
  putTown(w);
  const again = loadTown(w.townId);
  assert.ok(again?.npcs.some((n) => n.name === "Una Vale"));
});

test("saves are ward-era (v7) and pin the generation kit", () => {
  const w = new World(1742);
  const kitId = getKit(DEFAULT_KIT_ID).id; // saves carry the pinned kit UUID, not the slug
  const save = snapshotWorld(w);
  assert.equal(SAVE_VERSION, 7);
  assert.equal(save.version, SAVE_VERSION);
  assert.equal(save.kitId, kitId);
  const b = hydrateWorld(save);
  assert.equal(b.kitId, kitId);
  assert.ok(b.settingBible.length > 0, "setting bible carried with the save");
});

test("pre-ward saves hard-reject with no migration mapper", () => {
  const { map: m, store } = memoryStoreWithMap();
  setPersistBackend(store);
  try {
    const w = createTown("Old Field", 1742);
    putTown(w);
    // Rebuild the stored save in pre-ward shape: v6, no kitId.
    const raw = JSON.parse(JSON.stringify(snapshotWorld(w))) as Record<string, unknown>;
    raw.version = 6;
    delete raw.kitId;
    m.set(LEGACY_TOWN_PREFIX + w.townId, JSON.stringify(raw));
    assert.equal(loadTown(w.townId), null); // isSave gate — pre-ward shapes get no mapper
    assert.equal(importTown(raw), null); // the same file isn't this ward either
    putTown(w); // a valid v7 save in the same store still loads
    const b = loadTown(w.townId);
    assert.ok(b);
    assert.equal(b!.townName, "Old Field");
  } finally {
    setPersistBackend(null);
  }
});

test("overlay rows and shipped deletions survive a roundtrip", () => {
  const w = new World(1742);
  const addedId = crypto.randomUUID();
  assert.equal(w.addJob({ id: addedId, slug: "custom-trade", label: "Custom Trade", workplace: SYS.home, startHour: 8, endHour: 17, palette: 3 }), null);
  const removedId = SHIPPED_JOB_IDS.find((id) => id !== getKit(DEFAULT_KIT_ID).defaultPcJobId)!;
  assert.equal(w.removeJob(removedId), null);
  const b = hydrateWorld(snapshotWorld(w));
  assert.ok(b.defs.jobs[addedId], "custom job row survives the roundtrip");
  assert.equal(b.defs.jobs[removedId], undefined, "shipped deletion survives the roundtrip");
  assert.ok(b.defsOverlay.jobs.removedIds.includes(removedId));
  const n = b.addVillager({ name: "Orphan", jobId: removedId }); // deleted job isn't assignable
  assert.equal(n?.bb.jobId, getKit(DEFAULT_KIT_ID).defaultPcJobId);
});
