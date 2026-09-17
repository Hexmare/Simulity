import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTown,
  deleteTown,
  duplicateTown,
  exportTown,
  hydrateWorld,
  importTown,
  listTowns,
  loadTown,
  putTown,
  renameTown,
  setPersistBackend,
  snapshotWorld,
} from "./persist.ts";
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

test("snapshot and hydrate restore souls, time, and the street", () => {
  const a = new World(1742);
  a.townName = "Testwick";
  a.tickIndex += 40;
  a.addVillager({ name: "Pia Reed", jobId: "baker" });
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
  const soul = w.addVillager({ name: "Ivor Moss", sex: "m", jobId: "guard" });
  assert.ok(soul);
  assert.equal(w.npcs.length, n0 + 1);
  assert.equal(w.patchVillager(soul!.id, { jobId: "priest", age: 41 }), true);
  assert.equal(w.npc(soul!.id)?.bb.jobId, "priest");
  const house = w.addHouse("cottage", "Reed Cottage");
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
