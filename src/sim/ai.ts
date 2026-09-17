import { cityWalkable, dist2, locKey, planRoute, samePlace } from "./nav";
import { doWork, tryBuyFood } from "./economy";
import { allBeds, floorOf, groundFloor, roomAt, streetDoor } from "./interiors";
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
} from "./kin";
import { pick, randInt } from "./rng";
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
} from "./types";
import { TICKS_PER_HOUR } from "./types";

export function decayNeeds(world: SimHost, npc: Npc) {
  const hourFrac = 1 / TICKS_PER_HOUR;
  const ancestry = world.defs.ancestries[npc.ancestryId];
  for (const def of world.defs.needs) {
    let rate = def.decayPerHour;
    if (def.id === "thirst") {
      rate = ancestry?.thirst?.decayPerHour ?? 0;
      if (rate <= 0) {
        npc.bb.needs.thirst = 100;
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
  if (npc.bb.goalId && best.id !== npc.bb.goalId && bestS < curS * 1.18 + 0.04) return;
  if (best.id !== npc.bb.goalId) {
    npc.bb.goalId = best.id;
    npc.bb.treeId = best.treeId;
    npc.bb.btCursor = {};
    npc.bb.runningNodeId = null;
    npc.bb.path = null;
    npc.bb.pathI = 0;
    npc.bb.destKey = null;
    npc.bb.goalLock = 10;
  }
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
    const dest = resolveWhere(world, npc, String(params?.where ?? "home"));
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
  if (npc.bb.waitTicks > 0) {
    npc.bb.waitTicks--;
    return "running";
  }
  if (action === "moveTo") return actMoveTo(world, npc, String(params?.where ?? "home"));
  if (action === "eat") {
    if (npc.bb.food <= 0) return "failure";
    npc.bb.food -= 1;
    npc.bb.needs.hunger = clamp((npc.bb.needs.hunger ?? 0) + 42, 0, 100);
    npc.bb.needs.comfort = clamp((npc.bb.needs.comfort ?? 0) + 6, 0, 100);
    world.log({
      type: "eat",
      actorId: npc.id,
      buildingId: npc.loc.buildingId,
      summary: `${npc.name} ate.`,
      source: "sim",
    });
    return "success";
  }
  if (action === "buyFood") {
    const seller = tryBuyFood(world, npc);
    return seller ? "success" : "failure";
  }
  if (action === "sleep") {
    const e = npc.bb.needs.energy ?? 0;
    npc.bb.needs.energy = clamp(e + 14, 0, 100);
    npc.bb.needs.comfort = clamp((npc.bb.needs.comfort ?? 0) + 4, 0, 100);
    const night = inShift(21, 6, world.time().hourFloat);
    if ((npc.bb.needs.energy ?? 0) < 88 && night) {
      npc.bb.waitTicks = 2;
      return "running";
    }
    if (e < 70) {
      npc.bb.waitTicks = 1;
      return "running";
    }
    return "success";
  }
  if (action === "work") {
    const output = doWork(world, npc);
    npc.bb.needs.energy = clamp((npc.bb.needs.energy ?? 0) - 1.2, 0, 100);
    npc.bb.needs.fun = clamp((npc.bb.needs.fun ?? 0) - 0.6, 0, 100);
    if (output === "idle") {
      npc.bb.needs.status = clamp((npc.bb.needs.status ?? 0) - 2, 0, 100);
    } else {
      npc.bb.needs.status = clamp((npc.bb.needs.status ?? 0) + 2.5, 0, 100);
    }
    npc.bb.waitTicks = 3;
    return "success";
  }
  if (action === "wash") {
    npc.bb.needs.hygiene = clamp((npc.bb.needs.hygiene ?? 0) + 38, 0, 100);
    return "success";
  }
  if (action === "wait") {
    const ticks = Number(params?.ticks ?? 4);
    npc.bb.needs.fun = clamp((npc.bb.needs.fun ?? 0) + 6, 0, 100);
    npc.bb.needs.comfort = clamp((npc.bb.needs.comfort ?? 0) + 3, 0, 100);
    npc.bb.waitTicks = Math.max(0, ticks - 1);
    return "success";
  }
  if (action === "wander") return actWander(world, npc);
  if (action === "findSocial") return actFindSocial(world, npc);
  if (action === "social") return actSocial(world, npc);
  if (action === "drink") return actDrink(world, npc);
  if (action === "ward") {
    if (!doWard(world, npc)) return "failure";
    npc.bb.waitTicks = 2;
    return "success";
  }
  return "failure";
}

/** Slake thirst from bottled stock, else the free temple ration. */
function actDrink(world: SimHost, npc: Npc): Status {
  const ancestry = world.defs.ancestries[npc.ancestryId];
  const thirst = ancestry?.thirst;
  if (!thirst) return "failure";
  const here = world.building(npc.loc.buildingId);
  if (here && (here.stock?.[thirst.good] ?? 0) >= 1) {
    here.stock[thirst.good] -= 1;
    npc.bb.needs.thirst = clamp((npc.bb.needs.thirst ?? 0) + 55, 0, 100);
    return "success";
  }
  if (here) return "failure";
  // Away from shelves: the temple ration, a carried phial, always enough.
  npc.bb.needs.thirst = clamp((npc.bb.needs.thirst ?? 0) + 25, 0, 100);
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
  const temple = world.buildings.find((b) => b.kind === "temple");
  return temple ? workSpot(temple) : plaza();
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
  if (tick - (lastWard.get(npc.id) ?? -1e9) < 48) return false;
  lastWard.set(npc.id, tick);
  npc.bb.essence -= cost;
  npc.bb.needs.comfort = clamp((npc.bb.needs.comfort ?? 0) + 18, 0, 100);
  world.log({
    type: "ward",
    actorId: npc.id,
    buildingId: npc.loc.buildingId,
    summary: `${npc.name} redrew the threshold sign.`,
    source: "sim",
  });
  return true;
}

function actMoveTo(world: SimHost, npc: Npc, where: string): Status {
  const dest = resolveWhere(world, npc, where);
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
    npc.bb.path = path;
    npc.bb.pathI = 0;
    npc.bb.destKey = key;
  }
  return "running";
}

function actWander(world: SimHost, npc: Npc): Status {
  if (npc.bb.path && npc.bb.pathI < npc.bb.path.length) return "running";
  const dest = randomWalkable(world, npc);
  if (!dest) return "failure";
  const path = planRoute(world.map, world.buildings, npc.loc, dest);
  if (!path) return "failure";
  npc.bb.path = path;
  npc.bb.pathI = 0;
  npc.bb.destKey = locKey(dest);
  npc.bb.waitTicks = 2;
  return "success";
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
  npc.bb.socialCooldown = 8;
  target.bb.socialCooldown = Math.max(target.bb.socialCooldown, 4);
  npc.bb.lastSocialTarget = null;
  npc.bb.waitTicks = 2;
  return "success";
}

export function resolveSocial(world: SimHost, actor: Npc, target: Npc) {
  const action = pickAction(world, actor, target);
  if (!action) return;
  if (action.id === "ask") return resolveAsk(world, actor, target, action);
  if (action.id === "feed") return resolveFeed(world, actor, target, action);
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
  actor.bb.needs.social = clamp((actor.bb.needs.social ?? 0) + action.socialRestore, 0, 100);
  if (action.targetSocial) {
    target.bb.needs.social = clamp((target.bb.needs.social ?? 0) + action.targetSocial, 0, 100);
  }
  actor.bb.mood = clamp(actor.bb.mood + (action.outcomes[band].mood ?? 0), -100, 100);
  target.bb.mood = clamp(target.bb.mood + (action.outcomes[band].targetMood ?? 0), -100, 100);
  if (action.id === "vow" && (band === "great" || band === "success")) {
    setBond(world, actor.id, target.id, "spouse");
  }
  if (action.id === "part" && (band === "great" || band === "success")) {
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
    if (a.tags.includes("romance") && a.id !== "part") {
      if (!allowed || kin) continue;
    }
    // Feeding is a vampire matter, never kin, never romance-ruled.
    const isVamp = actor.ancestryId === "vampire";
    if (a.tags.includes("feed") && !isVamp) continue;
    if (a.tags.includes("feed") && kin) continue;
    if (a.id === "ask" && isDonor(world, target.id, actor.id)) continue;
    if (a.id === "vow") {
      if (bond?.status !== "partner") continue;
      const bld = world.building(actor.loc.buildingId);
      const atHome = actor.loc.buildingId === actor.bb.homeId || actor.loc.buildingId === target.bb.homeId;
      const atTemple = bld?.kind === "temple";
      if (!atHome && !atTemple) continue;
    }
    if (a.id === "part") {
      if (!bond || !isRomanticStatus(bond.status)) continue;
    }
    let s = 1 + world.rng();
    if (a.tags.includes("hostile")) s += rel.grudge * 0.05 - rel.friendship * 0.03;
    if (a.tags.includes("kind")) s += rel.friendship * 0.03 + (target.bb.mood < -10 ? 1.2 : 0);
    if (a.tags.includes("romance")) s += rel.romance * 0.06 + (actor.bb.traits.includes("romantic") ? 1 : 0);
    if (a.id === "feed") {
      s += (100 - (actor.bb.needs.thirst ?? 100)) * 0.08;
      if (isDonor(world, target.id, actor.id)) s += 3;
      if (actor.bb.traits.includes("irritable")) s += 0.8;
    }
    if (a.id === "ask") {
      s += (100 - (actor.bb.needs.thirst ?? 100)) * 0.04;
      if (actor.bb.traits.includes("kind")) s += 0.8;
      if (actor.bb.traits.includes("irritable")) s -= 0.8;
    }
    if (a.id === "greet" && rel.familiarity < 15) s += 2;
    if (a.id === "chat") s += 0.8;
    if (a.id === "vow") s += 1.4;
    if (a.id === "part") s += rel.grudge * 0.04 - rel.romance * 0.03;
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
  drinker.bb.needs.thirst = clamp((drinker.bb.needs.thirst ?? 0) + 70, 0, 100);
  drinker.bb.mood = clamp(drinker.bb.mood + 4, -100, 100);
  target.bb.needs.energy = clamp((target.bb.needs.energy ?? 0) - (willing ? 8 : 22), 0, 100);
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
  actor.bb.socialCooldown = 8;
  target.bb.socialCooldown = Math.max(target.bb.socialCooldown, 4);
  actor.bb.lastSocialTarget = null;
  actor.bb.waitTicks = 2;
}

function resolveAsk(world: SimHost, actor: Npc, target: Npc, action: SocialActionDef) {
  const band = rollBand(world, actor, target, action);
  const out = action.outcomes[band];
  applyRelDelta(actor, target.id, out);
  applyRelDelta(target, actor.id, mirror(out));
  actor.bb.needs.social = clamp((actor.bb.needs.social ?? 0) + action.socialRestore, 0, 100);
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

function resolveWhere(world: SimHost, npc: Npc, where: string): Loc | null {
  if (where === "home" || where === "bed") {
    const b = world.building(npc.bb.homeId);
    if (!b) return null;
    const bond = world.bonds.find(
      (bd) => (bd.a === npc.id || bd.b === npc.id) && (bd.status === "partner" || bd.status === "spouse"),
    );
    const partnerId = npc.spouseId ?? (bond ? (bond.a === npc.id ? bond.b : bond.a) : undefined);
    return bedOfWithBonds(b, npc, partnerId);
  }
  if (where === "work") {
    const id = npc.bb.workId ?? npc.bb.homeId;
    const b = world.building(id);
    return b ? workSpot(b) : plaza();
  }
  if (where === "drink") return drinkDest(world, npc);
  if (where === "target") {
    const t = npc.bb.lastSocialTarget ? world.npc(npc.bb.lastSocialTarget) : null;
    return t ? { layer: t.loc.layer, buildingId: t.loc.buildingId, floor: t.loc.floor, x: t.px, y: t.py } : null;
  }
  if (where === "plaza") return plaza();
  const b = world.buildings.find((x) => x.kind === where) ?? world.building(npc.bb.homeId);
  if (!b) return plaza();
  if (b.kind === "well") return { layer: "city", x: b.entrance.x, y: b.entrance.y };
  return workSpot(b);
}

function bedOf(b: Building, npc: Npc): Loc {
  const beds = allBeds(b);
  if (!beds.length) {
    const d = streetDoor(b);
    return { layer: "interior", buildingId: b.id, floor: 0, x: d.x, y: d.y };
  }
  const owned = beds.find((bed) => bed.ownerId === npc.id);
  if (owned) return { layer: "interior", buildingId: b.id, floor: owned.floor, x: owned.x, y: owned.y };
  // Shared bed with a partner/spouse who owns one that allows two.
  // Partner id may live on spouseId or on a bond; check both.
  const partnerIds = new Set<string>();
  if (npc.spouseId) partnerIds.add(npc.spouseId);
  // Bonds are on the world, not the npc — handled by caller via spouseId; keep hash fallback otherwise.
  void partnerIds;
  const i = Math.abs(hashStr(npc.id)) % beds.length;
  const bed = beds[i]!;
  return { layer: "interior", buildingId: b.id, floor: bed.floor, x: bed.x, y: bed.y };
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

function plaza(): Loc {
  return { layer: "city", x: 28, y: 28 };
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
    .map(([g, n]) => `${n} ${g}`)
    .join(", ");
  return `${b.name} (till ${Math.floor(b.coffer ?? 0)}${stock ? `; ${stock}` : "; bare shelves"})`;
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
    needs: { ...npc.bb.needs },
    mood: Math.round(npc.bb.mood),
    goal: npc.bb.goalId,
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
  return `Streets of Fenwick (${Math.round(npc.px)}, ${Math.round(npc.py)})`;
}

export function applyDeltas(world: SimHost, npc: Npc, deltas: RoleplayDeltas) {
  if (deltas.needs) {
    for (const [k, v] of Object.entries(deltas.needs)) {
      if (typeof v !== "number") continue;
      npc.bb.needs[k] = clamp((npc.bb.needs[k] ?? 50) + clamp(v, -25, 25), 0, 100);
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
}
