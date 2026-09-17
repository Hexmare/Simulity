import assert from "node:assert/strict";
import { test } from "node:test";
import { streetDoor } from "./interiors.ts";
import { cityWalkable } from "./nav.ts";
import { World } from "./world.ts";

test("walking the street does not trap the player in a doorway", () => {
  const w = new World(1742);
  assert.equal(w.player.loc.layer, "city");
  const start = { x: w.player.px, y: w.player.py, lx: w.player.loc.x, ly: w.player.loc.y };
  let moved = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    w.player.px = start.x;
    w.player.py = start.y;
    w.player.loc = { layer: "city", x: start.lx, y: start.ly };
    w.transitLock = 0;
    for (let i = 0; i < 18; i++) w.movePlayer(dx, dy, 1 / 60);
    assert.equal(w.player.loc.layer, "city", `walk ${dx},${dy} entered a building`);
    moved = Math.max(moved, Math.hypot(w.player.px - start.x, w.player.py - start.y));
  }
  assert.ok(moved > 0.6, `player barely moved (${moved.toFixed(2)})`);
});

const kindIdBySlug = (w: World, slug: string): string | undefined =>
  Object.values(w.defs.buildingKinds).find((k) => k.slug === slug)?.id;

test("entering a building does not bounce the player back to the street", () => {
  const w = new World(1742);
  const tavern = w.buildings.find((b) => b.kind === kindIdBySlug(w, "diner"));
  assert.ok(tavern);
  w.enterBuilding(tavern.id);
  assert.equal(w.player.loc.layer, "interior");
  const door = streetDoor(tavern);
  assert.ok(
    Math.floor(w.player.px) !== door.x || Math.floor(w.player.py) !== door.y,
    "spawned standing on the door",
  );
  for (let i = 0; i < 24; i++) w.movePlayer(0, 0, 1 / 60);
  assert.equal(w.player.loc.layer, "interior");
  const ax = w.player.px - (door.x + 0.5);
  const ay = w.player.py - (door.y + 0.5);
  w.animate(1);
  for (let i = 0; i < 18; i++) w.movePlayer(ax, ay, 1 / 60);
  assert.equal(w.player.loc.layer, "interior", "bounced while walking away from the door");
});

test("interact enters and leaves without getting stuck", () => {
  const w = new World(1742);
  const b = w.buildings.find((x) => x.kind === kindIdBySlug(w, "bakery")) ?? w.buildings[0]!;
  w.player.px = b.entrance.x + 0.5;
  w.player.py = b.entrance.y + 0.5;
  w.player.loc = { layer: "city", x: b.entrance.x, y: b.entrance.y };
  w.player.facing = Math.atan2(b.y + b.h / 2 - w.player.py, b.x + b.w / 2 - w.player.px);
  assert.equal(w.interact(), true);
  assert.equal(w.player.loc.layer, "interior");
  assert.equal(w.player.loc.buildingId, b.id);
  w.animate(1);
  assert.equal(w.interact(), true);
  assert.equal(w.player.loc.layer, "city");
  w.animate(1);
  const toEx = b.entrance.x + 0.5 - (b.x + b.w / 2);
  const toEy = b.entrance.y + 0.5 - (b.y + b.h / 2);
  const alongX = -toEy;
  const alongY = toEx;
  for (let i = 0; i < 24; i++) w.movePlayer(alongX, alongY, 1 / 60);
  assert.equal(w.player.loc.layer, "city");
});

test("walking into a building from its doorstep enters once and stays", () => {
  const w = new World(1742);
  const b = w.buildings.find((x) => x.kind === kindIdBySlug(w, "night-market")) ?? w.buildings[0]!;
  const n = { x: b.entrance.x + 0.5, y: b.entrance.y + 0.5 };
  w.player.px = n.x;
  w.player.py = n.y;
  w.player.loc = { layer: "city", x: b.entrance.x, y: b.entrance.y };
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = cx - n.x;
  const dy = cy - n.y;
  w.animate(1);
  for (let i = 0; i < 30; i++) w.movePlayer(dx, dy, 1 / 60);
  assert.equal(w.player.loc.layer, "interior");
  assert.equal(w.player.loc.buildingId, b.id);
  const px = w.player.px;
  const py = w.player.py;
  for (let i = 0; i < 10; i++) w.movePlayer(0, 0, 1 / 60);
  assert.equal(w.player.loc.layer, "interior");
  assert.ok(Math.hypot(w.player.px - px, w.player.py - py) < 0.01);
});

test("commandPlayerTo plans from the body, not the last snapped tile", () => {
  const w = new World(1742);
  const p = w.player;
  assert.equal(p.loc.layer, "city");
  const gx = Math.floor(p.px);
  const gy = Math.floor(p.py);
  p.loc = { layer: "city", x: gx - 4, y: gy };
  p.px = gx + 0.7;
  p.py = gy + 0.5;
  let destX: number | null = null;
  for (let x = gx + 3; x < gx + 14; x++) {
    if (cityWalkable(w.map, x, gy)) destX = x;
  }
  assert.ok(destX != null, "need a walkable tile east of the body");
  assert.equal(w.commandPlayerTo({ layer: "city", x: destX, y: gy }), true);
  const first = p.bb.path![0]!;
  assert.ok(first.x >= gx, `rewound to ${first.x},${first.y} from body cell ${gx},${gy}`);
  assert.equal(p.loc.x, gx);
  assert.equal(p.loc.y, gy);
});

test("replanning mid-stride replaces the remaining path without going home", () => {
  const w = new World(1742);
  const p = w.player;
  const gx = Math.floor(p.px);
  const gy = Math.floor(p.py);
  let north: number | null = null;
  for (let y = gy - 1; y >= gy - 10; y--) {
    if (cityWalkable(w.map, gx, y)) north = y;
    else break;
  }
  let east: number | null = null;
  for (let x = gx + 1; x <= gx + 10; x++) {
    if (cityWalkable(w.map, x, gy)) east = x;
    else break;
  }
  if (north == null || east == null || gy - north < 2 || east - gx < 2) {
    assert.ok(true, "map has no open cardinal run — skip");
    return;
  }
  assert.equal(w.commandPlayerTo({ layer: "city", x: gx, y: north }), true);
  for (let i = 0; i < 18; i++) w.tickPlayerMove(1 / 60);
  const bodyX = p.px;
  const bodyY = p.py;
  assert.equal(w.commandPlayerTo({ layer: "city", x: east, y: gy }), true);
  const first = p.bb.path![0]!;
  const rewind = Math.hypot(first.x + 0.5 - bodyX, first.y + 0.5 - bodyY);
  const toEast = Math.hypot(east + 0.5 - bodyX, gy + 0.5 - bodyY);
  assert.ok(first.x >= Math.floor(bodyX) - 0.01, `first waypoint ${first.x},${first.y} is behind body ${bodyX.toFixed(2)},${bodyY.toFixed(2)}`);
  assert.ok(rewind <= toEast + 0.6, "new path starts farther than the new dest");
});

