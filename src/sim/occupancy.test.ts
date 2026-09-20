import assert from "node:assert/strict";
import { test } from "node:test";
import { World } from "./world.ts";
import { applyDeltas, claimUse, ensureEatAffinity, queueTask, resolveEat, stepTasks } from "./ai.ts";
import { SYS } from "./defs.ts";

function chairHall(w: World) {
  const b = w.buildings.find((x) => x.floors.some((f) => (f.furniture ?? []).some((i) => i.kind === "chair" || i.kind === "pew")))!;
  assert.ok(b, "fresh ward has a seat-bearing building");
  return b;
}

test("claimUse hands out unique seats with sit pose, never double-booking", () => {
  const w = new World(1742);
  const b = chairHall(w);
  const [a, c] = w.npcs;
  const ia = claimUse(w, a!, b, "seat");
  const ic = claimUse(w, c!, b, "seat");
  assert.ok(ia && ic, "both souls claim a seat");
  assert.notEqual(ia!.id, ic!.id, "no two souls on one item");
  assert.equal(a!.bb.usingId, ia!.id);
  assert.equal(a!.bb.pose, "sit");
  // Exhaust every seat: the next soul gets nothing (overflow waits at the door).
  const seats = b.floors.flatMap((f) => f.furniture ?? []).filter((i) => i.kind === "chair" || i.kind === "pew");
  for (const n of w.npcs.slice(2)) {
    claimUse(w, n, b, "seat");
    if (!n.bb.usingId) break;
  }
  const claimed = new Set(w.people().map((n) => n.bb.usingId).filter(Boolean));
  assert.ok(claimed.size <= seats.length, "claims never exceed seats");
  const ids = [...claimed];
  assert.equal(new Set(ids).size, ids.length, "every claim is unique");
});

test("claimUse sleep claims a bed with sleep pose", () => {
  const w = new World(1742);
  const home = w.building(w.npcs[0]!.bb.homeId)!;
  const item = claimUse(w, w.npcs[0]!, home, "sleep");
  assert.ok(item, "a bed is claimed");
  assert.equal(item!.kind, "bed");
  assert.equal(w.npcs[0]!.bb.pose, "sleep");
});

test("sys:eat never stacks two souls on one tile (overflow at the door)", () => {
  const w = new World(1742);
  const seen = new Set<string>();
  for (const n of w.npcs.slice(0, 12)) {
    const dest = resolveEat(w, n);
    assert.ok(dest, `${n.name} finds somewhere to eat`);
    if (dest!.layer === "interior") {
      const key = `${dest!.buildingId}:${dest!.floor}:${dest!.x},${dest!.y}`;
      assert.ok(!seen.has(key), `no two souls on one tile (${key})`);
      seen.add(key);
    } else {
      // Overflow waits at the street door, never inside.
      const b = w.buildings.find((x) => x.entrance.x === dest!.x && x.entrance.y === dest!.y);
      assert.ok(b, "city overflow is a street door");
    }
  }
});

test("eatAffinity generates home + kind weights keyed by kind UUID", () => {
  const w = new World(1742);
  const aff = ensureEatAffinity(w, w.npcs[0]!);
  assert.ok(aff.home >= 0 && aff.home <= 1, "home weight is 0–1");
  for (const k of Object.keys(aff.kinds)) {
    assert.ok(w.defs.buildingKinds[k], "affinity kind key is a catalog UUID");
    assert.ok(!k.includes("-") || /^[0-9a-f-]{36}$/.test(k), "no slug keys");
  }
});

test("guests eat in the home they already stand in", () => {
  const w = new World(1742);
  const host = w.npcs[0]!;
  const home = w.building(host.bb.homeId)!;
  const hasKitchen = home.floors.some((f) => f.rooms.some((r) => r.kind === "kitchen"));
  if (!hasKitchen) return; // old baked interior without a kitchen — nothing to prove
  const guest = w.npcs[1]!;
  guest.loc = { layer: "interior", buildingId: home.id, floor: 0, x: 1, y: 1 };
  guest.px = 1.5;
  guest.py = 1.5;
  const dest = resolveEat(w, guest);
  assert.ok(dest, "guest finds the kitchen");
  assert.equal(dest!.buildingId, home.id, "guest eats where they already are");
});

test("eat tree goes through sys:eat, not a hardcoded diner UUID", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, "../../content/trees/eat.json"), "utf8");
  assert.ok(raw.includes(SYS.eat), "eat tree moves to sys:eat");
  assert.ok(!raw.includes("491d88f6-8919-4084-b0c5-a0ab0b902935"), "no hardcoded diner UUID");
});

test('"pc"/"you" relationship keys remap to the live player id', () => {
  const w = new World(1742);
  const n = w.npcs[0]!;
  const before = n.relationships[w.player.id]?.friendship ?? 0;
  applyDeltas(w, n, { relationships: { pc: { friendship: 5 }, you: { familiarity: 2 }, PC: { trust: 3 } } });
  assert.ok((n.relationships[w.player.id]?.friendship ?? 0) > before, "friendship lands on the player id");
  // The live player id is "pc", so "pc" is a legal key — but "you"/"PC" must remap, never persist.
  assert.ok(!("you" in n.relationships) && !("PC" in n.relationships), "no raw you/PC keys remain");
});

test("assign_task go-tell lands in the target memory only, after the scene", () => {
  const w = new World(1742);
  const [teller, target, third] = w.npcs;
  // Colocate teller and target on the street; third far away.
  teller!.loc = { layer: "city", x: 20, y: 20 };
  teller!.px = 20.5;
  teller!.py = 20.5;
  target!.loc = { layer: "city", x: 20, y: 20 };
  target!.px = 20.5;
  target!.py = 20.5;
  third!.loc = { layer: "city", x: 2, y: 2 };
  third!.px = 2.5;
  third!.py = 2.5;
  const mem0 = (target!.bb.memory ?? []).length;
  const q = queueTask(w, teller!.id, [
    { op: "move", to: { npcId: target!.id } },
    { op: "tell", targetId: target!.id, content: "the stew is honest today" },
  ]);
  assert.ok(q, "task queues");
  // Queued during a scene: nothing runs while control is llm.
  teller!.bb.control = "llm";
  stepTasks(w, teller!);
  assert.equal((target!.bb.memory ?? []).length, mem0, "no delivery mid-scene");
  // After End the soul walks the task: move arrives, tell lands.
  teller!.bb.control = "autonomous";
  for (let i = 0; i < 5 && (teller!.bb.tasks?.length ?? 0) > 0; i++) stepTasks(w, teller!);
  assert.equal(teller!.bb.tasks?.length ?? 0, 0, "queue drains");
  const mem = target!.bb.memory ?? [];
  assert.ok(mem.some((m) => m.content.includes("honest") && m.speakerId === teller!.id), "target memory gains the message");
  assert.ok(!(third!.bb.memory ?? []).some((m) => m.content.includes("honest")), "a third soul hears nothing");
});
