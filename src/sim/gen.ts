import { ANCESTRY, NEED, SYS, kindsByTag } from "./defs.ts";
import { matchWorkplace, pickWorkBuilding } from "./custom.ts";
import { kitTotalPopulation } from "./kits.ts";
import { emptyWorn } from "./clothing.ts";
import { allBeds, buildFloors, doorSideFromStreet, genericKindDef, streetDoor } from "./interiors.ts";
import { pickAncestry, pickOrientation, seedFamilies, walkSpeed } from "./kin.ts";
import { makeNarrative } from "./narrative.ts";
import { cityWalkable, idx, inBounds } from "./nav.ts";
import { chance, pick, randInt, shuffle, type Rng } from "./rng.ts";
import { ensureBuildingEconomy } from "./economy.ts";
import type { Blackboard, Bond, Building, BuildingKindDef, ClothingItem, ClothingSlot, JobDef, Kit, MapGrid, Npc, Rel, TileKind, Defs } from "./types.ts";
import { MAP_H, MAP_W } from "./types.ts";

export const PORTRAITS_F = ["/portraits/mara.jpg", "/portraits/nell.jpg", "/portraits/ivy.jpg"];
export const PORTRAITS_M = ["/portraits/calder.jpg", "/portraits/bram.jpg", "/portraits/theo.jpg"];

function hashN(n: number) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Instance id: a fresh v4 UUID (building/NPC instances are not catalog rows). */
export function uid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // crypto.randomUUID only exists in secure contexts (HTTPS or loopback hosts);
  // over plain HTTP on a LAN host, fall back to a Math.random v4 with the same shape.
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 24) s += "-";
    else if (i === 14) s += "4"; // version
    else if (i === 19) s += h[8 + ((Math.random() * 4) | 0)]; // variant
    else s += h[(Math.random() * 16) | 0];
  }
  return s;
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
  businessTypeId?: string | null,
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
    businessTypeId: businessTypeId ?? null,
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
  businessTypeId?: string | null,
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
      return stampBuilding(map, buildings, def, ox, oy, r.x, r.y, name, rng, id, businessTypeId);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Appearance, secrets, clothing (Scene spec §§6–7). Adults 18+ only.
// Concealed ancestry never appears in presented appearance.

const APPEARANCE_BUILDS = ["slight", "lean", "sturdy", "broad-shouldered", "lanky", "soft-built"];
const APPEARANCE_HEIGHTS = ["short", "of average height", "tall", "very tall"];
const APPEARANCE_HAIR = [
  "close-cropped dark hair",
  "a grey-streaked braid",
  "curly auburn hair",
  "slicked-back black hair",
  "a shaved head",
  "loose silver hair",
  "a tight bun",
  "wind-tangled brown hair",
];
const APPEARANCE_MARKS = [
  "a scar through one eyebrow",
  "ink-stained fingers",
  "a chipped front tooth",
  "calloused hands",
  "a faded burn on one forearm",
  "pierced ears",
  " tired eyes",
  "a crooked nose",
];

export function makeAppearance(rng: Rng): string {
  const build = pick(rng, APPEARANCE_BUILDS);
  const height = pick(rng, APPEARANCE_HEIGHTS);
  const hair = pick(rng, APPEARANCE_HAIR);
  const mark = chance(rng, 0.6) ? `, ${pick(rng, APPEARANCE_MARKS)}` : "";
  return `${build}, ${height}, ${hair}${mark}.`.replace("  ", " ");
}

const SECRET_BY_MARK: Record<string, string> = {};

export function makeSecrets(rng: Rng, defs: Defs, ancestryId: string, concealed: boolean): string {
  if (!concealed) return "";
  const label = defs.ancestries[ancestryId]?.label ?? "";
  void SECRET_BY_MARK;
  if (/vampire/i.test(label)) return "They pass as human; they drink bottled vitae and hide the thirst.";
  if (/demon/i.test(label)) return "They pass as human; ember smolders under the skin.";
  if (/angel/i.test(label)) return "They pass as human; grace flickers at the edges when they are tired.";
  void rng;
  return "They pass as human; they are not.";
}

const OUTFIT_COLORS = ["charcoal", "dark", "white", "grey", "brown", "navy", "rust", "olive", "black", "cream"];
const OUTFIT_SCuff = ["scuffed", "worn", "polished", "patched"];

function garmentIdForSlot(defs: Defs, slot: ClothingSlot): string | null {
  for (const g of Object.values(defs.garments)) {
    if (g.slot === slot) return g.id;
  }
  return null;
}

