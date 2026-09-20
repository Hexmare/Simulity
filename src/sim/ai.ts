import { cityWalkable, dist2, interiorWalkable, locKey, planRoute, samePlace } from "./nav.ts";
import { doWork, stockOf, tryBuyFood } from "./economy.ts";
import { allBeds, floorOf, roomAt, streetDoor } from "./interiors.ts";
import { ANCESTRY, GOOD, NEED, SOCIAL, SYS, TRAIT } from "./defs.ts";
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
  ClothingItem,
  EatAffinity,
  FurnitureItem,
  GoalDef,
  Loc,
  Npc,
  Rel,
  RelDelta,
  RoleplayDeltas,
  SimHost,
  SocialActionDef,
  TaskQueue,
  TaskStep,
  WorldTime,
} from "./types.ts";
import { TICKS_PER_HOUR } from "./types.ts";
import { describeUnwornInRoom, describeWorn } from "./clothing.ts";

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

export type ClaimPrefer = "seat" | "work" | "sleep" | "cook";

export function releaseUse(npc: Npc) {
  npc.bb.usingId = null;
  npc.bb.pose = "stand";
}

function poseForPrefer(prefer: ClaimPrefer): "stand" | "sit" | "sleep" {
  if (prefer === "seat") return "sit";
  if (prefer === "sleep") return "sleep";
  return "stand";
}

function legalKinds(prefer: ClaimPrefer): Set<string> {
  if (prefer === "seat") return new Set(["chair", "pew"]);
  if (prefer === "work") return new Set(["counter", "hearth", "anvil"]);
  if (prefer === "sleep") return new Set(["bed"]);
  return new Set(["hearth", "counter"]);
}

function roomKindOf(world: SimHost, b: Building, floor: number, x: number, y: number): string | null {
  const fl = b.floors.find((f) => f.index === floor) ?? b.floors[0];
  if (!fl) return null;
  const r = fl.rooms.find((rm) => x >= rm.x && y >= rm.y && x < rm.x + rm.w && y < rm.y + rm.h);
  return r?.kind ?? null;
}

/** Occupied = another soul's bb.usingId is that item (beds allow two for owner/partner). */
function isClaimed(world: SimHost, npc: Npc, item: FurnitureItem, partnerId?: string): boolean {
  for (const o of [...world.people(), (world as { player?: Npc }).player as Npc].filter(Boolean)) {
    if (!o || o.id === npc.id) continue;
    const bb = o.bb as Npc["bb"];
    if (bb.usingId !== item.id) continue;
    if (item.kind === "bed" && item.allowsTwo) {
      if (item.ownerId === npc.id || item.ownerId === o.id) return false;
      if (partnerId && (item.ownerId === partnerId || o.id === partnerId)) return false;
      // allowsTwo beds still cap at two: if owner shares, allow; else treat second claim as occupied only if someone already there without relation
      // Simple rule: allow two when owner/partner involved, else occupied.
      return true;
    }
    return true;
  }
  return false;
}

function partnerOf(world: SimHost, npc: Npc): string | undefined {
  const bond = world.bonds.find(
    (bd) => (bd.a === npc.id || bd.b === npc.id) && (bd.status === "partner" || bd.status === "spouse"),
  );
  if (npc.spouseId) return npc.spouseId;
  if (bond) return bond.a === npc.id ? bond.b : bond.a;
  return undefined;
}

/**
 * Claim a furniture item, not a floor tile. Reserves bb.usingId + pose at
 * plan time (in-flight counts as occupied); the body snaps on arrival.
 * Returns the item, or null when nothing free.
 */
