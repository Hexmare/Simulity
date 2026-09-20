import assert from "node:assert/strict";
import { test } from "node:test";
import { Session } from "./session.ts";
import { handleMcp } from "./mcp.ts";
import { World } from "../../sim/world.ts";

function liveSession() {
  const session = new Session();
  session.world = new World(1742);
  return session;
}

test("list_souls and list_places read the live Session world", async () => {
  const session = liveSession();
  const souls = await handleMcp(session, "list_souls", {});
  assert.equal(souls.ok, true);
  const list = souls.result as { id: string }[];
  assert.ok(list.length > 10, "the ward roster is visible");
  const places = await handleMcp(session, "list_places", {});
  assert.equal(places.ok, true);
  assert.ok((places.result as unknown[]).length > 5, "buildings are visible");
});

test("move_soul paths the named soul only", async () => {
  const session = liveSession();
  const w = session.world!;
  const npc = w.npcs[0]!;
  const other = w.npcs[1]!;
  const target = w.buildings[0]!;
  const before = { x: other.bb.path, id: other.id };
  const r = await handleMcp(session, "move_soul", { npcId: npc.id, to: { buildingId: target.id } });
  assert.equal(r.ok, true);
  assert.ok(npc.bb.path && npc.bb.path.length > 0, "the named soul walks");
  assert.equal(other.bb.path, before.x, "nobody else moves");
  void before.id;
});

test("move_soul with only a room stays in the soul's current building", async () => {
  const session = liveSession();
  const w = session.world!;
  const npc = w.npcs[0]!;
  const home = w.building(npc.bb.homeId)!;
  npc.loc = { layer: "interior", buildingId: home.id, floor: 0, x: 1, y: 1 };
  npc.px = 1.5;
  npc.py = 1.5;
  const room = home.floors.flatMap((f) => f.rooms)[0]!;
  const r = await handleMcp(session, "move_soul", { npcId: npc.id, to: { room: room.name } });
  assert.equal(r.ok, true);
  const dest = npc.bb.path?.[npc.bb.path.length - 1];
  assert.equal(dest?.buildingId, home.id, "room-only moves never leave the building");
});

test("call_soul joins a distant soul without moving the body", async () => {
  const session = liveSession();
  const w = session.world!;
  w.player.loc = { layer: "city", x: 20, y: 20 };
  w.player.px = 20.5;
  w.player.py = 20.5;
  const far = w.npcs.find((n) => {
    n.loc = { layer: "city", x: 2, y: 2 };
    n.px = 2.5;
    n.py = 2.5;
    return !w.isHere(n.id);
  })!;
  const x = far.px;
  const r = await handleMcp(session, "call_soul", { npcId: far.id });
  assert.equal(r.ok, true);
  assert.ok(session.scene.ids.includes(far.id), "chip appears");
  assert.equal(session.scene.presence[far.id], "called");
  assert.equal(far.px, x, "the body stays");
});

test("assign_task queues steps that run only while autonomous", async () => {
  const session = liveSession();
  const w = session.world!;
  const [teller, target] = w.npcs;
  target!.loc = { ...teller!.loc, x: Math.floor(teller!.px), y: Math.floor(teller!.py) };
  target!.px = teller!.px;
  target!.py = teller!.py;
  const r = await handleMcp(session, "assign_task", {
    npcId: teller!.id,
    steps: [{ op: "tell", targetId: target!.id, content: "mcp says hi" }],
  });
  assert.equal(r.ok, true);
  assert.equal(teller!.bb.tasks?.length, 1);
  const bad = await handleMcp(session, "assign_task", { npcId: "nope", steps: [] });
  assert.equal(bad.ok, false);
  const unknown = await handleMcp(session, "nope", {});
  assert.equal(unknown.ok, false);
});
