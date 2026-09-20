import assert from "node:assert/strict";
import { test } from "node:test";
import { ANCESTRY } from "./defs.ts";
import { getKit, kitPopulation, kitTotalPopulation } from "./kits.ts";
import { DEFAULT_KIT_ID } from "./kits.ts";
import { describeUnwornInRoom, describeWorn } from "./clothing.ts";
import { validateKit } from "./custom.ts";
import { hydrateWorld, snapshotWorld } from "./persist.ts";
import { World } from "./world.ts";

// Scene spec §12 — scene clock, concealment, clothing, PC home, kits.

test("scene-live ticks are sim seconds; End returns to sim minutes", () => {
  const w = new World(1742);
  const t0 = w.time();
  w.setSceneClock(true);
  for (let i = 0; i < 60; i++) w.step();
  const t1 = w.time();
  assert.equal(t1.day, t0.day, "60 scene ticks do not turn the day");
  assert.equal(t1.hour, t0.hour, "60 scene ticks do not turn the hour");
  assert.equal(t1.minute, (t0.minute + 1) % 60, "60 scene ticks advance ~1 sim minute");
  w.setSceneClock(false);
  for (let i = 0; i < 60; i++) w.step();
  const t2 = w.time();
  assert.equal((t2.hour - t1.hour + 24) % 24, 1, "60 autonomous ticks advance 1 sim hour again");
});

test("needs decay per sim-second while a scene is live", () => {
  const w = new World(1742);
  const n = w.npcs[0]!;
  n.bb.control = "player";
  n.bb.traits = [];
  const hunger = w.defs.needs.find((d) => d.slug === "hunger")!.id;
  n.bb.needs[hunger] = 70;
  w.setSceneClock(true);
  for (let i = 0; i < 3600; i++) w.step();
  const drop = 70 - (n.bb.needs[hunger] ?? 70);
  assert.ok(Math.abs(drop - 4.2) <= 0.3, `one sim hour of scene ticks drops hunger ~4.2 (got ${drop.toFixed(2)})`);
});

test("exactly one Player's rooms; no NPC homeId on it", () => {
  const w = new World(1742);
  const kit = getKit(DEFAULT_KIT_ID);
  assert.ok(kit.pcHomeKindId, "the kit names a PC home kind");
  const pcHomes = w.buildings.filter((b) => b.kind === kit.pcHomeKindId);
  assert.equal(pcHomes.length, 1, "exactly one Player's rooms");
  assert.equal(w.player.bb.homeId, pcHomes[0]!.id, "the PC lives there");
  for (const n of w.npcs) {
    assert.notEqual(n.bb.homeId, pcHomes[0]!.id, `${n.name} does not live in the Player's rooms`);
  }
});

test("People slider is total souls; shops stay; PC home stays one", () => {
  const kit = getKit(DEFAULT_KIT_ID);
  const def = new World(1742);
  const small = new World(1742, undefined, { population: 24 });
  // Total headcount is exact.
  assert.equal(small.npcs.length, 24, `People=24 gives 24 souls (got ${small.npcs.length})`);
  for (const n of small.npcs) assert.ok(n.age >= 18, `${n.name} is ${n.age}`);
  // Tiny city: asking for 6 gives exactly 6 (shops may stand unstaffed).
  const tiny = new World(1742, undefined, { population: 6 });
  assert.equal(tiny.npcs.length, 6, `People=6 gives 6 souls (got ${tiny.npcs.length})`);
  // Home buildings scale down; typed businesses do not.
  const homeKinds = new Set(kit.homes);
  const homeCount = (w: World) => w.buildings.filter((b) => homeKinds.has(b.kind)).length;
  assert.ok(homeCount(small) < homeCount(def), "home buildings scale down with People");
  for (const entry of kit.buildings) {
    if (homeKinds.has(entry.kindId)) continue;
    const inDef = def.buildings.filter((b) => b.kind === entry.kindId).length;
    const inSmall = small.buildings.filter((b) => b.kind === entry.kindId).length;
    assert.equal(inSmall, inDef, `shop/civic kind count stays (${entry.kindId})`);
  }
  assert.equal(small.buildings.filter((b) => b.kind === kit.pcHomeKindId).length, 1, "still exactly one Player's rooms");
  assert.equal(kitPopulation(kit), kit.roster.reduce((n, r) => n + r.count, 0), "roster sum is the roster half");
  assert.equal(kitTotalPopulation(kit, def.defs), def.npcs.length, "default People = total souls");
});

