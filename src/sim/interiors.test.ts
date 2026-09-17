import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFloors, doorSideFromStreet, streetDoor, walkableTile } from "./interiors.ts";
import { insideOf } from "./nav.ts";
import { mulberry32 } from "./rng.ts";
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

test("two-story kinds get stairs and named rooms", () => {
  const w = new World(1742);
  const twoStoryIds = new Set(Object.values(w.defs.buildingKinds).filter((k) => k.stories === 2).map((k) => k.id));
  assert.ok(twoStoryIds.size >= 3, "expected several two-story kinds");
  let checked = 0;
  for (const b of w.buildings) {
    if (!twoStoryIds.has(b.kind)) continue;
    checked++;
    assert.equal(b.floors.length, 2, `${b.name} should have 2 floors`);
    assert.ok(b.floors[1]!.stairs.length >= 1, `${b.name} has no stairs`);
    for (const f of b.floors) {
      assert.ok(f.rooms.length >= 1, `${b.name} floor ${f.index} has no rooms`);
      for (const r of f.rooms) assert.ok(r.name.trim(), `${b.name}: room without a name (${r.kind})`);
    }
  }
  assert.ok(checked >= 3, `only ${checked} two-story buildings generated`);
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

test("home-tagged kinds always get a bed on the ground floor", () => {
  const w = new World(1742);
  const homeIds = new Set(Object.values(w.defs.buildingKinds).filter((k) => k.tags.includes("home")).map((k) => k.id));
  const homes = w.buildings.filter((b) => homeIds.has(b.kind));
  assert.ok(homes.length >= 3, "expected several residences");
  for (const b of homes) {
    assert.ok(b.floors[0]!.beds.length >= 1, `${b.name} has no bed`);
  }
});

test("buildFloors compiles every shipped kind from def fields alone", () => {
  const w = new World(1742);
  const rng = mulberry32(9);
  let withRooms = 0;
  for (const def of Object.values(w.defs.buildingKinds)) {
    const floors = buildFloors(def, "s", rng);
    assert.equal(floors.length, def.stories === 2 ? 2 : 1, `${def.slug} floor count`);
    const g = floors[0]!;
    if (def.ground.length > 0) {
      // Kinds with a ground room list get split rooms; room-less layouts stay open.
      assert.ok(g.rooms.length >= 1, `${def.slug} has no rooms`);
      for (const r of g.rooms) assert.ok(r.name.trim(), `${def.slug}: unnamed room (${r.kind})`);
      withRooms++;
    }
    assert.equal(g.tiles[g.door!.y * g.w + g.door!.x], "door", def.slug);
    assert.equal(g.door!.y, g.h - 1, `${def.slug} door not on the south wall`);
  }
  assert.ok(withRooms >= 8, `expected most kinds to split into rooms, got ${withRooms}`);
});
