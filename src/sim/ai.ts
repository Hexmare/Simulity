import { cityWalkable, dist2, interiorWalkable, locKey, planRoute, samePlace } from "./nav.ts";
import { doWork, tryBuyFood } from "./economy.ts";
import { allBeds, floorOf, groundFloor, roomAt, streetDoor } from "./interiors.ts";
import { ANCESTRY, NEED, SOCIAL, SYS, TRAIT } from "./defs.ts";
import {
  areBloodKin,
  breakRomantic,
  considerBondPromotion,
  getBond,
  isRomanticStatus,
  romanceAllowed,
  setBond,
  soulsOf,
  walkSpeed,
} from "./kin.ts";
import { pick, randInt } from "./rng.ts";
import type {
  Building,
  GoalDef,
  Loc,
  Npc,
  Rel,
  RelDelta,
  RoleplayDeltas,
  SimHost,
  SocialActionDef,
  WorldTime,
} from "./types.ts";
import { TICKS_PER_HOUR } from "./types.ts";

// Durations and cooldowns, all in sim-minutes (1 tick = 1 minute). See spec §8.2.
const DEFAULT_EAT_MINUTES = 25; // eat: hunger +32, comfort +4 at start of the sit
const DEFAULT_DRINK_MINUTES = 5;
const DEFAULT_WASH_MINUTES = 12; // wash: hygiene +40
const DEFAULT_WORK_MINUTES = 30; // work: energy -0.8, fun -0.4 over the window; one doWork/window
const DEFAULT_WAIT_MINUTES = 4; // wait action fallback when a tree omits durationMinutes
const WARD_ACTION_MINUTES = 8; // redrawing a threshold sign takes ~8 min
const WARD_COOLDOWN_MINUTES = 4 * TICKS_PER_HOUR; // ~4 hours between threshold redraws
const GOAL_LOCK_MINUTES = 8; // don't switch goals for a few minutes after starting one
const WANDER_PAUSE_MINUTES = 8; // a short excursion holds the goal ~8 min
const SOCIAL_DURATION_MINUTES = 10; // a social exchange lasts ~10 min
const SOCIAL_COOLDOWN_ACTOR_MINUTES = 20;
const SOCIAL_COOLDOWN_TARGET_MINUTES = 10;
// Open-ended sleep recovery, per sim-minute (net ≈ +9.6 energy/hour while asleep).
const SLEEP_ENERGY_PER_MINUTE = 0.16;
const SLEEP_COMFORT_PER_MINUTE = 0.05;
// §10.6: a walk longer than this is treated as a nav bug — fail the action rather
// than let them stroll from dawn to dusk. Tolerates real cross-town + interior
// commutes (even for slow elders) while flagging any multi-hour route.
const MAX_WALK_MINUTES = 120;

export function decayNeeds(world: SimHost, npc: Npc, opts?: { asleep?: boolean }) {
  const hourFrac = 1 / TICKS_PER_HOUR;
  const ancestry = world.defs.ancestries[npc.ancestryId];
  for (const def of world.defs.needs) {
    if (opts?.asleep && def.id === NEED.energy) continue; // no natural drain while asleep
    let rate = def.decayPerHour;
    if (def.id === NEED.thirst) {
      rate = ancestry?.thirst?.decayPerHour ?? 0;
      if (rate <= 0) {
        npc.bb.needs[NEED.thirst] = 100;
        continue;
      }
    }
    const amod = ancestry?.needModifiers[def.id];
    if (amod) rate *= amod;
    for (const t of npc.bb.traits) {
      const m = world.defs.traits[t]?.modifiers.needDecay?.[def.id];
      if (m) rate *= m;
    }
    const cur = npc.bb.needs[def.id] ?? 70;
    npc.bb.needs[def.id] = clamp(cur - rate * hourFrac, 0, 100);
  }
  // Essence ebbs slowly and wells back up, faster for the kindred.
  const cap = ancestry?.essenceCap ?? 100;
  const regen = ancestry?.essenceRegen ?? 2;
  npc.bb.essence = clamp((npc.bb.essence ?? 50) + (regen - 1) * hourFrac, 0, cap);
  npc.bb.mood = clamp(npc.bb.mood + (meanNeed(npc) - 50) * 0.01, -100, 100);
}

