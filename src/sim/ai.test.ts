import assert from "node:assert/strict";
import { test } from "node:test";
import type { Building } from "./types.ts";
import { applyDeltas, selectGoal, snapshotNpc } from "./ai.ts";
import { NEED } from "./defs.ts";
import { cityWalkable, interiorWalkable } from "./nav.ts";
import { World } from "./world.ts";

const IS_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function firstCityWalkable(w: World): { x: number; y: number } {
  for (let y = 0; y < w.map.h; y++) {
    for (let x = 0; x < w.map.w; x++) {
      if (cityWalkable(w.map, x, y)) return { x, y };
    }
  }
  assert.fail("no walkable city tile");
}

function firstInteriorWalkable(b: Building): { x: number; y: number } {
  const fl = b.floors[0]!;
  for (let y = 0; y < fl.h; y++) {
    for (let x = 0; x < fl.w; x++) {
      if (interiorWalkable(b, x, y, 0)) return { x, y };
    }
  }
  assert.fail("no walkable interior tile");
}

test("snapshotNpc exposes needs by slug and goal by label", () => {
  const w = new World(1742);
  const n = w.npcs[0]!;
  selectGoal(w, n);
  const s = snapshotNpc(w, n) as ReturnType<typeof snapshotNpc> & { needs: Record<string, number>; goal: string | null };
  assert.ok(Object.keys(s.needs).length > 0, "needs are present");
  for (const k of Object.keys(s.needs)) {
    assert.ok(!IS_UUID_V4.test(k), `need key should be a slug, not a UUID: ${k}`);
  }
  const slugs = new Set(w.defs.needs.map((d) => d.slug));
  for (const k of Object.keys(s.needs)) assert.ok(slugs.has(k), `unknown need key in snapshot: ${k}`);
  assert.ok(n.bb.goalId, "goal is assigned");
  const g = w.defs.goals.find((x) => x.id === n.bb.goalId)!;
  assert.equal(s.goal, g.label, "goal appears by label, not raw id");
});

test("an LLM need delta under its slug lands on the right row", () => {
  const w = new World(1742);
  const n = w.npcs[0]!;
  const before = n.bb.needs[NEED.hunger] ?? 50;
  applyDeltas(w, n, { needs: { hunger: 20 } });
  assert.ok(n.bb.needs[NEED.hunger] > before, "hunger rose under its slug key");
});

test("a city location delta teleports the body onto a walkable tile", () => {
  const w = new World(1742);
  const n = w.npcs[0]!;
  const t = firstCityWalkable(w);
  applyDeltas(w, n, { location: { layer: "city", x: t.x, y: t.y } });
  assert.equal(n.loc.layer, "city");
  assert.equal(n.loc.x, t.x);
  assert.equal(n.loc.y, t.y);
  assert.equal(n.px, t.x + 0.5, "body snapped to the tile center");
  assert.equal(n.py, t.y + 0.5, "body snapped to the tile center");
});

test("an interior location delta moves the NPC into a building", () => {
  const w = new World(1742);
  const n = w.npcs[0]!;
  const b = w.buildings[0]!;
  const t = firstInteriorWalkable(b);
  applyDeltas(w, n, { location: { layer: "interior", buildingId: b.id, floor: 0, x: t.x, y: t.y } });
  assert.equal(n.loc.layer, "interior");
  assert.equal(n.loc.buildingId, b.id);
  assert.equal(n.loc.floor, 0);
  assert.equal(n.loc.x, t.x);
  assert.equal(n.loc.y, t.y);
});

test("invalid location deltas leave the NPC in place", () => {
  const w = new World(1742);
  const n = w.npcs[0]!;
  const bx = n.loc.x;
  const by = n.loc.y;
  applyDeltas(w, n, { location: { layer: "interior", buildingId: "no-such-building", x: 1, y: 1 } });
  assert.equal(n.loc.x, bx, "unknown building does not move anyone");
  assert.equal(n.loc.y, by);
  applyDeltas(w, n, { location: { layer: "city", x: -50, y: 999 } });
  assert.ok(n.loc.layer === "city", "clamped to the city layer");
  assert.ok(n.loc.x >= 0 && n.loc.x < w.map.w, "x clamped inside the map");
  assert.ok(n.loc.y >= 0 && n.loc.y < w.map.h, "y clamped inside the map");
});