export function dressSoul(
  rng: Rng,
  defs: Defs,
  clothing: ClothingItem[],
  npc: Npc,
  home: Building,
): void {
  npc.worn = emptyWorn();
  const wear = (slot: ClothingSlot, color?: string) => {
    const defId = garmentIdForSlot(defs, slot);
    if (!defId) return;
    const def = defs.garments[defId]!;
    const c = color ?? pick(rng, OUTFIT_COLORS);
    const label = slot === "feet" ? `${pick(rng, OUTFIT_SCuff)} ${def.label.toLowerCase()}` : `${c} ${def.label.toLowerCase()}`;
    const item: ClothingItem = { id: uid(), defId, ownerId: npc.id, label, wornBy: npc.id };
    clothing.push(item);
    npc.worn[slot] = item.id;
  };
  const store = (slot: ClothingSlot) => {
    const defId = garmentIdForSlot(defs, slot);
    if (!defId) return;
    const def = defs.garments[defId]!;
    const item: ClothingItem = {
      id: uid(),
      defId,
      ownerId: npc.id,
      label: `${pick(rng, OUTFIT_COLORS)} ${def.label.toLowerCase()}`,
      stored: { buildingId: home.id, container: "wardrobe" },
    };
    clothing.push(item);
  };
  // Base outfit. Underwear exists as items because removal is a scene tool.
  if (npc.sex === "f") wear("underwearTop");
  else wear("undershirt");
  wear("underwear");
  wear("socks");
  wear("shirt");
  wear("legs");
  wear("feet");
  if (chance(rng, 0.7)) wear("belt");
  if (chance(rng, 0.45)) wear(npc.sex === "f" ? "coat" : "overcoat");
  else if (chance(rng, 0.5)) wear("jacket");
  if (chance(rng, 0.25)) wear("hat");
  if (chance(rng, 0.2)) wear("glasses");
  // Wardrobe: 1–2 extra pieces at home.
  store(pick(rng, ["sweater", "jacket", "coat"] as ClothingSlot[]));
  if (chance(rng, 0.5)) store(pick(rng, ["hat", "sweater", "shirt"] as ClothingSlot[]));
}

