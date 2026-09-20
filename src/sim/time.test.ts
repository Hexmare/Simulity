import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ANCESTRY, JOBS, NEED } from "./defs.ts";
import { bedOfWithBonds, selectGoal } from "./ai.ts";
import { planRoute } from "./nav.ts";
import { MINUTES_PER_TICK, TICKS_PER_DAY, TICKS_PER_HOUR } from "./types.ts";
import type { Npc } from "./types.ts";
import { World } from "./world.ts";

function goalSlug(w: World, id: string | null): string | undefined {
  return w.defs.goals.find((g) => g.id === id)?.slug;
}

function shiftActive(startHour: number, endHour: number, hourFloat: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hourFloat >= startHour && hourFloat < endHour;
  return hourFloat >= startHour || hourFloat < endHour;
}

function humanVillager(w: World, jobId?: string): Npc {
  const n = w.addVillager(jobId ? { ancestryId: ANCESTRY.human, jobId } : { ancestryId: ANCESTRY.human });
  assert.ok(n, "town has a home to place a villager in");
  return n;
}

test("time constants are minute-scaled", () => {
  assert.equal(MINUTES_PER_TICK, 1);
  assert.equal(TICKS_PER_HOUR, 60);
  assert.equal(TICKS_PER_DAY, 24 * TICKS_PER_HOUR);
  const w = new World(1742);
  w.tickIndex = 8 * TICKS_PER_HOUR + 7;
  w.simSeconds = (8 * TICKS_PER_HOUR + 7) * 60;
  const t = w.time();
  assert.equal(t.day, 1);
  assert.equal(t.hour, 8);
  assert.equal(t.minute, 7);
});

test("one hour of decay drops hunger by ~4.2", () => {
  const w = new World(1742);
  const n = humanVillager(w);
  n.bb.control = "player";
  n.bb.traits = [];
  n.bb.food = 0;
  const hid = NEED.hunger;
  n.bb.needs[hid] = 70;
  const h0 = n.bb.needs[hid];
  for (let i = 0; i < TICKS_PER_HOUR; i++) w.step();
  const drop = h0 - (n.bb.needs[hid] ?? h0);
  assert.ok(Math.abs(drop - 4.2) <= 0.15, `hunger dropped ${drop.toFixed(3)} over an hour`);
});

test("a meal takes ~25 sim minutes", () => {
  const w = new World(1742);
  const n = humanVillager(w);
  n.bb.control = "autonomous";
  n.bb.needs[NEED.hunger] = 35;
  n.bb.food = 1;
  const goal = w.defs.goals.find((g) => g.slug === "eat");
  assert.ok(goal, "catalog ships an Eat goal");
  n.bb.goalId = goal.id;
  n.bb.treeId = goal.treeId;
  n.bb.btCursor = {};
  n.bb.waitTicks = 0;
  n.bb.goalLock = TICKS_PER_DAY;
  w.tickIndex = 12 * TICKS_PER_HOUR;
  w.simSeconds = 12 * TICKS_PER_HOUR * 60;
  const h0 = n.bb.needs[NEED.hunger];
  let elapsed = 0;
  for (let i = 0; i < TICKS_PER_HOUR && n.bb.lastStatus !== "success"; i++) {
    w.step();
    elapsed++;
  }
  assert.ok(elapsed >= 20 && elapsed <= 40, `meal took ${elapsed} sim minutes`);
  const rise = (n.bb.needs[NEED.hunger] ?? h0) - h0;
  assert.ok(rise > 27 && rise < 38, `hunger rose by ${rise.toFixed(1)} after the meal`);
  const t1 = w.time();
  assert.ok(!(t1.hour >= 21 || t1.hour < 5), "the meal stayed in daylight");
});

test("night sleep from energy 30 reaches rested in ~6-10 sim hours", () => {
  const w = new World(1742);
  const n = humanVillager(w);
  n.bb.control = "autonomous";
  const home = w.building(n.bb.homeId!);
  assert.ok(home, "villager has a home");
  const bedLoc = bedOfWithBonds(home, n);
  n.loc = bedLoc;
  n.px = bedLoc.x + 0.5;
  n.py = bedLoc.y + 0.5;
  n.bb.needs[NEED.energy] = 30;
  const goal = w.defs.goals.find((g) => g.slug === "sleep");
  assert.ok(goal, "catalog ships a Sleep goal");
  n.bb.goalId = goal.id;
  n.bb.treeId = goal.treeId;
  n.bb.btCursor = {};
  n.bb.waitTicks = 0;
  n.bb.goalLock = TICKS_PER_DAY;
  w.tickIndex = 22 * TICKS_PER_HOUR;
  w.simSeconds = 22 * TICKS_PER_HOUR * 60;
  let elapsed = 0;
  for (let i = 0; i < 11 * TICKS_PER_HOUR && (n.bb.needs[NEED.energy] ?? 0) < 90; i++) {
    w.step();
    elapsed++;
  }
  assert.ok((n.bb.needs[NEED.energy] ?? 0) >= 90, "reached rested energy");
  const hrs = elapsed / TICKS_PER_HOUR;
  assert.ok(hrs >= 6 && hrs <= 10, `slept ${hrs.toFixed(2)} sim hours`);
});

