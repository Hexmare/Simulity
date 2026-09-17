import assert from "node:assert/strict";
import { test } from "node:test";
import { romanceAllowed, areBloodKin, hashOrientation, normalizeSoul, pickerJobs } from "./kin.ts";
import { JOBS } from "./defs.ts";
import { hydrateWorld, snapshotWorld } from "./persist.ts";
import type { Npc } from "./types.ts";
import { World } from "./world.ts";

function stubNpc(partial: Partial<Npc> & Pick<Npc, "id" | "sex" | "orientation">): Npc {
  return {
    name: partial.id,
    kind: "npc",
    age: 30,
    parentIds: [],
    palette: 0,
    coin: 10,
    ancestryId: "human",
    narrative: { public: "", private: "", voice: "" },
    loc: { layer: "city", x: 0, y: 0 },
    px: 0.5,
    py: 0.5,
    facing: 0,
    speed: 1.65,
    bb: {
      needs: {},
      mood: 0,
      traits: [],
      jobId: "laborer",
      homeId: "b1",
      workId: null,
      householdId: "h1",
      food: 0,
      essence: 50,
      spells: [],
      goalId: null,
      goalLock: 0,
      treeId: null,
      btCursor: {},
      runningNodeId: null,
      lastStatus: null,
      control: "autonomous",
      path: null,
      pathI: 0,
      destKey: null,
      socialCooldown: 0,
      lastSocialTarget: null,
      waitTicks: 0,
      knowledge: [],
    },
    relationships: {},
    ...partial,
  };
}

test("a new borough has no one under 18 and no child jobs", () => {
  const w = new World(1742);
  assert.ok(w.npcs.length > 20);
  assert.equal(w.npcs.filter((n) => n.age < 18).length, 0);
  assert.equal(w.npcs.filter((n) => n.bb.jobId === "child").length, 0);
  assert.ok(w.player.age >= 18);
  assert.ok(w.npcs.every((n) => n.orientation));
  assert.ok(w.player.orientation);
  assert.equal(pickerJobs(JOBS).some((j) => j.id === "child"), false);
});

test("founding seeds adult families and named bonds", () => {
  const w = new World(1742);
  const spouses = w.npcs.filter((n) => n.spouseId);
  assert.ok(spouses.length >= 4, `expected spouse pairs, got ${spouses.length}`);
  for (const n of spouses) {
    const other = w.npc(n.spouseId!);
    assert.ok(other);
    assert.equal(other!.spouseId, n.id);
    assert.equal(romanceAllowed(n, other!, w.npcs), true);
  }
  const withParents = w.npcs.filter((n) => n.parentIds.some((id) => w.npc(id)));
  assert.ok(withParents.length >= 1, "expected at least one in-town parent link");
  const bonds = w.bonds.filter((b) => b.status === "spouse" || b.status === "partner");
  assert.ok(bonds.length >= 2);
});

test("blood kin cannot romance, and orientation gates flirt", () => {
  const man = stubNpc({ id: "a", sex: "m", orientation: "homo" });
  const woman = stubNpc({ id: "b", sex: "f", orientation: "hetero" });
  assert.equal(romanceAllowed(man, woman), false);
  const ace = stubNpc({ id: "c", sex: "f", orientation: "ace" });
  const bi = stubNpc({ id: "d", sex: "m", orientation: "bi" });
  assert.equal(romanceAllowed(ace, bi), false);
  const dad = stubNpc({ id: "p", sex: "m", orientation: "hetero", age: 50 });
  const son = stubNpc({ id: "k", sex: "m", orientation: "homo", age: 22, parentIds: ["p"] });
  assert.equal(areBloodKin(dad, son), true);
  assert.equal(romanceAllowed(dad, son, [dad, son]), false);
});

test("editor clamps age and hides child as a job assignment", () => {
  const w = new World(1742);
  const n = w.addVillager({ name: "Pia Reed", jobId: "child", age: 9 });
  assert.ok(n);
  assert.equal(n!.age >= 18, true);
  assert.equal(n!.bb.jobId, "laborer");
  assert.equal(w.patchVillager(n!.id, { age: 12, jobId: "baker" }), true);
  assert.equal(w.npc(n!.id)?.age, 18);
  assert.equal(w.npc(n!.id)?.bb.jobId, "baker");
});

test("removing a soul severs kin and bonds", () => {
  const w = new World(1742);
  const spouse = w.npcs.find((n) => n.spouseId);
  assert.ok(spouse);
  const otherId = spouse!.spouseId!;
  const id = spouse!.id;
  assert.equal(w.removeVillager(id), true);
  assert.equal(w.npc(otherId)?.spouseId, undefined);
  assert.equal(w.bonds.some((b) => b.a === id || b.b === id), false);
  for (const n of w.npcs) assert.equal(n.parentIds.includes(id), false);
});

test("old saves bump children to 18 and keep opening", () => {
  const a = new World(1742);
  const raw = snapshotWorld(a);
  raw.version = 1;
  raw.npcs[0]!.age = 11;
  raw.npcs[0]!.bb.jobId = "child";
  delete (raw.npcs[0] as { orientation?: string }).orientation;
  raw.bonds = undefined as unknown as typeof raw.bonds;
  const b = hydrateWorld(raw);
  assert.ok(b.npcs[0]!.age >= 18);
  assert.notEqual(b.npcs[0]!.bb.jobId, "child");
  assert.ok(b.npcs[0]!.orientation);
  assert.ok(Array.isArray(b.bonds));
  assert.ok(b.events.some((e) => e.summary.includes("grew up")));
});

test("hashOrientation is stable", () => {
  assert.equal(hashOrientation("n12"), hashOrientation("n12"));
});

test("normalizeSoul is idempotent", () => {
  const n = stubNpc({ id: "x", sex: "f", orientation: "hetero", age: 9 });
  n.bb.jobId = "child";
  const first = normalizeSoul(n);
  assert.equal(first.grewUp, true);
  assert.equal(n.age, 18);
  assert.equal(n.bb.jobId, "laborer");
  assert.equal(normalizeSoul(n).grewUp, false);
});