test("non-mundane souls start concealed; humans do not", () => {
  const w = new World(1742);
  const humanId = ANCESTRY.human;
  let sawConcealed = false;
  for (const n of w.npcs) {
    const mundane = w.defs.ancestries[n.ancestryId]?.mundane ?? false;
    if (mundane || n.ancestryId === humanId) assert.equal(n.concealed, false, `${n.name} is mundane and open`);
    else {
      assert.equal(n.concealed, true, `${n.name} is non-mundane and concealed`);
      sawConcealed = true;
    }
  }
  assert.ok(sawConcealed, "the city holds concealed souls");
});

test("every soul wears clothes and the prompt gets one Wearing line", () => {
  const w = new World(1742);
  for (const n of [...w.npcs.slice(0, 8), w.player]) {
    const line = describeWorn(w.defs, w.clothing, n);
    assert.match(line, /^Wearing: /, `${n.name} has a wearing line`);
    assert.ok(!/underwear|camisole|stockings/i.test(line) || /trousers|shirt|coat|jacket/i.test(line), "intimates stay hidden in normal dress");
  }
  // Wardrobe extras live at home.
  const stored = w.clothing.filter((c) => c.stored);
  assert.ok(stored.length >= 8, "wardrobes hold spares");
});

test("remove overcoat to hook: dress loses it, the room lists it", () => {
  const w = new World(1742);
  const n = w.npcs.find((x) => x.worn.overcoat) ?? w.npcs[0]!;
  if (!n.worn.overcoat) {
    // Force an overcoat on for the drill.
    const defId = Object.values(w.defs.garments).find((g) => g.slot === "overcoat")!.id;
    const item = { id: "test-coat", defId, ownerId: n.id, label: "grey overcoat", wornBy: n.id };
    w.clothing.push(item);
    n.worn.overcoat = item.id;
  }
  const before = describeWorn(w.defs, w.clothing, n);
  assert.match(before, /overcoat/i, "presented dress starts with the overcoat");
  assert.equal(w.removeItem(n.id, "overcoat", "hook"), null);
  assert.equal(n.worn.overcoat, null, "the slot is empty");
  const after = describeWorn(w.defs, w.clothing, n);
  assert.doesNotMatch(after, /overcoat/i, "presented dress loses the overcoat");
  const room = w.roomNameOf(n);
  const unworn = describeUnwornInRoom(w.defs, w.clothing, n, room, (id) => w.npc(id)?.name ?? (id === "pc" ? w.player.name : null));
  assert.ok(unworn && /overcoat/i.test(unworn), `the room lists it (${unworn})`);
  assert.equal(w.wearItem(n.id, w.clothing.find((c) => c.loc && c.ownerId === n.id)!.id), null, "MCP can wear it back");
  assert.match(describeWorn(w.defs, w.clothing, n), /overcoat/i, "dress is restored");
});

test("kit validation rejects minors and accepts the shipped kit", () => {  const w = new World(1742);
  const kit = getKit(DEFAULT_KIT_ID);
  const good = validateKit(kit, w.defs);
  assert.deepEqual(good.errors, [], "the shipped kit validates");
  const bad = validateKit({ ...kit, id: crypto.randomUUID(), roster: [{ jobId: kit.defaultPcJobId, count: 2, ages: [12, 30] }] }, w.defs);
  assert.ok(bad.errors.some((e) => /18\+/.test(e)), "roster ages < 18 are rejected");
  const badPc = validateKit({ ...kit, id: crypto.randomUUID(), pcAge: 15 }, w.defs);
  assert.ok(badPc.errors.some((e) => /18\+/.test(e)), "PC age < 18 is rejected");
});

test("crop-uploaded portrait survives a save roundtrip", () => {
  const w = new World(1742);
  const dataUrl = "data:image/jpeg;base64,/9j/CUSTOMPORTRAIT";
  assert.equal(w.patchVillager("pc", { portrait: dataUrl }), true);
  const again = hydrateWorld(snapshotWorld(w));
  assert.equal(again.player.portrait, dataUrl, "the custom portrait is still there after reload");
  assert.equal(w.patchVillager("pc", { portrait: null }), true);
  assert.equal(w.player.portrait, undefined, "clearing returns to no override");
});