test("a day shift reads as a human working day", () => {
  const w = new World(1742);
  const job = w.defs.jobs[JOBS.superintendent];
  assert.ok(job, "catalog ships the Superintendent job");
  const n = humanVillager(w, job.id);
  n.bb.control = "autonomous";
  n.bb.needs[NEED.energy] = 90;
  n.bb.needs[NEED.hunger] = 30;
  n.bb.food = 1;
  w.tickIndex = 6 * TICKS_PER_HOUR + 30;
  w.simSeconds = (6 * TICKS_PER_HOUR + 30) * 60;
  let mealBeforeNine = false;
  let secondMeal = false;
  let workInShiftMin = 0;
  let workedNinetoEleven = false;
  let sleptAfter21 = false;
  for (let i = 0; i < 18 * TICKS_PER_HOUR; i++) {
    w.step();
    const hf = w.time().hourFloat;
    const slug = goalSlug(w, n.bb.goalId);
    if (slug === "eat" && hf >= 6.5 && hf < 9) mealBeforeNine = true;
    if (slug === "eat" && hf >= 11 && hf < 21) secondMeal = true;
    if (slug === "work") {
      if (shiftActive(job.startHour, job.endHour, hf)) workInShiftMin++;
      if (hf >= 9 && hf < 11) workedNinetoEleven = true;
    }
    if (slug === "sleep" && (hf >= 21 || hf < 5)) sleptAfter21 = true;
  }
  assert.ok(mealBeforeNine, "ate a morning meal before 09:00");
  assert.ok(workedNinetoEleven, "worked during the 09-11 window");
  assert.ok(workInShiftMin >= 4 * TICKS_PER_HOUR, `work occupied ${workInShiftMin} sim minutes of the shift (need >=240)`);
  assert.ok(secondMeal, "ate again mid or late day");
  assert.ok(sleptAfter21, "went to sleep after 21:00");
});

test("a night shift starts on work and resists sleeping while rested", () => {
  const w = new World(1742);
  const job = w.defs.jobs[JOBS["night-baker"]];
  assert.ok(job, "catalog ships the Night baker job");
  const n = humanVillager(w, job.id);
  n.bb.control = "autonomous";
  n.bb.needs[NEED.energy] = 50;
  w.tickIndex = 21 * TICKS_PER_HOUR + 15;
  w.simSeconds = (21 * TICKS_PER_HOUR + 15) * 60;
  n.bb.goalId = null;
  n.bb.treeId = null;
  n.bb.btCursor = {};
  n.bb.waitTicks = 0;
  n.bb.goalLock = 0;
  selectGoal(w, n);
  assert.equal(goalSlug(w, n.bb.goalId), "work", "night shift starts on Work");
  let sawWork = false;
  let sleptWhileRested = false;
  for (let i = 0; i < 2 * TICKS_PER_HOUR; i++) {
    w.step();
    const slug = goalSlug(w, n.bb.goalId);
    if (slug === "work") sawWork = true;
    if (slug === "sleep" && (n.bb.needs[NEED.energy] ?? 0) >= 18) sleptWhileRested = true;
  }
  assert.ok(sawWork, "kept working during the night shift");
  assert.ok(!sleptWhileRested, "did not sleep while energy stayed above 18");
});

test("~20-tile city route finishes in under 25 sim minutes via step()", () => {
  const w = new World(1742);
  const n = humanVillager(w);
  n.bb.control = "autonomous";
  n.bb.goalLock = TICKS_PER_DAY;
  n.bb.treeId = null;
  n.bb.btCursor = {};
  n.bb.waitTicks = 0;
  const { w: W, h: H } = w.map;
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);
  const from = { layer: "city" as const, x: cx - 10, y: cy };
  const to = { layer: "city" as const, x: cx + 10, y: cy };
  const route = planRoute(w.map, w.buildings, from, to) ?? [from, to];
  n.loc = from;
  n.px = from.x + 0.5;
  n.py = from.y + 0.5;
  n.bb.path = route;
  n.bb.pathI = 0;
  n.bb.destKey = null;
  let ticks = 0;
  while (n.bb.path && ticks < 48) {
    w.step();
    ticks++;
  }
  assert.ok(ticks < 25, `~20-tile route took ${ticks} sim minutes`);
});

test("no raw day-length literals remain in the sim code", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const kinSrc = readFileSync(path.join(here, "kin.ts"), "utf8");
  assert.ok(kinSrc.includes("TICKS_PER_DAY"), "kin.ts references TICKS_PER_DAY");
  assert.ok(!/24\s*\*\s*12/.test(kinSrc), "no raw '24 * 12' day-length literal in kin.ts");
});
