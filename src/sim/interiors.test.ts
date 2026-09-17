import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFloors, doorSideFromStreet, streetDoor, walkableTile } from "./interiors.ts";
import { insideOf } from "./nav.ts";
import { mulberry32 } from "./rng.ts";
import type { BuildingKind } from "./types.ts";
import { World } from "./world.ts";

test("door side follows the street, not the building origin", () => {
  assert.equal(doorSideFromStreet(10, 10, 6, 4, 13, 14), "s");
  assert.equal(doorSideFromStreet(10, 10, 6, 4, 13, 9), "n");
  assert.equal(doorSideFromStreet(10, 10, 6, 4, 16, 12), "e");
  assert.equal(doorSideFromStreet(10, 10, 6, 4, 9, 12), "w");
});

test("generated buildings put the interior door on the street wall", () => {
  const w = new World(1742);
  assert.ok(w.buildings.length > 8);
  const sides = new Set(w.buildings.map((b) => b.doorSide));
  assert.ok(sides.size >= 2, `doors only faced ${[...sides].join(",")}`);
  for (const b of w.buildings) {
    const expected = doorSideFromStreet(b.x, b.y, b.w, b.h, b.entrance.x, b.entrance.y);
    assert.equal(b.doorSide, expected, b.name);
    const door = streetDoor(b);
    const fl = b.floors[0]!;
    if (b.doorSide === "n") assert.equal(door.y, 0, b.name);
    if (b.doorSide === "s") assert.equal(door.y, fl.h - 1, b.name);
    if (b.doorSide === "w") assert.equal(door.x, 0, b.name);
    if (b.doorSide === "e") assert.equal(door.x, fl.w - 1, b.name);
    const inn = insideOf(b);
    assert.ok(walkableTile(fl.tiles[inn.y * fl.w + inn.x]), `${b.name} spawn blocked`);
  }
});

test("tavern and farmhouses have rooms, stairs, and an upstairs", () => {
  const w = new World(1742);
  const tavern = w.buildings.find((b) => b.kind === "tavern");
  assert.ok(tavern);
  assert.ok(tavern.floors.length >= 2);
  assert.ok(tavern.floors[0]!.rooms.length >= 2);
  assert.ok(tavern.floors[0]!.stairs.length >= 1);
  assert.ok(tavern.floors[1]!.rooms.length >= 1);
  const names = tavern.floors.flatMap((f) => f.rooms.map((r) => r.name));
  assert.ok(!names.includes("Room"), `collapsed room names: ${names.join(", ")}`);
  const farm = w.buildings.find((b) => b.kind === "farmhouse");
  assert.ok(farm);
  assert.ok(farm.floors.length >= 2);
});

test("using stairs changes floor without ejecting to the street", () => {
  const w = new World(1742);
  const b = w.buildings.find((x) => x.floors.length > 1 && x.floors[0]!.stairs.length);
  assert.ok(b);
  w.enterBuilding(b.id);
  const st = b.floors[0]!.stairs[0]!;
  w.useStairs(b, st);
  assert.equal(w.player.loc.layer, "interior");
  assert.equal(w.player.loc.floor, 1);
  w.animate(1);
  for (let i = 0; i < 12; i++) w.movePlayer(0, 0, 1 / 60);
  assert.equal(w.player.loc.layer, "interior");
  assert.equal(w.player.loc.floor, 1);
});

test("interiors are furnished rooms, not empty boxes", () => {
  const rng = mulberry32(9);
  const kinds: BuildingKind[] = ["cottage", "tavern", "bakery", "temple", "workshop", "farmhouse", "guardhouse"];
  for (const kind of kinds) {
    const floors = buildFloors(kind, "s", rng);
    const g = floors[0]!;
    assert.ok(g.rooms.length >= 1, kind);
    const tileKinds = new Set(g.tiles);
    assert.ok(tileKinds.size >= 4, `${kind} too few tile kinds ${[...tileKinds]}`);
    assert.equal(g.tiles[g.door!.y * g.w + g.door!.x], "door");
    assert.equal(g.door!.y, g.h - 1);
  }
});