export function generateWorld(rng: Rng, defs: Defs, kit: Kit, opts?: { population?: number }) {
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

  // Kit-driven queue: what this kit's city builds (catalog kind UUIDs + counts,
  // plus an optional business type per row). The People slider is total souls
  // (spec 12): it scales home-kind building counts AND how many staff slots +
  // roster rows get filled. Work/gather building counts stay as authored; only
  // staffing scales. The Player's rooms stays exactly one.
  const homeKindSet = new Set(kit.homes);
  // Authored staff slots across the kit's typed buildings (unscaled baseline).
  let baseStaff = 0;
  for (const entry of kit.buildings) {
    if (!entry.typeId) continue;
    const type = defs.businessTypes[entry.typeId];
    if (!type) continue;
    baseStaff += Math.max(1, entry.count) * type.staff.reduce((n, s) => n + Math.max(1, s.countPerInstance), 0);
  }
  const baseRoster = kit.roster.reduce((n, r) => n + Math.max(0, r.count), 0);
  const baseTotal = Math.max(1, baseStaff + baseRoster);
  const wantPeople = Math.max(1, Math.round(opts?.population ?? kitTotalPopulation(kit, defs)));
  const scale = wantPeople / baseTotal;
  const scaledCount = (count: number) => Math.max(1, Math.round(count * scale));
  const queue: { def: BuildingKindDef; name: string; typeId?: string }[] = [];
  for (const entry of kit.buildings) {
    const def = defs.buildingKinds[entry.kindId] ?? genericKindDef(entry.kindId);
    const count = homeKindSet.has(entry.kindId) && entry.kindId !== kit.pcHomeKindId ? scaledCount(Math.max(1, entry.count)) : Math.max(1, entry.count);
    for (let i = 0; i < count; i++) {
      queue.push({ def, name: def.names.length ? pick(rng, def.names) : "", typeId: entry.typeId });
    }
  }
  for (const item of queue) {
    const id = uid();
    const surname = pick(rng, defs.names.surnames);
    let name = item.name;
    if (!name && kit.unnamedHomePattern) {
      name = kit.unnamedHomePattern.replace("{surname}", surname);
    }
    placeBuildingOnMap(map, buildings, rng, item.def, name || item.def.label, id, item.typeId);
  }
  // Player's rooms: exactly one, never scaled. Omit / unknown falls back to the
  // first homes[] kind (old behavior) so custom kits without a PC house still work.
  const pcHomeDef =
    (kit.pcHomeKindId && defs.buildingKinds[kit.pcHomeKindId]) || (kit.homes[0] ? defs.buildingKinds[kit.homes[0]!] : undefined);
  let pcHomeBuilding: Building | undefined;
  if (pcHomeDef) {
    const isPcHome = (b: Building) => (kit.pcHomeKindId ? b.kind === kit.pcHomeKindId : kit.homes[0] ? b.kind === kit.homes[0] : false);
    pcHomeBuilding = buildings.find(isPcHome) ?? undefined;
    if (!pcHomeBuilding) {
      pcHomeBuilding =
        placeBuildingOnMap(map, buildings, rng, pcHomeDef, pcHomeDef.names[0] ?? pcHomeDef.label, uid(), null) ?? undefined;
    }
    if (pcHomeBuilding && kit.pcHomeKindId && pcHomeBuilding.kind !== kit.pcHomeKindId) {
      // Fallback kind filled the slot: still exactly one, still the PC's.
    }
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

  // NPC homes exclude the Player's rooms: no NPC homeId ever lands on it.
  const pcHomeId = pcHomeBuilding?.id;
  const homes = buildings.filter((b) => kit.homes.includes(b.kind) && b.id !== pcHomeId);

  const npcs: Npc[] = [];
  const clothing: ClothingItem[] = [];
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
      usingId: null,
      pose: "stand",
      memory: [],
      tasks: [],
    };
  };

  const gatherTaggedKinds = new Set(kindsByTag("gather").map((k) => k.id));
  const firstGatherBuilding = (): Building | null => buildings.find((b) => gatherTaggedKinds.has(b.kind)) ?? null;
  /**
   * Smart workplace: sys:home → home, sys:plaza → first gather building,
   * otherwise the matcher (business type id, building kind id, or tag),
   * preferring buildings with fewer assigned workers.
   */
  const workFor = (job: JobDef, home: Building): Building | null => {
    if (job.workplace === SYS.home) return home;
    if (job.workplace === SYS.plaza) return firstGatherBuilding();
    const m = matchWorkplace(defs, job.workplace);
    if (m.kind === "sys") return firstGatherBuilding();
    if (m.kind === "invalid") return null;
    return pickWorkBuilding(defs, buildings, job, npcs, rng) ?? null;
  };

  let homeI = 0;
  const households: Npc[][] = homes.map(() => []);

  const makeSoul = (job: JobDef, age: number, workOverride?: Building | null): Npc | null => {
    if (!homes.length) return null;
    const home = homes[homeI % homes.length]!;
    const hi = homes.indexOf(home);
    homeI++;
    const sex: "f" | "m" = chance(rng, 0.5) ? "f" : "m";
    const work = workOverride !== undefined ? workOverride : workFor(job, home);
    const hid = `h${hi}`;
    const beds = allBeds(home);
    const door = streetDoor(home);
    const bed = beds[households[hi]!.length % Math.max(1, beds.length)] ?? { x: door.x, y: door.y, floor: 0 };
    const ancestryId = pickAncestry(rng, defs);
    const anc = defs.ancestries[ancestryId];
    const concealed = !(anc?.mundane ?? false);
    const npc: Npc = {
      id: uid(),
      name: nameOf(sex),
      kind: "npc",
      sex,
      age,
      orientation: pickOrientation(rng),
      ancestryId,
      narrative: { public: "", private: "", voice: "" },
      appearance: makeAppearance(rng),
      secrets: makeSecrets(rng, defs, ancestryId, concealed),
      concealed,
      worn: emptyWorn(),
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
    dressSoul(rng, defs, clothing, npc, home);
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
    // A concealed soul's ancestry note stays out of public narrative — never a leak.
    const soulAnc = defs.ancestries[npc.ancestryId];
    if (soulAnc?.thirst) npc.bb.needs[soulAnc.thirst.good] = randInt(rng, 45, 75);
    npc.narrative = makeNarrative(rng, {
      name: npc.name,
      ancestryNote: concealed ? undefined : soulAnc?.note,
      job: job.label,
      traits: npc.bb.traits,
      home: home.name,
    });
    const isHuman = npc.ancestryId === ANCESTRY.human;
    if (isHuman ? chance(rng, 0.06) : chance(rng, 0.3)) {
      const ids = Object.keys(defs.spells);
      npc.bb.spells = shuffle(rng, ids).slice(0, npc.ancestryId === ANCESTRY.demon && chance(rng, 0.4) ? 2 : 1);
    }
    return npc;
  };

  const soulAge = (row: { ages?: [number, number] }): number =>
    row.ages && row.ages.length === 2
      ? randInt(rng, Math.min(row.ages[0]!, row.ages[1]!), Math.max(row.ages[0]!, row.ages[1]!))
      : randInt(rng, 18, 58);

  // Largest-remainder distribution: split wantTotal across weights proportionally,
  // exact sum, rows may get 0 (tiny cities leave shops unstaffed — spec 12).
  const distribute = (wantTotal: number, weights: number[]): number[] => {
    const totalWeight = weights.reduce((n, w) => n + Math.max(0, w), 0);
    if (weights.length === 0) return [];
    if (totalWeight <= 0) {
      // No baseline: even split.
      const each = Math.floor(wantTotal / weights.length);
      const out = weights.map(() => each);
      let rest = wantTotal - each * weights.length;
      for (let i = 0; rest > 0 && i < out.length; i++, rest--) out[i]!++;
      return out;
    }
    const quotas = weights.map((w) => (Math.max(0, w) / totalWeight) * wantTotal);
    const out = quotas.map((q) => Math.floor(q));
    let rest = wantTotal - out.reduce((n, x) => n + x, 0);
    const order = quotas
      .map((q, i) => ({ i, frac: q - Math.floor(q) }))
      .sort((a, b) => b.frac - a.frac);
    for (const { i } of order) {
      if (rest <= 0) break;
      out[i]!++;
      rest--;
    }
    return out;
  };

  // Staff slots across placed typed buildings (work buildings stay as authored;
  // only how many slots get filled scales with People).
  const staffGroups: { job: JobDef; building: Building; weight: number }[] = [];
  for (const b of buildings) {
    if (!b.businessTypeId) continue;
    const type = defs.businessTypes[b.businessTypeId];
    if (!type) continue;
    for (const row of type.staff) {
      const job = defs.jobs[row.jobId];
      if (!job) continue;
      staffGroups.push({ job, building: b, weight: Math.max(1, row.countPerInstance) });
    }
  }
  const staffBase = staffGroups.reduce((n, g) => n + g.weight, 0);
  const staffWant = baseTotal > 0 ? Math.round((staffBase / baseTotal) * wantPeople) : 0;
  const rosterWant = Math.max(0, wantPeople - staffWant);
  const staffCounts = distribute(staffWant, staffGroups.map((g) => g.weight));
  const rosterWeights = kit.roster.map((r) => Math.max(0, r.count));
  const rosterCounts = distribute(rosterWant, rosterWeights);

  // Staff first (workId pinned to their building); roster extras after.
  staffGroups.forEach((g, i) => {
    for (let k = 0; k < (staffCounts[i] ?? 0); k++) {
      makeSoul(g.job, soulAge({ ages: [18, 58] }), g.building);
    }
  });

  // Kit-driven roster: extras who live here and are not implied by staff.
  kit.roster.forEach((row, i) => {
    const job = defs.jobs[row.jobId];
    if (!job) return;
    for (let k = 0; k < (rosterCounts[i] ?? 0); k++) {
      if (!homes.length) break;
      makeSoul(job, soulAge(row));
    }
  });

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
  // Their bed is in the Player's rooms: exactly one building, never an NPC home.
  const spawnB = firstGatherBuilding() ?? buildings[0]!;
  const street = spawnOnStreet(map, buildings, spawnB);
  const pcJob = defs.jobs[kit.defaultPcJobId]!;
  const pcHome = pcHomeBuilding ?? homes[0] ?? buildings[0]!;
  const pcAncestryId = defs.ancestries[ANCESTRY.human] ? ANCESTRY.human : Object.keys(defs.ancestries)[0]!;
  const pcAncDef = defs.ancestries[pcAncestryId];
  const pcConcealed = !(pcAncDef?.mundane ?? false);
  const player: Npc = {
    id: "pc",
    name: "You",
    kind: "pc",
    sex: "m",
    age: kit.pcAge,
    orientation: pickOrientation(rng),
    ancestryId: pcAncestryId,
    narrative: { public: "", private: "", voice: "" },
    appearance: makeAppearance(rng),
    secrets: makeSecrets(rng, defs, pcAncestryId, pcConcealed),
    concealed: pcConcealed,
    worn: emptyWorn(),
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
  dressSoul(rng, defs, clothing, player, pcHome);
  player.narrative = makeNarrative(rng, {
    name: "You",
    ancestryNote: player.ancestryId === ANCESTRY.human ? pcAncDef?.note : undefined,
    job: pcJob.label,
    traits: player.bb.traits,
    home: pcHome.name,
  });

  return { map, buildings, npcs, player, bonds, clothing };
}
