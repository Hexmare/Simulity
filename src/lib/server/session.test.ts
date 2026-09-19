import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerEvent } from "../protocol.ts";
import { Session, type Sock } from "./session.ts";
import { World } from "../../sim/world.ts";

function fakeSock(events: ServerEvent[]): Sock {
  return { send: (ev) => events.push(ev) };
}

test("session tick advances the hosted World", () => {
  const session = new Session();
  session.world = new World(1742);
  const t0 = session.world.tickIndex;
  session.tick(1);
  assert.equal(session.world.tickIndex, t0 + 1);
});

test("intents mutate the hosted World and broadcast a delta", async () => {
  const session = new Session();
  session.world = new World(1742);
  const events: ServerEvent[] = [];
  const sock = fakeSock(events);
  session.clients.add(sock);
  await session.handle({ type: "setSpeed", speed: 3 }, sock);
  assert.equal(session.world.speed, 3);
  assert.ok(events.some((e) => e.type === "delta"));
});

test("sceneAdd pauses a Here soul; sceneCall marks presence without moving them", async () => {
  const session = new Session();
  const world = new World(1742);
  session.world = world;
  world.player.loc = { layer: "city", x: 20, y: 20 };
  world.player.px = 20.5;
  world.player.py = 20.5;
  const here = world.npcs[0]!;
  here.loc = { layer: "city", x: 20, y: 20 };
  here.px = 20.5;
  here.py = 20.5;
  const far = world.npcs[1]!;
  far.loc = { layer: "city", x: 2, y: 2 };
  far.px = 2.5;
  far.py = 2.5;
  assert.equal(world.isHere(here.id), true);
  assert.equal(world.isHere(far.id), false);
  const events: ServerEvent[] = [];
  const sock = fakeSock(events);
  session.clients.add(sock);
  const farX = far.px;
  await session.handle({ type: "sceneAdd", npcId: here.id }, sock);
  await session.handle({ type: "sceneCall", npcId: far.id }, sock);
  assert.equal(here.bb.control, "llm");
  assert.equal(far.bb.control, "llm");
  assert.equal(session.scene.presence[here.id], "here");
  assert.equal(session.scene.presence[far.id], "called");
  assert.equal(far.px, farX);
});