export function claimUse(world: SimHost, npc: Npc, building: Building, prefer: ClaimPrefer): FurnitureItem | null {
  const legal = legalKinds(prefer);
  const partnerId = prefer === "sleep" ? partnerOf(world, npc) : undefined;
  const cands: (FurnitureItem & { floor: number })[] = [];
  for (const f of building.floors) {
    for (const item of f.furniture ?? []) {
      if (!legal.has(item.kind)) continue;
      if (prefer === "cook") {
        const rk = roomKindOf(world, building, f.index, item.x, item.y);
        if (rk !== "kitchen") continue;
      }
      if (prefer === "sleep" && item.kind === "bed") {
        // owner/partner beds preferred but not exclusive; occupancy still applies
      }
      if (isClaimed(world, npc, item, partnerId)) continue;
      cands.push({ ...item, floor: f.index });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Sleep prefers owned/partner beds first
  if (prefer === "sleep") {
    const owned = cands.filter((c) => c.ownerId === npc.id || (partnerId && c.ownerId === partnerId));
    if (owned.length) {
      owned.sort((a, b) => (a.id < b.id ? -1 : 1));
      const chosen = owned[Math.abs(hashStr(npc.id)) % owned.length]!;
      npc.bb.usingId = chosen.id;
      npc.bb.pose = poseForPrefer(prefer);
      return chosen;
    }
  }
  const chosen = cands[Math.abs(hashStr(npc.id)) % cands.length]!;
  // Reserve now (in-flight counts as occupied); loc snaps on arrival in actMoveTo.
  if (!npc.bb.usingId || npc.bb.destKey == null) {
    npc.bb.usingId = chosen.id;
    npc.bb.pose = poseForPrefer(prefer);
  } else if (npc.bb.usingId !== chosen.id) {
    npc.bb.usingId = chosen.id;
    npc.bb.pose = poseForPrefer(prefer);
  }
  return chosen;
}

/** Overflow: wait at the street door (city layer). Clickable, never stacked inside. */
export function overflowDoor(b: Building): Loc {
  return { layer: "city", x: b.entrance.x, y: b.entrance.y };
}

function claimLoc(world: SimHost, npc: Npc, b: Building, prefer: ClaimPrefer): Loc {
  const item = claimUse(world, npc, b, prefer);
  if (item) {
    const fl = b.floors.find((f) => (f.furniture ?? []).some((x) => x.id === item.id));
    const floor = fl?.index ?? 0;
    return { layer: "interior", buildingId: b.id, floor, x: item.x, y: item.y };
  }
  releaseUse(npc);
  return overflowDoor(b);
}

// --- Eat affinity ---

export function ensureEatAffinity(world: SimHost, npc: Npc): EatAffinity {
  if (npc.bb.eatAffinity && typeof npc.bb.eatAffinity.home === "number") return npc.bb.eatAffinity;
  const r = world.rng();
  const r2 = world.rng();
  const job = world.defs.jobs[npc.bb.jobId];
  // Home-cook weight from the job's shape (no catalog literals): home-based
  // trades and short day shifts cook at home; plaza-based night trades eat out.
  let home = 0.3 + r * 0.4;
  const wp = job?.workplace;
  const span = job ? (job.endHour >= job.startHour ? job.endHour - job.startHour : 24 - job.startHour + job.endHour) : 10;
  if (wp === SYS.home || (job && job.startHour >= 6 && job.endHour <= 16 && span <= 8)) home = 0.6 + r * 0.35;
  if (wp === SYS.plaza) home = 0.05 + r * 0.2;
  // Preferred public kind among eat-tagged kinds (catalog order): often the
  // first, sometimes the others. Keys are kind UUIDs, never slugs.
  const eatKinds = Object.values(world.defs.buildingKinds)
    .filter((k) => k.tags.includes("eat"))
    .map((k) => k.id);
  const kinds: Record<string, number> = {};
  eatKinds.forEach((id, i) => {
    if (i === 0) kinds[id] = 0.5 + r2 * 0.5;
    else if (i === 1) kinds[id] = r2 < 0.3 ? 0.6 + r * 0.3 : 0.1 + r * 0.3;
    else kinds[id] = r2 > 0.6 ? 0.6 + r * 0.3 : 0.1 + r * 0.3;
  });
  npc.bb.eatAffinity = { home, kinds };
  return npc.bb.eatAffinity;
}

function pantryOf(b: Building): number {
  let n = 0;
  for (const v of Object.values(b.stock ?? {})) {
    if (typeof v === "number" && v > 0) n += v;
  }
  return n;
}

function hasKitchen(b: Building): boolean {
  return b.floors.some((f) => f.rooms.some((r) => r.kind === "kitchen"));
}

function cityDistTo(world: SimHost, npc: Npc, b: Building): number {
  const ap = npc.loc.layer === "city" ? { x: npc.px, y: npc.py } : { x: b.entrance.x, y: b.entrance.y };
  void ap;
  const anchor = npc.loc.layer === "city" ? { x: npc.px, y: npc.py } : (() => {
    const here = world.building(npc.loc.buildingId);
    return here ? { x: here.entrance.x + 0.5, y: here.entrance.y + 0.5 } : { x: 28.5, y: 28.5 };
  })();
  return Math.hypot(b.entrance.x + 0.5 - anchor.x, b.entrance.y + 0.5 - anchor.y);
}

/** Score candidates for sys:eat; claims a seat (or overflows to the door of the last try). */
export function resolveEat(world: SimHost, npc: Npc): Loc | null {
  const aff = ensureEatAffinity(world, npc);
  const cands: { b: Building; score: number; home: boolean }[] = [];
  const here = world.building(npc.loc.buildingId);
  // Guests: current building's kitchen if already inside and pantry > 0
  if (here && npc.loc.layer === "interior" && hasKitchen(here) && pantryOf(here) > 0) {
    cands.push({ b: here, score: 10 + aff.home, home: true });
  }
  const homeB = world.building(npc.bb.homeId);
  if (homeB && homeB.id !== here?.id && hasKitchen(homeB) && pantryOf(homeB) > 0) {
    cands.push({ b: homeB, score: aff.home * 4 - 0.02 * cityDistTo(world, npc, homeB), home: true });
  }
  const FOOD = GOOD.food;
  for (const b of world.buildings) {
    const kind = world.defs.buildingKinds[b.kind];
    const tagged = kind?.tags.includes("eat");
    const stocked = FOOD ? stockOf(b, FOOD) > 0 : false;
    if (!tagged && !stocked) continue;
    if (cands.some((c) => c.b.id === b.id)) continue;
    const affK = aff.kinds[b.kind] ?? 0.3;
    cands.push({ b, score: affK * 3 - 0.03 * cityDistTo(world, npc, b), home: false });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  let last: Building | null = null;
  for (const c of cands) {
    last = c.b;
    const item = claimUse(world, npc, c.b, "seat");
    if (item) {
      const fl = c.b.floors.find((f) => (f.furniture ?? []).some((x) => x.id === item.id));
      return { layer: "interior", buildingId: c.b.id, floor: fl?.index ?? 0, x: item.x, y: item.y };
    }
    // full → fall through to next score
  }
  if (last) {
    releaseUse(npc);
    return overflowDoor(last);
  }
  return null;
}

// --- Tasks ---

export function queueTask(world: SimHost, npcId: string, steps: TaskStep[]): TaskQueue | null {
  const n = world.npc(npcId);
  if (!n) return null;
  const clean: TaskStep[] = [];
  for (const s of steps.slice(0, 8)) {
    if (!s || typeof s !== "object") continue;
    if ((s as { op?: string }).op === "move") clean.push(s as TaskStep);
    else if ((s as { op?: string }).op === "tell") {
      const t = s as { op: "tell"; targetId?: string; content?: string };
      if (typeof t.targetId === "string" && typeof t.content === "string" && t.content.trim()) {
        clean.push({ op: "tell", targetId: t.targetId, content: t.content.slice(0, 500) });
      }
    }
  }
  if (!clean.length) return null;
  if (!Array.isArray(n.bb.tasks)) n.bb.tasks = [];
  const q: TaskQueue = { id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, steps: clean, stepI: 0 };
  n.bb.tasks.push(q);
  if (n.bb.tasks.length > 4) n.bb.tasks.splice(0, n.bb.tasks.length - 4);
  return q;
}

function colocatedForTell(world: SimHost, a: Npc, b: Npc): boolean {
  if (a.loc.layer === "interior" && b.loc.layer === "interior") {
    return a.loc.buildingId === b.loc.buildingId && (a.loc.floor ?? 0) === (b.loc.floor ?? 0);
  }
  if (a.loc.layer === "city" && b.loc.layer === "city") {
    return Math.hypot(a.px - b.px, a.py - b.py) <= 3;
  }
  return false;
}

type MoveTo = { buildingId?: string; room?: string; floor?: number; npcId?: string } | "sys:home" | "sys:work" | "sys:eat";

function taskDest(world: SimHost, npc: Npc, to: MoveTo): Loc | null {
  if (typeof to === "string") {
    if (to === "sys:home" || to === "sys:work" || to === "sys:eat") return resolveWhere(world, npc, to);
    return null;
  }
  if ((to as { npcId?: string }).npcId) {
    const t = world.npc((to as { npcId: string }).npcId);
    if (!t) return null;
    return { layer: t.loc.layer, buildingId: t.loc.buildingId, floor: t.loc.floor, x: Math.floor(t.px), y: Math.floor(t.py) };
  }
  if ((to as { buildingId?: string }).buildingId) {
    const tt = to as { buildingId: string; room?: string; floor?: number };
    const b = world.building(tt.buildingId);
    if (!b) return null;
    // Prefer a seat in the named room when possible
    if (tt.room) {
      for (const f of b.floors) {
        if (tt.floor != null && f.index !== tt.floor) continue;
        const room = f.rooms.find((r) => r.name === tt.room || r.kind === tt.room);
        if (room) {
          const item = claimUse(world, npc, b, "seat");
          if (item) {
            const fl = b.floors.find((ff) => (ff.furniture ?? []).some((x) => x.id === item.id));
            return { layer: "interior", buildingId: b.id, floor: fl?.index ?? f.index, x: item.x, y: item.y };
          }
          return overflowDoor(b);
        }
      }
    }
    const item = claimUse(world, npc, b, "seat");
    if (item) {
      const fl = b.floors.find((ff) => (ff.furniture ?? []).some((x) => x.id === item.id));
      return { layer: "interior", buildingId: b.id, floor: fl?.index ?? 0, x: item.x, y: item.y };
    }
    return overflowDoor(b);
  }
  return null;
}

/** Run queued tasks while control === autonomous. Returns true when a task owns this tick. */
export function stepTasks(world: SimHost, npc: Npc): boolean {
  const q = npc.bb.tasks?.[0];
  if (!q) return false;
  if (npc.bb.control !== "autonomous") return true; // queued; yield while in scene
  const step = q.steps[q.stepI];
  if (!step) {
    npc.bb.tasks!.shift();
    return false;
  }
  if (step.op === "move") {
    const dest = taskDest(world, npc, step.to as never);
    if (!dest) {
      world.log({ type: "note", actorId: npc.id, summary: `${npc.name} sets aside an errand (no path).`, source: "sim" });
      q.stepI++;
      if (q.stepI >= q.steps.length) npc.bb.tasks!.shift();
      return true;
    }
    if (arrived(npc, dest)) {
      npc.bb.path = null;
      npc.bb.destKey = null;
      q.stepI++;
      if (q.stepI >= q.steps.length) npc.bb.tasks!.shift();
      return true;
    }
    const key = locKey(dest);
    if (!npc.bb.path || npc.bb.destKey !== key) {
      const path = planRoute(world.map, world.buildings, npc.loc, dest);
      if (!path || !path.length) {
        world.log({ type: "note", actorId: npc.id, summary: `${npc.name} sets aside an errand (no path).`, source: "sim" });
        q.stepI++;
        if (q.stepI >= q.steps.length) npc.bb.tasks!.shift();
        return true;
      }
      npc.bb.path = path;
      npc.bb.pathI = 0;
      npc.bb.destKey = key;
    }
    return true;
  }
  // tell
  const target = world.npc(step.targetId);
  if (!target) {
    q.stepI++;
    if (q.stepI >= q.steps.length) npc.bb.tasks!.shift();
    return true;
  }
  if (!colocatedForTell(world, npc, target)) return true; // keep waiting on this step
  const mem = target.bb.memory ?? (target.bb.memory = []);
  mem.push({ tick: world.time().tick, speakerId: npc.id, speakerName: npc.name, content: step.content });
  if (mem.length > 200) mem.splice(0, mem.length - 200);
  applyRelDelta(npc, target.id, { familiarity: 1 });
  applyRelDelta(target, npc.id, { familiarity: 1 });
  world.log({ type: "tell", actorId: npc.id, targetId: target.id, buildingId: npc.loc.buildingId, summary: `${npc.name} tells ${target.name}: ${step.content.slice(0, 120)}`, source: "sim" });
  q.stepI++;
  if (q.stepI >= q.steps.length) npc.bb.tasks!.shift();
  return true;
}

export function appendWitnessMemory(world: SimHost, witnesses: string[], turn: { speakerId: string; speakerName: string; content: string; action?: string; presence?: string }) {
  const tick = world.time().tick;
  for (const id of witnesses) {
    if (id === "pc") continue;
    const n = world.npc(id);
    if (!n) continue;
    const mem = n.bb.memory ?? (n.bb.memory = []);
    mem.push({ tick, speakerId: turn.speakerId, speakerName: turn.speakerName, content: turn.content.slice(0, 500), action: turn.action?.slice(0, 200), presence: turn.presence });
    if (mem.length > 200) mem.splice(0, mem.length - 200);
  }
}

export function decayNeeds(world: SimHost, npc: Npc, opts?: { asleep?: boolean }) {
  // Scene-live ticks are sim seconds; autonomous ticks are sim minutes.
  const minutes = world.minutesPerTick ?? 1;
  const hourFrac = minutes / 60;
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
  npc.bb.mood = clamp(npc.bb.mood + (meanNeed(npc) - 50) * 0.01 * minutes, -100, 100);
}

/**
 * Sim-minute waits interpreted against the current tick length: a 30-minute
 * wait is 30 ticks out of scene and 1800 ticks while a scene is live.
 */
export function ticksForMinutes(world: SimHost, minutes: number): number {
  const per = world.minutesPerTick ?? 1;
  return Math.max(1, Math.round(minutes / per));
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
  if ((npc.bb.tasks?.length ?? 0) > 0) return; // utility yields to an in-flight task
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
    releaseUse(npc);
    npc.bb.goalLock = ticksForMinutes(world, GOAL_LOCK_MINUTES);
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
  if (stepTasks(world, npc)) return;
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
    return runFor(world, npc, numDur(params, DEFAULT_EAT_MINUTES));
  }
  if (action === "buyFood") {
    // Home kitchen pantry first (guests + householders): consume dry-goods/food without coin.
    const here = world.building(npc.loc.buildingId);
    if (here && npc.loc.layer === "interior") {
      const fl = floorOf(here, npc.loc.floor ?? 0);
      const room = roomAt(fl, Math.round(npc.px), Math.round(npc.py));
      const inKitchen = room?.kind === "kitchen" || hasKitchen(here);
      if (inKitchen) {
        const FOOD = GOOD.food;
        if (FOOD && (here.stock?.[FOOD] ?? 0) >= 1) {
          here.stock[FOOD] -= 1;
          npc.bb.food += 1;
          return "success";
        }
        // Pantry fallback: cook from whatever the shelves hold (no coin).
        const stocked = Object.keys(here.stock ?? {}).filter((k) => (here.stock[k] ?? 0) >= 1 && world.defs.commodities[k]);
        if (stocked.length) {
          const key = stocked.sort((a, b) => (here.stock[b] ?? 0) - (here.stock[a] ?? 0))[0]!;
          here.stock[key]! -= 1;
          npc.bb.food += 1;
          world.log({ type: "eat", actorId: npc.id, buildingId: here.id, summary: `${npc.name} cooks from the pantry at ${here.name}.`, source: "sim" });
          return "success";
        }
      }
    }
    const seller = tryBuyFood(world, npc);
    return seller ? "success" : "failure";
  }
  if (action === "sleep") {
    // Open-ended: recover a little each sim-minute until well rested. No fixed
    // duration; the success condition ends it. Net ≈ +9.6 energy/hour while
    // asleep, because natural energy decay is suppressed while sleeping.
    // Per-tick recovery scales with tick length (scene seconds vs minutes).
    const tickMinutes = world.minutesPerTick ?? 1;
    const e = npc.bb.needs[NEED.energy] ?? 0;
    const night = inShift(21, 6, world.time().hourFloat);
    const ne = clamp(e + SLEEP_ENERGY_PER_MINUTE * tickMinutes, 0, 100);
    npc.bb.needs[NEED.energy] = ne;
    if (night) {
      npc.bb.needs[NEED.comfort] = clamp((npc.bb.needs[NEED.comfort] ?? 0) + SLEEP_COMFORT_PER_MINUTE * tickMinutes, 0, 100);
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
    return runFor(world, npc, numDur(params, DEFAULT_WORK_MINUTES));
  }
  if (action === "wash") {
    npc.bb.needs[NEED.hygiene] = clamp((npc.bb.needs[NEED.hygiene] ?? 0) + 40, 0, 100);
    return runFor(world, npc, numDur(params, DEFAULT_WASH_MINUTES));
  }
  if (action === "wait") {
    const dur = numDur(params, DEFAULT_WAIT_MINUTES);
    // Restores are spread across the whole wait window (fun +0.4/min, comfort +0.15/min).
    npc.bb.needs[NEED.fun] = clamp((npc.bb.needs[NEED.fun] ?? 0) + 0.4 * dur, 0, 100);
    npc.bb.needs[NEED.comfort] = clamp((npc.bb.needs[NEED.comfort] ?? 0) + 0.15 * dur, 0, 100);
    return runFor(world, npc, dur);
  }
  if (action === "wander") return actWander(world, npc);
  if (action === "findSocial") return actFindSocial(world, npc);
  if (action === "social") return actSocial(world, npc);
  if (action === "drink") {
    const st = actDrink(world, npc);
    if (st !== "success") return st;
    return runFor(world, npc, numDur(params, DEFAULT_DRINK_MINUTES));
  }
  if (action === "ward") {
    if (!doWard(world, npc)) return "failure";
    return runFor(world, npc, WARD_ACTION_MINUTES); // redrawing a threshold sign takes ~8 min
  }
  return "failure";
}

/** Resolve a tree node's duration in sim-minutes (falling back to a default). */
function numDur(params: Record<string, string | number | boolean> | undefined, dflt: number): number {
  const v = params?.durationMinutes;
  const n = Number(v ?? dflt);
  return Math.max(1, Number.isFinite(n) ? n : dflt);
}

/** Hold the goal on this node for `dur` sim-minutes (start tick + rest). */
function runFor(world: SimHost, npc: Npc, dur: number): Status {
  const ticks = ticksForMinutes(world, dur);
  npc.bb.waitTicks = Math.max(0, ticks - 1);
  return ticks > 1 ? "running" : "success";
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
  if (best) return claimLoc(world, npc, best, "work");
  // No stocked shelves anywhere: the free ration at the worship house.
  const worship = world.buildings.find((b) => kindTags(world, b.kind).includes("worship"));
  return worship ? claimLoc(world, npc, worship, "work") : plazaLoc(world);
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
  if (tick - (lastWard.get(npc.id) ?? -1e9) < ticksForMinutes(world, WARD_COOLDOWN_MINUTES)) return false;
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
  if (!dest) {
    releaseUse(npc);
    return "failure";
  }
  if (arrived(npc, dest)) {
    npc.bb.path = null;
    npc.bb.destKey = null;
    // Snap onto the claimed furniture tile on arrival (unique occupancy).
    if (dest.layer === "interior" && npc.bb.usingId) {
      npc.loc = { ...dest };
      npc.px = dest.x + 0.5;
      npc.py = dest.y + 0.5;
    }
    return "success";
  }
  const key = locKey(dest);
  if (!npc.bb.path || npc.bb.destKey !== key) {
    const path = planRoute(world.map, world.buildings, npc.loc, dest);
    if (!path || path.length === 0) return "failure";
    if (Math.ceil(routeTiles(npc.loc, path) / walkSpeed(npc)) > ticksForMinutes(world, MAX_WALK_MINUTES)) {
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
  npc.bb.waitTicks = Math.max(0, ticksForMinutes(world, WANDER_PAUSE_MINUTES) - 1);
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
  npc.bb.socialCooldown = ticksForMinutes(world, SOCIAL_COOLDOWN_ACTOR_MINUTES);
  target.bb.socialCooldown = Math.max(target.bb.socialCooldown, ticksForMinutes(world, SOCIAL_COOLDOWN_TARGET_MINUTES));

  npc.bb.waitTicks = Math.max(0, ticksForMinutes(world, SOCIAL_DURATION_MINUTES) - 1);
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
  actor.bb.socialCooldown = ticksForMinutes(world, SOCIAL_COOLDOWN_ACTOR_MINUTES);
  target.bb.socialCooldown = Math.max(target.bb.socialCooldown, ticksForMinutes(world, SOCIAL_COOLDOWN_TARGET_MINUTES));
  actor.bb.lastSocialTarget = null;
  actor.bb.waitTicks = Math.max(0, ticksForMinutes(world, SOCIAL_DURATION_MINUTES) - 1);
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

/** Map "pc"/"PC"/"you" to the live player id. Needs the host for the id. */
export function remapRelKey(world: SimHost, key: string): string {
  const low = key.toLowerCase();
  if (low === "pc" || low === "you") {
    const pid = (world as { player?: Npc }).player?.id ?? "pc";
    return pid;
  }
  return key;
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

export function resolveWhere(world: SimHost, npc: Npc, where?: string): Loc | null {
  if (!where || where === SYS.home || where === SYS.bed) {
    const b = world.building(npc.bb.homeId);
    if (!b) return null;
    return claimLoc(world, npc, b, "sleep");
  }
  if (where === SYS.work) {
    const b = world.building(npc.bb.workId ?? undefined);
    if (!b) return plazaLoc(world);
    return claimLoc(world, npc, b, "work");
  }
  if ((SYS as Record<string, string>).eat && where === (SYS as Record<string, string>).eat) return resolveEat(world, npc);
  if (where === SYS.drink) return drinkDest(world, npc);
  if (where === SYS.target) {
    const t = npc.bb.lastSocialTarget ? world.npc(npc.bb.lastSocialTarget) : null;
    return t ? { layer: t.loc.layer, buildingId: t.loc.buildingId, floor: t.loc.floor, x: t.px, y: t.py } : null;
  }
  if (where === SYS.plaza || where === SYS.wander) return plazaLoc(world);
  // A kind UUID: the first built building of that kind — claim a seat, overflow at the door.
  const b = world.buildings.find((x) => x.kind === where);
  if (!b) return plazaLoc(world);
  return claimLoc(world, npc, b, "seat");
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

/** Legacy middle-of-spots removed. Unique furniture claims only; overflow at the door. */
export function workSpotFor(world: SimHost, npc: Npc, b: Building, prefer: ClaimPrefer = "work"): Loc {
  return claimLoc(world, npc, b, prefer);
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
  // This soul's memory tail — never another soul's memory, never the global chronicle.
  const mem = (npc.bb.memory ?? []).slice(-12).map((m) => ({ tick: m.tick, summary: `${m.speakerName}: ${m.content}` }));
  const recent = mem;
  // Self pack: presented appearance, one wearing line, unworn-in-room, secrets,
  // and the TRUE ancestry. Others never see this object (see compactCard).
  const wardrobe = world.clothing ?? [];
  const wearing = describeWorn(world.defs, wardrobe, npc);
  const roomLabel = roomNameOf(world, npc);
  const unworn =
    npc.loc.layer === "interior" && npc.loc.buildingId
      ? describeUnwornInRoom(world.defs, wardrobe, npc, roomLabel, (ownerId) => world.npc(ownerId)?.name ?? null)
      : null;
  return {
    id: npc.id,
    name: npc.name,
    age: npc.age,
    orientation: npc.orientation,
    ancestry: world.defs.ancestries[npc.ancestryId]?.label ?? npc.ancestryId,
    concealed: !!npc.concealed,
    appearance: npc.appearance ?? "",
    wearing,
    unworn,
    secrets: npc.secrets ?? "",
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

/** Room name for the unworn-in-room prompt line (null on the street). */
export function roomNameOf(world: SimHost, npc: Npc): string | null {
  if (npc.loc.layer !== "interior" || !npc.loc.buildingId) return null;
  const b = world.building(npc.loc.buildingId);
  if (!b) return null;
  const fl = floorOf(b, npc.loc.floor ?? 0);
  return roomAt(fl, Math.round(npc.px), Math.round(npc.py))?.name ?? null;
}

export function describeLoc(world: SimHost, npc: Npc) {  if (npc.loc.layer === "interior") {
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
    for (const [rawId, d] of Object.entries(deltas.relationships)) {
      const id = remapRelKey(world, rawId);
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
  // Player movement / follow own bodies while a scene is live.
  if (deltas.location && npc.bb.control !== "llm") applyLocationDelta(world, npc, deltas.location);
}
