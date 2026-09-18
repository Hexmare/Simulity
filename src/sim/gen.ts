import { ANCESTRY, NEED, SYS, kindsByTag } from "./defs.ts";
import { allBeds, buildFloors, doorSideFromStreet, genericKindDef, streetDoor } from "./interiors.ts";
import { pickAncestry, pickOrientation, seedFamilies, walkSpeed } from "./kin.ts";
import { makeNarrative } from "./narrative.ts";
import { cityWalkable, idx, inBounds } from "./nav.ts";
import { chance, pick, randInt, shuffle, type Rng } from "./rng.ts";
import { ensureBuildingEconomy } from "./economy.ts";
import type { Blackboard, Bond, Building, BuildingKindDef, JobDef, Kit, MapGrid, Npc, Rel, TileKind, Defs } from "./types.ts";
import { MAP_H, MAP_W } from "./types.ts";

export const PORTRAITS_F = ["/portraits/mara.jpg", "/portraits/nell.jpg", "/portraits/ivy.jpg"];
export const PORTRAITS_M = ["/portraits/calder.jpg", "/portraits/bram.jpg", "/portraits/theo.jpg"];

function hashN(n: number) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Instance id: a stable unique UUID per building/NPC (saved in town data). */
/** Instance id: a fresh v4 UUID (building/NPC instances are not catalog rows). */
export function uid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return c?.randomUUID ? c.randomUUID() : `id_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function spawnOnStreet(map: MapGrid, buildings: Building[], from: Building) {
  const taken = new Set(buildings.map((b) => `${b.entrance.x},${b.entrance.y}`));
  const q = [from.entrance];
  const seen = new Set([`${from.entrance.x},${from.entrance.y}`]);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  while (q.length) {
    const c = q.shift()!;
    for (const [dx, dy] of dirs) {
      const x = c.x + dx;
      const y = c.y + dy;
      const k = `${x},${y}`;
      if (seen.has(k)) continue;
      if (!cityWalkable(map, x, y)) continue;
      seen.add(k);
      if (!taken.has(k)) return { x: x + 0.5, y: y + 0.5 };
      q.push({ x, y });
    }
  }
  return { x: from.entrance.x + 0.5, y: from.entrance.y + 0.5 };
}

function occupiedFrom(map: MapGrid, buildings: Building[]) {
  const occ = new Uint8Array(map.blocked.length);
  occ.set(map.blocked);
  for (const b of buildings) {
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) occ[idx(xx, yy, map.w)] = 1;
    }
  }
  return occ;
}

function canPlace(map: MapGrid, occ: Uint8Array, x: number, y: number, bw: number, bh: number) {
  if (x < 1 || y < 1 || x + bw >= map.w - 1 || y + bh >= map.h - 1) return false;
  for (let yy = y; yy < y + bh; yy++) {
    for (let xx = x; xx < x + bw; xx++) {
      const t = map.tiles[idx(xx, yy, map.w)];
      if (t === "road" || t === "plaza" || t === "water" || t === "tree") return false;
      if (occ[idx(xx, yy, map.w)]) return false;
    }
  }
  return true;
}

export function stampBuilding(
  map: MapGrid,
  buildings: Building[],
  def: BuildingKindDef,
  x: number,
  y: number,
  ex: number,
  ey: number,
  name: string,
  rng: Rng,
  id: string,
): Building {
  const fp = def.footprint;
  const doorSide = doorSideFromStreet(x, y, fp.w, fp.h, ex, ey);
  const floors = buildFloors(def, doorSide, rng);
  const t = map.tiles[idx(ex, ey, map.w)];
  map.tiles[idx(ex, ey, map.w)] = t === "plaza" ? "plaza" : "dirt";
  for (let yy = y; yy < y + fp.h; yy++) {
    for (let xx = x; xx < x + fp.w; xx++) map.blocked[idx(xx, yy, map.w)] = 1;
  }
  map.blocked[idx(ex, ey, map.w)] = 0;
  const b: Building = {
    id,
    kind: def.id,
    name,
    x,
    y,
    w: fp.w,
    h: fp.h,
    entrance: { x: ex, y: ey },
    doorSide,
    // Preferred roof tint from the kind row (data); omitted = a random tint.
    roof: def.roof ?? randInt(rng, 0, 3),
    floors,
    stock: {},
    coffer: 0,
  };
  ensureBuildingEconomy(b);
  buildings.push(b);
  return b;
}

export function placeBuildingOnMap(
  map: MapGrid,
  buildings: Building[],
  rng: Rng,
  def: BuildingKindDef,
  name: string,
  id: string,
): Building | null {
  const fp = def.footprint;
  const occ = occupiedFrom(map, buildings);
  const dirs = shuffle(rng, [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as [number, number][]);
  const roads: { x: number; y: number }[] = [];
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const t = map.tiles[idx(x, y, map.w)];
      if (t === "road" || t === "plaza") roads.push({ x, y });
    }
  }
  for (const r of shuffle(rng, roads)) {
    for (const [dx, dy] of dirs) {
      const nx = r.x + dx;
      const ny = r.y + dy;
      if (!inBounds(nx, ny)) continue;
      const t = map.tiles[idx(nx, ny, map.w)];
      if (t !== "grass" && t !== "dirt") continue;
      const ox = dx < 0 ? r.x - fp.w : dx > 0 ? r.x + 1 : r.x - ((fp.w / 2) | 0);
      const oy = dy < 0 ? r.y - fp.h : dy > 0 ? r.y + 1 : r.y - ((fp.h / 2) | 0);
      if (!canPlace(map, occ, ox, oy, fp.w, fp.h)) continue;
      return stampBuilding(map, buildings, def, ox, oy, r.x, r.y, name, rng, id);
    }
  }
  return null;
}

export function generateWorld(rng: Rng, defs: Defs, kit: Kit) {
  const w = MAP_W;
  const h = MAP_H;
  const tiles: TileKind[] = Array.from({ length: w * h }, () => "grass");
  const blocked = new Uint8Array(w * h);

  const paintRoad = (x0: number, y0: number, x1: number, y1: number) => {
    let x = x0;
    let y = y0;
    while (x !== x1 || y !== y1) {
      tiles[idx(x, y, w)] = "road";
      if (x !== x1) x += Math.sign(x1 - x);
      else y += Math.sign(y1 - y);
    }
    tiles[idx(x1, y1, w)] = "road";
  };

  for (const y of [18, 28, 39]) paintRoad(4, y, 51, y);
  for (const x of [16, 28, 41]) paintRoad(x, 5, x, 50);
  paintRoad(16, 10, 41, 10);
  paintRoad(16, 46, 41, 46);

  for (let y = 24; y <= 32; y++) {
    for (let x = 24; x <= 32; x++) tiles[idx(x, y, w)] = "plaza";
  }

  for (let i = 0; i < 70; i++) {
    const x = randInt(rng, 1, w - 2);
    const y = randInt(rng, 1, h - 2);
    if (tiles[idx(x, y, w)] === "grass" && (x < 10 || x > 46 || y < 8 || y > 48)) {
      tiles[idx(x, y, w)] = "tree";
    }
  }

  const map: MapGrid = { w, h, tiles, blocked };
  const buildings: Building[] = [];

  // Kit-driven queue: what this kit's town builds (catalog kind UUIDs + counts).
  const queue: { def: BuildingKindDef; name: string }[] = [];
  for (const entry of kit.buildings) {
    const def = defs.buildingKinds[entry.kindId] ?? genericKindDef(entry.kindId);
    for (let i = 0; i < Math.max(1, entry.count); i++) {
      queue.push({ def, name: def.names.length ? pick(rng, def.names) : "" });
    }
  }
  for (const item of queue) {
    const id = uid();
    const surname = pick(rng, defs.names.surnames);
    let name = item.name;
    if (!name && kit.unnamedHomePattern) {
      name = kit.unnamedHomePattern.replace("{surname}", surname);
    }
    placeBuildingOnMap(map, buildings, rng, item.def, name || item.def.label, id);
  }

  for (let i = 0; i < blocked.length; i++) {
    const t = tiles[i]!;
    if (t === "tree" || t === "water") blocked[i] = 1;
  }
  for (const b of buildings) {
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) blocked[idx(xx, yy, w)] = 1;
    }
    blocked[idx(b.entrance.x, b.entrance.y, w)] = 0;
  }

  const homes = buildings.filter((b) => kit.homes.includes(b.kind));

  const npcs: Npc[] = [];
  let nid = 0;
  const usedNames = new Set<string>();
  const nameOf = (sex: "f" | "m") => {
    const firsts = sex === "f" ? defs.names.firstF : defs.names.firstM;
    for (let k = 0; k < 30; k++) {
      const n = `${pick(rng, firsts)} ${pick(rng, defs.names.surnames)}`;
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
    return `${pick(rng, firsts)} ${pick(rng, defs.names.surnames)} ${nid}`;
  };

  const traitIds = Object.keys(defs.traits);
  const makeRel = (close: boolean): Rel => ({
    familiarity: close ? randInt(rng, 50, 90) : randInt(rng, 0, 12),
    friendship: close ? randInt(rng, 35, 75) : randInt(rng, 0, 18),
    romance: 0,
    trust: close ? randInt(rng, 30, 70) : randInt(rng, 5, 25),
    grudge: close && chance(rng, 0.08) ? randInt(rng, 5, 20) : 0,
  });

  const makeBb = (job: JobDef, home: Building, work: Building | null, householdId: string): Blackboard => {
    const needs: Record<string, number> = {};
    for (const n of defs.needs) needs[n.id] = n.id === NEED.thirst ? 100 : randInt(rng, 55, 92);
    const traits = shuffle(rng, traitIds).slice(0, randInt(rng, 2, 3));
    return {
      needs,
      mood: randInt(rng, -10, 25),
      traits,
      jobId: job.id,
      homeId: home.id,
      workId: work?.id ?? null,
      householdId,
      food: chance(rng, 0.4) ? 1 : 0,
      essence: randInt(rng, 40, 80),
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
    };
  };

  const gatherTaggedKinds = new Set(kindsByTag("gather").map((k) => k.id));
  const firstGatherBuilding = (): Building | null => buildings.find((b) => gatherTaggedKinds.has(b.kind)) ?? null;
  /** sys:home → home, sys:plaza → first gather-tagged building, kind UUID → matching building (else null). */
  const workFor = (job: JobDef, home: Building): Building | null => {
    if (job.workplace === SYS.home) return home;
    const spots = job.workplace === SYS.plaza ? [] : buildings.filter((b) => b.kind === job.workplace);
    if (spots.length) return pick(rng, spots);
    return job.workplace === SYS.plaza ? firstGatherBuilding() : null;
  };

  let homeI = 0;
  const households: Npc[][] = homes.map(() => []);

  // Kit-driven roster: who lives here (catalog job UUIDs + counts + age bands).
  for (const row of kit.roster) {
    const job = defs.jobs[row.jobId];
    if (!job) continue;
    for (let i = 0; i < Math.max(1, row.count); i++) {
      if (!homes.length) break;
      const home = homes[homeI % homes.length]!;
      const hi = homes.indexOf(home);
      homeI++;
      const sex: "f" | "m" = chance(rng, 0.5) ? "f" : "m";
      const age = row.ages && row.ages.length === 2 ? randInt(rng, Math.min(row.ages[0]!, row.ages[1]!), Math.max(row.ages[0]!, row.ages[1]!)) : randInt(rng, 18, 58);
      const work = workFor(job, home);
      const hid = `h${hi}`;
      const beds = allBeds(home);
      const door = streetDoor(home);
      const bed = beds[households[hi]!.length % Math.max(1, beds.length)] ?? { x: door.x, y: door.y, floor: 0 };
      const npc: Npc = {
        id: uid(),
        name: nameOf(sex),
        kind: "npc",
        sex,
        age,
        orientation: pickOrientation(rng),
        ancestryId: pickAncestry(rng, defs),
        narrative: { public: "", private: "", voice: "" },
        parentIds: [],
        palette: (hashN(nid) + job.palette) % 12,
        coin: 0,
        portrait: sex === "f" ? PORTRAITS_F[nid % PORTRAITS_F.length] : PORTRAITS_M[nid % PORTRAITS_M.length],
        loc: { layer: "interior", buildingId: home.id, floor: bed.floor, x: bed.x, y: bed.y },
        px: bed.x + 0.5,
        py: bed.y + 0.5,
        facing: 0,
        speed: walkSpeed({ age, kind: "npc" } as Npc),
        bb: makeBb(job, home, work, hid),
        relationships: {},
      };
      nid++;
      npcs.push(npc);
      households[hi]!.push(npc);
      // Founding auto-assign: one bed per resident. Claim the spawn bed if free, else the next free bed.
      const fl = home.floors.find((f) => f.index === bed.floor) ?? home.floors[0]!;
      const at = fl?.furniture?.find((item) => item.kind === "bed" && item.x === bed.x && item.y === bed.y && !item.ownerId);
      if (at) at.ownerId = npc.id;
      else {
        const free = home.floors
          .slice()
          .sort((a, c) => a.index - c.index)
          .flatMap((f) => (f.furniture ?? []).map((item) => ({ item, floor: f })))
          .find(({ item }) => item.kind === "bed" && !item.ownerId);
        if (free) {
          free.item.ownerId = npc.id;
          npc.loc = { layer: "interior", buildingId: home.id, floor: free.floor.index, x: free.item.x, y: free.item.y };
          npc.px = free.item.x + 0.5;
          npc.py = free.item.y + 0.5;
        }
      }
      // Personhood: thirst for ancestries with a thirst need (data-driven), a paragraph, maybe a sign.
      const anc = defs.ancestries[npc.ancestryId];
      if (anc?.thirst) npc.bb.needs[anc.thirst.good] = randInt(rng, 45, 75);
      npc.narrative = makeNarrative(rng, {
        name: npc.name,
        ancestryNote: anc?.note,
        job: job.label,
        traits: npc.bb.traits,
        home: home.name,
      });
      const isHuman = npc.ancestryId === ANCESTRY.human;
      if (isHuman ? chance(rng, 0.06) : chance(rng, 0.3)) {
        const ids = Object.keys(defs.spells);
        npc.bb.spells = shuffle(rng, ids).slice(0, npc.ancestryId === ANCESTRY.demon && chance(rng, 0.4) ? 2 : 1);
      }
    }
  }

  for (const group of households) {
    for (const a of group) {
      for (const b of group) {
        if (a.id === b.id) continue;
        a.relationships[b.id] = makeRel(true);
      }
    }
  }
  for (let i = 0; i < npcs.length; i++) {
    for (let k = 0; k < 4; k++) {
      const other = npcs[randInt(rng, 0, npcs.length - 1)]!;
      if (!other || other.id === npcs[i]!.id) continue;
      if (npcs[i]!.relationships[other.id]) continue;
      npcs[i]!.relationships[other.id] = makeRel(false);
    }
  }

  const bonds: Bond[] = [];
  seedFamilies(npcs, rng, 0, bonds);

  // Player spawns on the street by the first gather-tagged building (else the first building).
  const spawnB = firstGatherBuilding() ?? buildings[0]!;
  const street = spawnOnStreet(map, buildings, spawnB);
  const pcJob = defs.jobs[kit.defaultPcJobId]!;
  const pcHome = homes[0] ?? buildings[0]!;
  const player: Npc = {
    id: "pc",
    name: "You",
    kind: "pc",
    sex: "m",
    age: kit.pcAge,
    orientation: pickOrientation(rng),
    ancestryId: defs.ancestries[ANCESTRY.human] ? ANCESTRY.human : Object.keys(defs.ancestries)[0]!,
    narrative: { public: "", private: "", voice: "" },
    parentIds: [],
    palette: 0,
    coin: 0,
    portrait: "/portraits/player.jpg",
    loc: { layer: "city", x: Math.floor(street.x), y: Math.floor(street.y) },
    px: street.x,
    py: street.y,
    facing: 0,
    speed: 0,
    bb: makeBb(pcJob, pcHome, workFor(pcJob, pcHome), "pc"),
    relationships: {},
  };
  player.bb.control = "player";
  const pcAnc = defs.ancestries[player.ancestryId];
  player.narrative = makeNarrative(rng, {
    name: "You",
    ancestryNote: player.ancestryId === ANCESTRY.human ? pcAnc?.note : undefined,
    job: pcJob.label,
    traits: player.bb.traits,
    home: homes[0]?.name ?? kit.label,
  });

  return { map, buildings, npcs, player, bonds };
}