function meanNeed(npc: Npc) {
  const vals = Object.values(npc.bb.needs);
  if (!vals.length) return 50;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function curve(v: number, kind: string | undefined) {
  const t = clamp(1 - v / 100, 0, 1);
  if (kind === "inverse") return t;
  if (kind === "linear") return v / 100;
  return t * t;
}

export function scoreGoal(world: SimHost, npc: Npc, goal: GoalDef, time: WorldTime) {
  let s = 0;
  for (const c of goal.considerations) {
    if (c.kind === "need" && c.needId) {
      s += curve(npc.bb.needs[c.needId] ?? 50, c.curve) * c.weight;
    } else if (c.kind === "schedule") {
      const job = world.defs.jobs[npc.bb.jobId];
      s += (job && inShift(job.startHour, job.endHour, time.hourFloat) ? 1 : 0) * c.weight;
    } else if (c.kind === "timeBand") {
      s += (inShift(c.startHour ?? 0, c.endHour ?? 0, time.hourFloat) ? 1 : 0) * c.weight;
    } else if (c.kind === "constant") {
      s += (c.value ?? 0) * (c.weight || 1);
    } else if (c.kind === "nearbyPeople") {
      s += (countNearby(world, npc, 6) > 0 ? 1 : 0) * c.weight;
    }
  }
  for (const t of npc.bb.traits) {
    s += world.defs.traits[t]?.modifiers.utility?.[goal.id] ?? 0;
  }
  return s;
}

function inShift(start: number, end: number, hour: number) {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/** True while the soul is currently set on the sleep goal. */
export function isAsleep(world: SimHost, npc: Npc): boolean {
  const g = world.defs.goals.find((x) => x.id === npc.bb.goalId);
  return g?.slug === "sleep";
}

export function selectGoal(world: SimHost, npc: Npc) {
  if (npc.bb.control !== "autonomous") return;
  if (npc.bb.goalLock > 0) {
    npc.bb.goalLock--;
    return;
  }
  const time = world.time();
  let best = world.defs.goals[0]!;
  let bestS = -1e9;
  for (const g of world.defs.goals) {
    const s = scoreGoal(world, npc, g, time);
    if (s > bestS) {
      bestS = s;
      best = g;
    }
  }
  const current = world.defs.goals.find((g) => g.id === npc.bb.goalId);
  const curS = current ? scoreGoal(world, npc, current, time) : -1e9;
  const forced = forceCriticalGoal(world, npc);
  if (npc.bb.goalId && best.id !== npc.bb.goalId && !forced && bestS < curS * 1.18 + 0.04) return;
  const target = forced ?? best;
  if (target.id !== npc.bb.goalId) {
    npc.bb.goalId = target.id;
    npc.bb.treeId = target.treeId;
    npc.bb.btCursor = {};
    npc.bb.runningNodeId = null;
    npc.bb.path = null;
    npc.bb.pathI = 0;
    npc.bb.destKey = null;
    npc.bb.goalLock = GOAL_LOCK_MINUTES;
  }
}

// When a need drops below its critical threshold the soul responds to it
// immediately, overriding the hysteresis lock that would otherwise keep it on
// a low-priority background activity (a starving or exhausted person does not
// keep wandering or chatting).
function forceCriticalGoal(world: SimHost, npc: Npc): GoalDef | null {
  let target: GoalDef | null = null;
  let urgency = -1e9;
  for (const nd of world.defs.needs) {
    const val = npc.bb.needs[nd.id] ?? 100;
    if (val >= nd.criticalBelow) continue;
    const goal = world.defs.goals.find((g) => g.considerations.some((c) => c.kind === "need" && c.needId === nd.id && (c.weight ?? 0) > 0));
    if (!goal) continue;
    const ratio = val / Math.max(1, nd.criticalBelow);
    if (ratio < urgency || target === null) {
      urgency = ratio;
      target = goal;
    }
  }
  return target;
}

type Status = "success" | "failure" | "running";

export function tickTree(world: SimHost, npc: Npc) {
  if (npc.bb.control !== "autonomous") return;
  if (!npc.bb.treeId) return;
  const tree = world.defs.trees[npc.bb.treeId];
  if (!tree) return;
  const st = tickNode(world, npc, tree.root);
  npc.bb.lastStatus = st;
  if (st !== "running") npc.bb.goalLock = 0;
}

function tickNode(world: SimHost, npc: Npc, nodeId: string): Status {
  const tree = world.defs.trees[npc.bb.treeId!];
  const node = tree?.nodes[nodeId];
  if (!node) return "failure";
  npc.bb.runningNodeId = nodeId;
  if (node.type === "sequence") {
    const kids = node.children ?? [];
    let i = npc.bb.btCursor[nodeId] ?? 0;
    while (i < kids.length) {
      const st = tickNode(world, npc, kids[i]!);
      if (st === "running") {
        npc.bb.btCursor[nodeId] = i;
        return "running";
      }
      if (st === "failure") {
        npc.bb.btCursor[nodeId] = 0;
        return "failure";
      }
      i++;
    }
    npc.bb.btCursor[nodeId] = 0;
    return "success";
  }
  if (node.type === "selector") {
    const kids = node.children ?? [];
    let i = npc.bb.btCursor[nodeId] ?? 0;
    while (i < kids.length) {
      const st = tickNode(world, npc, kids[i]!);
      if (st === "running") {
        npc.bb.btCursor[nodeId] = i;
        return "running";
      }
      if (st === "success") {
        npc.bb.btCursor[nodeId] = 0;
        return "success";
      }
      i++;
    }
    npc.bb.btCursor[nodeId] = 0;
    return "failure";
  }
  if (node.type === "inverter") {
    const st = node.child ? tickNode(world, npc, node.child) : "failure";
    if (st === "running") return "running";
    return st === "success" ? "failure" : "success";
  }
  if (node.type === "condition") return evalCond(world, npc, node.cond ?? "", node.params) ? "success" : "failure";
  return runAction(world, npc, node.action ?? "", node.params);
}

function evalCond(world: SimHost, npc: Npc, cond: string, params?: Record<string, string | number | boolean>) {
  if (cond === "hasFood") return npc.bb.food > 0;
  if (cond === "hasTarget") return !!npc.bb.lastSocialTarget && !!world.npc(npc.bb.lastSocialTarget);
  if (cond === "isWorkHours") {
    const job = world.defs.jobs[npc.bb.jobId];
    if (!job) return false;
    return inShift(job.startHour, job.endHour, world.time().hourFloat);
  }
  if (cond === "needBelow") {
    const id = String(params?.need ?? "");
    return (npc.bb.needs[id] ?? 50) < Number(params?.value ?? 30);
  }
  if (cond === "isAt") {
    const dest = resolveWhere(world, npc, params?.where != null ? String(params.where) : SYS.home);
    return dest ? samePlace(npc.loc, dest) : false;
  }
  return false;
}

function runAction(
  world: SimHost,
  npc: Npc,
  action: string,
  params?: Record<string, string | number | boolean>,
): Status {
  // One-shot countdown: start effects are applied once (below); while this is
  // active the goal holds on the node and re-firing is prevented.
  if (npc.bb.waitTicks > 0) {
    npc.bb.waitTicks--;
    return npc.bb.waitTicks === 0 ? "success" : "running";
  }
  if (action === "moveTo") return actMoveTo(world, npc, params?.where != null ? String(params.where) : undefined);
  if (action === "eat") {
    if (npc.bb.food <= 0) return "failure";
    npc.bb.food -= 1;
    npc.bb.needs[NEED.hunger] = clamp((npc.bb.needs[NEED.hunger] ?? 0) + 32, 0, 100);
    npc.bb.needs[NEED.comfort] = clamp((npc.bb.needs[NEED.comfort] ?? 0) + 4, 0, 100);
    world.log({
      type: "eat",
      actorId: npc.id,
      buildingId: npc.loc.buildingId,
      summary: `${npc.name} ate.`,
      source: "sim",
    });
    return runFor(npc, numDur(params, DEFAULT_EAT_MINUTES));
  }
  if (action === "buyFood") {
    const seller = tryBuyFood(world, npc);
    return seller ? "success" : "failure";
  }
  if (action === "sleep") {
    // Open-ended: recover a little each sim-minute until well rested. No fixed
    // duration; the success condition ends it. Net ≈ +9.6 energy/hour while
    // asleep, because natural energy decay is suppressed while sleeping.
    const e = npc.bb.needs[NEED.energy] ?? 0;
    const night = inShift(21, 6, world.time().hourFloat);
    const ne = clamp(e + SLEEP_ENERGY_PER_MINUTE, 0, 100);
    npc.bb.needs[NEED.energy] = ne;
    if (night) {
      npc.bb.needs[NEED.comfort] = clamp((npc.bb.needs[NEED.comfort] ?? 0) + SLEEP_COMFORT_PER_MINUTE, 0, 100);
    }
    const rested = night ? ne >= 90 : ne >= 72;
    return rested ? "success" : "running";
  }
  if (action === "work") {
    const output = doWork(world, npc);
    // A working window costs a small amount of energy and fun, applied once.
    npc.bb.needs[NEED.energy] = clamp((npc.bb.needs[NEED.energy] ?? 0) - 0.8, 0, 100);
    npc.bb.needs[NEED.fun] = clamp((npc.bb.needs[NEED.fun] ?? 0) - 0.4, 0, 100);
    if (output === "idle") {
      npc.bb.needs[NEED.status] = clamp((npc.bb.needs[NEED.status] ?? 0) - 2, 0, 100);
    } else {
      npc.bb.needs[NEED.status] = clamp((npc.bb.needs[NEED.status] ?? 0) + 2.5, 0, 100);
    }
    return runFor(npc, numDur(params, DEFAULT_WORK_MINUTES));
  }
  if (action === "wash") {
    npc.bb.needs[NEED.hygiene] = clamp((npc.bb.needs[NEED.hygiene] ?? 0) + 40, 0, 100);
    return runFor(npc, numDur(params, DEFAULT_WASH_MINUTES));
  }
  if (action === "wait") {
    const dur = numDur(params, DEFAULT_WAIT_MINUTES);
    // Restores are spread across the whole wait window (fun +0.4/min, comfort +0.15/min).
    npc.bb.needs[NEED.fun] = clamp((npc.bb.needs[NEED.fun] ?? 0) + 0.4 * dur, 0, 100);
    npc.bb.needs[NEED.comfort] = clamp((npc.bb.needs[NEED.comfort] ?? 0) + 0.15 * dur, 0, 100);
    return runFor(npc, dur);
  }
  if (action === "wander") return actWander(world, npc);
  if (action === "findSocial") return actFindSocial(world, npc);
  if (action === "social") return actSocial(world, npc);
  if (action === "drink") {
    const st = actDrink(world, npc);
    if (st !== "success") return st;
    return runFor(npc, numDur(params, DEFAULT_DRINK_MINUTES));
  }
  if (action === "ward") {
    if (!doWard(world, npc)) return "failure";
    return runFor(npc, WARD_ACTION_MINUTES); // redrawing a threshold sign takes ~8 min
  }
  return "failure";
}

/** Resolve a tree node's duration in sim-minutes (falling back to a default). */
function numDur(params: Record<string, string | number | boolean> | undefined, dflt: number): number {
  const v = params?.durationMinutes;
  const n = Number(v ?? dflt);
  return Math.max(1, Number.isFinite(n) ? n : dflt);
}

/** Hold the goal on this node for `dur` sim-minutes (start tick + dur-1). */
function runFor(npc: Npc, dur: number): Status {
  npc.bb.waitTicks = Math.max(0, dur - 1);
  return dur > 1 ? "running" : "success";
}

/** Slake thirst from stocked shelves, else the free parish ration. */
function actDrink(world: SimHost, npc: Npc): Status {
  const ancestry = world.defs.ancestries[npc.ancestryId];
  const thirst = ancestry?.thirst;
  if (!thirst) return "failure";
  const here = world.building(npc.loc.buildingId);
  if (here && (here.stock?.[thirst.good] ?? 0) >= 1) {
    here.stock[thirst.good] -= 1;
    npc.bb.needs[NEED.thirst] = clamp((npc.bb.needs[NEED.thirst] ?? 0) + 55, 0, 100);
    return "success";
  }
  if (here) return "failure";
  // Away from shelves: the free ration, a carried phial, always enough.
  npc.bb.needs[NEED.thirst] = clamp((npc.bb.needs[NEED.thirst] ?? 0) + 25, 0, 100);
  return "success";
}

/** Find bottled vitae: current shelves, else nearest stocked house. */
function drinkDest(world: SimHost, npc: Npc): Loc | null {
  const ancestry = world.defs.ancestries[npc.ancestryId];
  const thirst = ancestry?.thirst;
  if (!thirst) return null;
  const here = world.building(npc.loc.buildingId);
  if (here && (here.stock?.[thirst.good] ?? 0) >= 1) {
    const fl = floorOf(here, npc.loc.floor ?? 0);
    const s = fl.spots[Math.floor(fl.spots.length / 2)] ?? streetDoor(here);
    return { layer: "interior", buildingId: here.id, floor: fl.index, x: s.x, y: s.y };
  }
  const p = npc.loc.layer === "city" ? { x: npc.px, y: npc.py } : null;
  const homePos = (b: (typeof world.buildings)[number]) => ({ x: b.entrance.x, y: b.entrance.y });
  const anchor = p ?? (here ? homePos(here) : { x: 28, y: 28 });
  let best: (typeof world.buildings)[number] | null = null;
  let bestD = Infinity;
  for (const b of world.buildings) {
    if ((b.stock?.[thirst.good] ?? 0) < 1) continue;
    const e = homePos(b);
    const d = Math.hypot(e.x - anchor.x, e.y - anchor.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best) return workSpot(best);
  // No stocked shelves anywhere: the free ration at the worship house.
  const worship = world.buildings.find((b) => kindTags(world, b.kind).includes("worship"));
  return worship ? workSpot(worship) : plazaLoc(world);
}

/** Kind tags from the catalog (def.tags, by kind UUID). */
function kindTags(world: SimHost, kindId: string): string[] {
  return world.defs.buildingKinds[kindId]?.tags ?? [];
}

/** The town's public square: the street tile before the first gather-tagged building. */
function plazaLoc(world: SimHost): Loc {
  const b = world.buildings.find((x) => kindTags(world, x.kind).includes("gather"));
  if (b) return { layer: "city", x: b.entrance.x, y: b.entrance.y };
  return { layer: "city", x: 28, y: 28 };
}

/** Does this soul carry the given trait (catalog id)? */
function hasTrait(npc: Npc, traitId: string): boolean {
  return npc.bb.traits.includes(traitId);
}

const lastWard = new Map<string, number>();

/**
 * Redraw the home threshold sign. Exported for tests and for the future
 * combat system, which will resolve its own actions the same way.
 */
export function doWard(world: SimHost, npc: Npc): boolean {
  const cost = 15;
  if ((npc.bb.essence ?? 0) < cost) return false;
  if (npc.loc.buildingId !== npc.bb.homeId) return false;
  const tick = world.time().tick;
  if (tick - (lastWard.get(npc.id) ?? -1e9) < WARD_COOLDOWN_MINUTES) return false;
  lastWard.set(npc.id, tick);
  npc.bb.essence -= cost;
  npc.bb.needs[NEED.comfort] = clamp((npc.bb.needs[NEED.comfort] ?? 0) + 18, 0, 100);
  world.log({
    type: "ward",
    actorId: npc.id,
    buildingId: npc.loc.buildingId,
    summary: `${npc.name} redrew the threshold sign.`,
    source: "sim",
  });
  return true;
}

// Sum the walking distance along a (possibly simplified) route. City and interior
// waypoints live in different coordinate spaces, so crossing a door or stair is a
// short hop, not a large coordinate jump. See §10.6.
function routeTiles(from: Loc, path: Loc[]): number {
  const sameSpace = (a: Loc, b: Loc) =>
    a.layer === b.layer && (a.layer !== "interior" || (a.buildingId ?? "") === (b.buildingId ?? ""));
  let d = 0;
  let prev = from;
  for (const wp of path) {
    if (!sameSpace(prev, wp)) d += 2; // crossing a door / floor boundary: short hop
    else if ((prev.floor ?? 0) !== (wp.floor ?? 0)) d += 3; // climbing stairs within one building
    else d += Math.abs(wp.x - prev.x) + Math.abs(wp.y - prev.y);
    prev = wp;
  }
  return d;
}

function actMoveTo(world: SimHost, npc: Npc, where?: string): Status {
  const dest = resolveWhere(world, npc, where ?? SYS.home);
  if (!dest) return "failure";
  if (arrived(npc, dest)) {
    npc.bb.path = null;
    npc.bb.destKey = null;
    return "success";
  }
  const key = locKey(dest);
  if (!npc.bb.path || npc.bb.destKey !== key) {
    const path = planRoute(world.map, world.buildings, npc.loc, dest);
    if (!path || path.length === 0) return "failure";
    if (Math.ceil(routeTiles(npc.loc, path) / walkSpeed(npc)) > MAX_WALK_MINUTES) {
      world.log({ type: "note", actorId: npc.id, summary: `${npc.name} gives up; the way is too far to walk.`, source: "sim" });
      return "failure";
    }
    npc.bb.path = path;
    npc.bb.pathI = 0;
    npc.bb.destKey = key;
  }
  return "running";
}

function actWander(world: SimHost, npc: Npc): Status {
  const dest = randomWalkable(world, npc);
  if (!dest) return "failure";
  const path = planRoute(world.map, world.buildings, npc.loc, dest);
  if (!path) return "failure";
  npc.bb.path = path;
  npc.bb.pathI = 0;
  npc.bb.destKey = locKey(dest);
  // Wander is a short excursion: hold the goal for a few minutes.
  npc.bb.waitTicks = Math.max(0, WANDER_PAUSE_MINUTES - 1);
  return "running";
}

function randomWalkable(world: SimHost, npc: Npc): Loc | null {
  if (npc.loc.layer === "interior") {
    const b = world.building(npc.loc.buildingId);
    if (!b) return null;
    const fl = floorOf(b, npc.loc.floor ?? 0);
    const s = fl.spots.length
      ? pick(world.rng, fl.spots)
      : { x: Math.max(1, (fl.w / 2) | 0), y: Math.max(1, (fl.h / 2) | 0) };
    return { layer: "interior", buildingId: b.id, floor: fl.index, x: s.x, y: s.y };
  }
  for (let i = 0; i < 12; i++) {
    const x = clamp(Math.round(npc.px + randInt(world.rng, -8, 8)), 1, world.map.w - 2);
    const y = clamp(Math.round(npc.py + randInt(world.rng, -8, 8)), 1, world.map.h - 2);
    if (cityWalkable(world.map, x, y)) return { layer: "city", x, y };
  }
  return { layer: "city", x: 28, y: 28 };
}

function actFindSocial(world: SimHost, npc: Npc): Status {
  if (npc.bb.socialCooldown > 0) return "failure";
  const target = pickSocialTarget(world, npc);
  npc.bb.lastSocialTarget = target?.id ?? null;
  return target ? "success" : "failure";
}

function pickSocialTarget(world: SimHost, npc: Npc): Npc | null {
  const cands: { n: Npc; s: number }[] = [];
  for (const other of world.people()) {
    if (other.id === npc.id) continue;
    if (other.bb.control === "llm") continue;
    if (!colocated(npc, other) && cityDist(world, npc, other) > 7) continue;
    const rel = getRel(npc, other.id);
    let s = 4 + rel.friendship * 0.08 + rel.familiarity * 0.04 - rel.grudge * 0.1;
    if (colocated(npc, other)) s += 6;
    s += world.rng() * 3;
    cands.push({ n: other, s });
  }
  cands.sort((a, b) => b.s - a.s);
  return cands[0]?.n ?? null;
}

function actSocial(world: SimHost, npc: Npc): Status {
  const target = npc.bb.lastSocialTarget ? world.npc(npc.bb.lastSocialTarget) : null;
  if (!target) return "failure";
  if (!colocated(npc, target) && cityDist(world, npc, target) > 1.6) {
    const dest: Loc = { ...target.loc, x: target.px, y: target.py };
    const path = planRoute(world.map, world.buildings, npc.loc, dest);
    if (!path) return "failure";
    npc.bb.path = path;
    npc.bb.pathI = 0;
    return "running";
  }
  resolveSocial(world, npc, target);
  npc.bb.socialCooldown = SOCIAL_COOLDOWN_ACTOR_MINUTES;
  target.bb.socialCooldown = Math.max(target.bb.socialCooldown, SOCIAL_COOLDOWN_TARGET_MINUTES);
  npc.bb.lastSocialTarget = null;
  npc.bb.waitTicks = Math.max(0, SOCIAL_DURATION_MINUTES - 1);
  return "running";
}

export function resolveSocial(world: SimHost, actor: Npc, target: Npc) {
  const action = pickAction(world, actor, target);
  if (!action) return;
  if (action.id === SOCIAL.ask) return resolveAsk(world, actor, target, action);
  if (action.id === SOCIAL.feed) return resolveFeed(world, actor, target, action);
  const rel = getRel(actor, target.id);
  let hit = Math.floor(world.rng() * 20) + 1;
  hit += Math.floor(rel.friendship / 25);
  hit += Math.floor(actor.bb.mood / 40);
  hit -= Math.floor(rel.grudge / 20);
  for (const t of actor.bb.traits) hit += world.defs.traits[t]?.modifiers.socialHit?.[action.id] ?? 0;
  const dc = action.dc;
  const degree = hit - dc;
  const band: keyof SocialActionDef["outcomes"] =
    degree >= 8 ? "great" : degree >= 0 ? "success" : degree <= -8 ? "critFail" : "fail";
  applyRelDelta(actor, target.id, action.outcomes[band]);
  applyRelDelta(target, actor.id, mirror(action.outcomes[band]));
  actor.bb.needs[NEED.social] = clamp((actor.bb.needs[NEED.social] ?? 0) + action.socialRestore, 0, 100);
  if (action.targetSocial) {
    target.bb.needs[NEED.social] = clamp((target.bb.needs[NEED.social] ?? 0) + action.targetSocial, 0, 100);
  }
  actor.bb.mood = clamp(actor.bb.mood + (action.outcomes[band].mood ?? 0), -100, 100);
  target.bb.mood = clamp(target.bb.mood + (action.outcomes[band].targetMood ?? 0), -100, 100);
  if (action.id === SOCIAL.vow && (band === "great" || band === "success")) {
    setBond(world, actor.id, target.id, "spouse");
  }
  if (action.id === SOCIAL.part && (band === "great" || band === "success")) {
    breakRomantic(world, actor.id, target.id);
  } else {
    considerBondPromotion(world, actor, target);
  }
  const verb =
    band === "great"
      ? "it landed beautifully"
      : band === "success"
        ? "it landed"
        : band === "fail"
          ? "it went poorly"
          : "it went badly wrong";
  world.log({
    type: action.id,
    actorId: actor.id,
    targetId: target.id,
    buildingId: actor.loc.buildingId,
    summary: `${actor.name} used ${action.label.toLowerCase()} on ${target.name} ${placeName(world, actor)} (${hit} vs DC ${dc}) — ${verb}.`,
    source: "sim",
  });
}

/** Exposed for tests and future talk UI: which social action leads. */
export function pickAction(world: SimHost, actor: Npc, target: Npc): SocialActionDef | null {
  const rel = getRel(actor, target.id);
  const kin = areBloodKin(actor, target, soulsOf(world));
  const allowed = romanceAllowed(actor, target, soulsOf(world));
  const bond = getBond(world, actor.id, target.id);
  const opts: { a: SocialActionDef; s: number }[] = [];
  for (const a of Object.values(world.defs.social)) {
    const req = a.requires;
    if (req?.minFriendship != null && rel.friendship < req.minFriendship) continue;
    if (req?.minFamiliarity != null && rel.familiarity < req.minFamiliarity) continue;
    if (req?.maxGrudge != null && rel.grudge > req.maxGrudge) continue;
    if (a.tags.includes("romance") && a.id !== SOCIAL.part) {
      if (!allowed || kin) continue;
    }
    // Feeding is a vampire matter, never kin, never romance-ruled.
    const isVamp = actor.ancestryId === ANCESTRY.vampire;
    if (a.tags.includes("feed") && !isVamp) continue;
    if (a.tags.includes("feed") && kin) continue;
    if (a.id === SOCIAL.ask && isDonor(world, target.id, actor.id)) continue;
    if (a.id === SOCIAL.vow) {
      if (bond?.status !== "partner") continue;
      const bld = world.building(actor.loc.buildingId);
      const atHome = actor.loc.buildingId === actor.bb.homeId || actor.loc.buildingId === target.bb.homeId;
      const atWorship = !!bld && kindTags(world, bld.kind).includes("worship");
      if (!atHome && !atWorship) continue;
    }
    if (a.id === SOCIAL.part) {
      if (!bond || !isRomanticStatus(bond.status)) continue;
    }
    let s = 1 + world.rng();
    if (a.tags.includes("hostile")) s += rel.grudge * 0.05 - rel.friendship * 0.03;
    if (a.tags.includes("kind")) s += rel.friendship * 0.03 + (target.bb.mood < -10 ? 1.2 : 0);
    if (a.tags.includes("romance")) s += rel.romance * 0.06 + (hasTrait(actor, TRAIT.romantic) ? 1 : 0);
    if (a.id === SOCIAL.feed) {
      s += (100 - (actor.bb.needs[NEED.thirst] ?? 100)) * 0.08;
      if (isDonor(world, target.id, actor.id)) s += 3;
      if (hasTrait(actor, TRAIT.irritable)) s += 0.8;
    }
    if (a.id === SOCIAL.ask) {
      s += (100 - (actor.bb.needs[NEED.thirst] ?? 100)) * 0.04;
      if (hasTrait(actor, TRAIT.kind)) s += 0.8;
      if (hasTrait(actor, TRAIT.irritable)) s -= 0.8;
    }
    if (a.id === SOCIAL.greet && rel.familiarity < 15) s += 2;
    if (a.id === SOCIAL.chat) s += 0.8;
    if (a.id === SOCIAL.vow) s += 1.4;
    if (a.id === SOCIAL.part) s += rel.grudge * 0.04 - rel.romance * 0.03;
    opts.push({ a, s });
  }
  opts.sort((x, y) => y.s - x.s);
  return opts[0]?.a ?? null;
}

function mirror(d: RelDelta): RelDelta {
  return {
    friendship: d.friendship,
    romance: d.romance,
    trust: d.trust,
    grudge: d.grudge,
    familiarity: d.familiarity,
    mood: d.targetMood,
    targetMood: d.mood,
  };
}

export function isDonor(world: SimHost, donorId: string, drinkerId: string): boolean {
  return world.donors.some((d) => d.donor === donorId && d.drinker === drinkerId);
}

export function addDonor(world: SimHost, donorId: string, drinkerId: string): void {
  if (donorId === drinkerId || isDonor(world, donorId, drinkerId)) return;
  world.donors.push({ donor: donorId, drinker: drinkerId, sinceTick: world.time().tick });
}

export function clearDonorsOf(world: SimHost, id: string): void {
  world.donors = world.donors.filter((d) => d.donor !== id && d.drinker !== id);
}

/**
 * Feed on a person. Exported so the future combat system can resolve
 * feeding as an attack — same function, unwilling, damage on top.
 */
export function doFeed(world: SimHost, drinker: Npc, target: Npc, willing: boolean): void {
  drinker.bb.needs[NEED.thirst] = clamp((drinker.bb.needs[NEED.thirst] ?? 0) + 70, 0, 100);
  drinker.bb.mood = clamp(drinker.bb.mood + 4, -100, 100);
  target.bb.needs[NEED.energy] = clamp((target.bb.needs[NEED.energy] ?? 0) - (willing ? 8 : 22), 0, 100);
  if (willing) {
    target.bb.mood = clamp(target.bb.mood + 3, -100, 100);
    applyRelDelta(drinker, target.id, { friendship: 4, trust: 2, familiarity: 1 });
    applyRelDelta(target, drinker.id, { friendship: 4, trust: 3, familiarity: 1 });
    world.log({
      type: "feed",
      actorId: drinker.id,
      targetId: target.id,
      buildingId: drinker.loc.buildingId,
      summary: `${target.name} offered their wrist to ${drinker.name}.`,
      source: "sim",
    });
  } else {
    target.bb.mood = clamp(target.bb.mood - 12, -100, 100);
    applyRelDelta(drinker, target.id, { familiarity: 1 });
    applyRelDelta(target, drinker.id, { friendship: -6, trust: -6, grudge: 10, familiarity: 1 });
    world.log({
      type: "feed",
      actorId: drinker.id,
      targetId: target.id,
      buildingId: drinker.loc.buildingId,
      summary: `${drinker.name} fed on ${target.name}.`,
      source: "sim",
    });
  }
}

function rollBand(world: SimHost, actor: Npc, target: Npc, action: SocialActionDef): keyof SocialActionDef["outcomes"] {
  const rel = getRel(actor, target.id);
  let hit = Math.floor(world.rng() * 20) + 1;
  hit += Math.floor(rel.friendship / 25);
  hit += Math.floor(actor.bb.mood / 40);
  hit -= Math.floor(rel.grudge / 20);
  for (const t of actor.bb.traits) hit += world.defs.traits[t]?.modifiers.socialHit?.[action.id] ?? 0;
  const degree = hit - action.dc;
  return degree >= 8 ? "great" : degree >= 0 ? "success" : degree <= -8 ? "critFail" : "fail";
}

function socialCooldowns(world: SimHost, actor: Npc, target: Npc) {
  actor.bb.socialCooldown = SOCIAL_COOLDOWN_ACTOR_MINUTES;
  target.bb.socialCooldown = Math.max(target.bb.socialCooldown, SOCIAL_COOLDOWN_TARGET_MINUTES);
  actor.bb.lastSocialTarget = null;
  actor.bb.waitTicks = Math.max(0, SOCIAL_DURATION_MINUTES - 1);
}

function resolveAsk(world: SimHost, actor: Npc, target: Npc, action: SocialActionDef) {
  const band = rollBand(world, actor, target, action);
  const out = action.outcomes[band];
  applyRelDelta(actor, target.id, out);
  applyRelDelta(target, actor.id, mirror(out));
  actor.bb.needs[NEED.social] = clamp((actor.bb.needs[NEED.social] ?? 0) + action.socialRestore, 0, 100);
  socialCooldowns(world, actor, target);
  if (band === "great" || band === "success") {
    addDonor(world, target.id, actor.id);
    world.log({
      type: "ask",
      actorId: actor.id,
      targetId: target.id,
      buildingId: actor.loc.buildingId,
      summary: `${target.name} will let ${actor.name} drink.`,
      source: "sim",
    });
  } else if (band === "critFail") {
    world.log({
      type: "ask",
      actorId: actor.id,
      targetId: target.id,
      buildingId: actor.loc.buildingId,
      summary: `${target.name} refused ${actor.name}, and the street heard about it.`,
      source: "sim",
    });
  }
}

function resolveFeed(world: SimHost, actor: Npc, target: Npc, action: SocialActionDef) {
  const band = rollBand(world, actor, target, action);
  socialCooldowns(world, actor, target);
  if (band === "great" || band === "success") {
    doFeed(world, actor, target, isDonor(world, target.id, actor.id));
  } else {
    applyRelDelta(target, actor.id, { friendship: -3, trust: -3, grudge: 5, familiarity: 1 });
    actor.bb.mood = clamp(actor.bb.mood - 4, -100, 100);
    world.log({
      type: "feed",
      actorId: actor.id,
      targetId: target.id,
      buildingId: actor.loc.buildingId,
      summary: `${target.name} drove ${actor.name} off.`,
      source: "sim",
    });
  }
}

export function applyRelDelta(npc: Npc, otherId: string, d: RelDelta) {
  const r = getRel(npc, otherId);
  r.friendship = clamp(r.friendship + (d.friendship ?? 0), -100, 100);
  r.romance = clamp(r.romance + (d.romance ?? 0), 0, 100);
  r.trust = clamp(r.trust + (d.trust ?? 0), -100, 100);
  r.grudge = clamp(r.grudge + (d.grudge ?? 0), 0, 100);
  r.familiarity = clamp(r.familiarity + (d.familiarity ?? 1), 0, 100);
  npc.relationships[otherId] = r;
}

export function getRel(npc: Npc, otherId: string): Rel {
  const existing = npc.relationships[otherId];
  if (existing) return existing;
  const r: Rel = { familiarity: 0, friendship: 0, romance: 0, trust: 10, grudge: 0 };
  npc.relationships[otherId] = r;
  return r;
}

function resolveWhere(world: SimHost, npc: Npc, where?: string): Loc | null {
  if (!where || where === SYS.home || where === SYS.bed) {
    const b = world.building(npc.bb.homeId);
    if (!b) return null;
    const bond = world.bonds.find(
      (bd) => (bd.a === npc.id || bd.b === npc.id) && (bd.status === "partner" || bd.status === "spouse"),
    );
    const partnerId = npc.spouseId ?? (bond ? (bond.a === npc.id ? bond.b : bond.a) : undefined);
    return bedOfWithBonds(b, npc, partnerId);
  }
  if (where === SYS.work) {
    const b = world.building(npc.bb.workId ?? undefined);
    return b ? workSpot(b) : plazaLoc(world);
  }
  if (where === SYS.drink) return drinkDest(world, npc);
  if (where === SYS.target) {
    const t = npc.bb.lastSocialTarget ? world.npc(npc.bb.lastSocialTarget) : null;
    return t ? { layer: t.loc.layer, buildingId: t.loc.buildingId, floor: t.loc.floor, x: t.px, y: t.py } : null;
  }
  if (where === SYS.plaza || where === SYS.wander) return plazaLoc(world);
  // A kind UUID: the first built building of that kind.
  const b = world.buildings.find((x) => x.kind === where);
  if (!b) return plazaLoc(world);
  return workSpot(b);
}

export function bedOfWithBonds(b: Building, npc: Npc, partnerId?: string): Loc {
  const beds = allBeds(b);
  if (!beds.length) {
    const d = streetDoor(b);
    return { layer: "interior", buildingId: b.id, floor: 0, x: d.x, y: d.y };
  }
  const owned = beds.find((bed) => bed.ownerId === npc.id);
  if (owned) return { layer: "interior", buildingId: b.id, floor: owned.floor, x: owned.x, y: owned.y };
  if (partnerId) {
    const shared = beds.find((bed) => bed.ownerId === partnerId);
    if (shared) return { layer: "interior", buildingId: b.id, floor: shared.floor, x: shared.x, y: shared.y };
  }
  const i = Math.abs(hashStr(npc.id)) % beds.length;
  const bed = beds[i]!;
  return { layer: "interior", buildingId: b.id, floor: bed.floor, x: bed.x, y: bed.y };
}

function workSpot(b: Building): Loc {
  const g = groundFloor(b);
  const s = g.spots[Math.floor(g.spots.length / 2)] ?? streetDoor(b);
  return { layer: "interior", buildingId: b.id, floor: 0, x: s.x, y: s.y };
}


function arrived(npc: Npc, dest: Loc) {
  if (npc.loc.layer !== dest.layer) return false;
  if ((npc.loc.buildingId ?? "") !== (dest.buildingId ?? "")) return false;
  if ((npc.loc.floor ?? 0) !== (dest.floor ?? 0)) return false;
  return dist2(npc.px, npc.py, dest.x + 0.15, dest.y + 0.15) < 0.35;
}

function colocated(a: Npc, b: Npc) {
  if (a.loc.layer !== b.loc.layer) return false;
  if (a.loc.layer === "interior") {
    return a.loc.buildingId === b.loc.buildingId && (a.loc.floor ?? 0) === (b.loc.floor ?? 0);
  }
  return dist2(a.px, a.py, b.px, b.py) < 16;
}

function cityDist(world: SimHost, a: Npc, b: Npc) {
  const ap = cityPos(world, a);
  const bp = cityPos(world, b);
  return Math.hypot(ap.x - bp.x, ap.y - bp.y);
}

function cityPos(world: SimHost, n: Npc) {
  if (n.loc.layer === "city") return { x: n.px, y: n.py };
  const b = world.building(n.loc.buildingId);
  if (b) return { x: b.entrance.x, y: b.entrance.y };
  return { x: n.px, y: n.py };
}

function countNearby(world: SimHost, npc: Npc, r: number) {
  let n = 0;
  for (const o of world.people()) {
    if (o.id === npc.id) continue;
    if (colocated(npc, o) || cityDist(world, npc, o) <= r) n++;
  }
  return n;
}

function placeName(world: SimHost, npc: Npc) {
  if (npc.loc.layer === "interior") {
    const b = world.building(npc.loc.buildingId);
    if (!b) return "inside";
    const fl = floorOf(b, npc.loc.floor ?? 0);
    const room = roomAt(fl, Math.round(npc.px), Math.round(npc.py));
    const bit = room ? `${room.name}` : fl.name;
    return `in ${b.name} (${bit})`;
  }
  return "in the street";
}

export function advanceAlongPath(npc: Npc, dt: number) {
  const path = npc.bb.path;
  if (!path || path.length === 0) {
    npc.speed = 0;
    return;
  }
  if (npc.bb.pathI >= path.length) {
    npc.bb.path = null;
    npc.speed = 0;
    return;
  }
  const wp = path[npc.bb.pathI]!;
  if (
    wp.layer !== npc.loc.layer ||
    (wp.buildingId ?? "") !== (npc.loc.buildingId ?? "") ||
    (wp.floor ?? 0) !== (npc.loc.floor ?? 0)
  ) {
    npc.loc = { layer: wp.layer, buildingId: wp.buildingId, floor: wp.floor, x: wp.x, y: wp.y };
    npc.px = wp.x + 0.5;
    npc.py = wp.y + 0.5;
    npc.bb.pathI++;
    return;
  }
  const tx = wp.x + 0.5;
  const ty = wp.y + 0.5;
  const dx = tx - npc.px;
  const dy = ty - npc.py;
  const d = Math.hypot(dx, dy);
  const walk = walkSpeed(npc);
  const step = walk * dt;
  npc.speed = walk;
  if (d < 0.08 || d <= step) {
    npc.px = tx;
    npc.py = ty;
    npc.loc.x = wp.x;
    npc.loc.y = wp.y;
    npc.bb.pathI++;
    return;
  }
  npc.px += (dx / d) * step;
  npc.py += (dy / d) * step;
  npc.facing = Math.atan2(dy, dx);
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function workSummary(world: SimHost, npc: Npc): string {
  const b = world.building(npc.bb.workId ?? undefined);
  if (!b) return npc.bb.workId ? "the street" : "nowhere";
  const stock = Object.entries(b.stock ?? {})
    .filter(([, n]) => n > 0)
    .map(([g, n]) => {
      const label = world.defs.commodities[g]?.label ?? g;
      return `${n} ${label}`;
    })
    .join(", ");
  return `${b.name} (till ${Math.floor(b.coffer ?? 0)}${stock ? `; ${stock}` : "; bare shelves"})`;
}

// Snapshot is for LLM eyes: need rows read by slug (round-trips through
// applyDeltas' NEED resolution), goals by label — never raw catalog UUIDs.
const NEED_SLUG = Object.freeze(Object.fromEntries(Object.entries(NEED).map(([slug, id]) => [id, slug])));

function goalLabel(world: SimHost, goalId: string | null): string | null {
  if (!goalId) return null;
  return world.defs.goals.find((g) => g.id === goalId)?.label ?? goalId;
}

export function snapshotNpc(world: SimHost, npc: Npc) {
  const rels = Object.entries(npc.relationships)
    .map(([id, r]) => {
      const o = world.npc(id);
      return o ? { id, name: o.name, ...r } : null;
    })
    .filter((x): x is { id: string; name: string } & Rel => !!x)
    .sort((a, b) => Math.abs(b.friendship) + Math.abs(b.grudge) - (Math.abs(a.friendship) + Math.abs(a.grudge)))
    .slice(0, 8);
  const recent = world.events
    .filter((e) => e.actorId === npc.id || e.targetId === npc.id)
    .slice(-12)
    .map((e) => ({ tick: e.tick, summary: e.summary }));
  return {
    id: npc.id,
    name: npc.name,
    age: npc.age,
    orientation: npc.orientation,
    ancestry: world.defs.ancestries[npc.ancestryId]?.label ?? npc.ancestryId,
    essence: Math.round(npc.bb.essence ?? 0),
    spells: (npc.bb.spells ?? []).map((id) => world.defs.spells[id]?.label ?? id),
    narrative: { ...npc.narrative },
    job: world.defs.jobs[npc.bb.jobId]?.label ?? npc.bb.jobId,
    coin: npc.coin,
    workplace: workSummary(world, npc),
    traits: npc.bb.traits.map((t) => world.defs.traits[t]?.label ?? t),
    needs: Object.fromEntries(Object.entries(npc.bb.needs).map(([id, v]) => [NEED_SLUG[id] ?? id, v])),
    mood: Math.round(npc.bb.mood),
    goal: goalLabel(world, npc.bb.goalId),
    location: describeLoc(world, npc),
    family: {
      parents: npc.parentIds.map((id) => world.npc(id)?.name ?? "parent (away)"),
      spouse: npc.spouseId ? (world.npc(npc.spouseId)?.name ?? npc.spouseId) : null,
    },
    bonds: world.bonds
      .filter((b) => b.a === npc.id || b.b === npc.id)
      .slice(0, 8)
      .map((b) => {
        const oid = b.a === npc.id ? b.b : b.a;
        return { with: world.npc(oid)?.name ?? oid, status: b.status };
      }),
    relationships: rels,
    recent,
    knowledge: npc.bb.knowledge.slice(-8),
  };
}

export function describeLoc(world: SimHost, npc: Npc) {
  if (npc.loc.layer === "interior") {
    const b = world.building(npc.loc.buildingId);
    if (!b) return "Inside";
    const fl = floorOf(b, npc.loc.floor ?? 0);
    const room = roomAt(fl, Math.round(npc.px), Math.round(npc.py));
    const bits = [b.name, fl.name !== "Ground" ? fl.name : null, room?.name].filter(Boolean);
    return bits.join(" · ");
  }
  return `${world.townName} streets (${Math.round(npc.px)}, ${Math.round(npc.py)})`;
}

/** Find the given tile or, failing that, the nearest walkable one within a small ring. */
function spiral(cx: number, cy: number, ok: (x: number, y: number) => boolean, radius: number): [number, number] | null {
  if (ok(cx, cy)) return [cx, cy];
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // rings only, near first
        if (ok(cx + dx, cy + dy)) return [cx + dx, cy + dy];
      }
    }
  }
  return null;
}

/** Apply an LLM location delta: teleport the body to a clamped, walkable tile. Returns false when the target is unusable. */
export function applyLocationDelta(world: SimHost, npc: Npc, loc: Loc): boolean {
  let layer: "city" | "interior";
  let buildingId: string | undefined;
  let floor: number | undefined;
  let x: number;
  let y: number;
  if (loc.layer === "city") {
    layer = "city";
    const tx = typeof loc.x === "number" && Number.isFinite(loc.x) ? Math.round(loc.x) : npc.loc.x;
    const ty = typeof loc.y === "number" && Number.isFinite(loc.y) ? Math.round(loc.y) : npc.loc.y;
    x = clamp(tx, 0, world.map.w - 1);
    y = clamp(ty, 0, world.map.h - 1);
    const hit = spiral(x, y, (cx, cy) => cityWalkable(world.map, cx, cy), 6);
    if (!hit) return false;
    [x, y] = hit;
  } else if (loc.layer === "interior") {
    const b = world.building(loc.buildingId ?? npc.loc.buildingId ?? undefined);
    if (!b || !loc.buildingId) return false; // interior without a real building — no move
    layer = "interior";
    buildingId = b.id;
    floor = clamp(Math.round(typeof loc.floor === "number" && Number.isFinite(loc.floor) ? loc.floor : (npc.loc.floor ?? 0)), 0, b.floors.length - 1);
    const fl = floorOf(b, floor);
    x = clamp(typeof loc.x === "number" && Number.isFinite(loc.x) ? Math.round(loc.x) : npc.loc.x, 0, fl.w - 1);
    y = clamp(typeof loc.y === "number" && Number.isFinite(loc.y) ? Math.round(loc.y) : npc.loc.y, 0, fl.h - 1);
    const hit = spiral(x, y, (cx, cy) => interiorWalkable(b, cx, cy, floor), 6);
    if (!hit) return false; // no walkable tile within reach on that floor
    [x, y] = hit;
  } else {
    return false; // unknown layer — never move on garbage
  }
  npc.loc = { layer, buildingId, floor, x, y };
  npc.px = x + 0.5;
  npc.py = y + 0.5;
  npc.bb.path = null;
  npc.bb.pathI = 0;
  npc.speed = 0;
  return true;
}

export function applyDeltas(world: SimHost, npc: Npc, deltas: RoleplayDeltas) {
  if (deltas.needs) {
    for (const [k, v] of Object.entries(deltas.needs)) {
      if (typeof v !== "number") continue;
      // LLM output may name a need by catalog slug; resolve to the row's id.
      const id = NEED[k] ?? k;
      npc.bb.needs[id] = clamp((npc.bb.needs[id] ?? 50) + clamp(v, -25, 25), 0, 100);
    }
  }
  if (typeof deltas.mood === "number") npc.bb.mood = clamp(npc.bb.mood + clamp(deltas.mood, -30, 30), -100, 100);
  if (deltas.relationships) {
    for (const [id, d] of Object.entries(deltas.relationships)) {
      applyRelDelta(npc, id, {
        friendship: clamp(d.friendship ?? 0, -20, 20),
        romance: clamp(d.romance ?? 0, -15, 15),
        trust: clamp(d.trust ?? 0, -20, 20),
        grudge: clamp(d.grudge ?? 0, -15, 15),
        familiarity: clamp(d.familiarity ?? 1, 0, 8),
      });
    }
  }
  if (deltas.knowledge) {
    for (const k of deltas.knowledge.slice(0, 6)) {
      if (typeof k === "string" && k.trim()) npc.bb.knowledge.push(k.trim().slice(0, 160));
    }
  }
  if (deltas.events) {
    for (const e of deltas.events.slice(0, 4)) {
      world.log({
        type: e.type || "talk",
        actorId: npc.id,
        targetId: e.targetId,
        buildingId: npc.loc.buildingId,
        summary: e.summary.slice(0, 240),
        source: "llm",
      });
    }
  }
  if (deltas.location) applyLocationDelta(world, npc, deltas.location);
}
