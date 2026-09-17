import { chance, pick, randInt, type Rng } from "./rng.ts";
import type { Building, BuildingKindDef, DoorSide, Floor, FloorLayout, FurnitureDef, FurnitureItem, FurniturePlanItem, InteriorCell, Room, RoomTemplate, Stair, TileKind } from "./types.ts";

export const FURNITURE_CATALOG: FurnitureDef[] = [
  { id: "bed", label: "Bed", tile: "bed", roomKinds: ["bedroom", "bunk", "loft", "hall"], tags: ["sleep"], allowsTwo: true },
  { id: "table", label: "Table", tile: "table", roomKinds: ["taproom", "hall", "parlour", "snug", "kitchen"], tags: ["seat", "work"] },
  { id: "hearth", label: "Hearth", tile: "hearth", roomKinds: ["kitchen", "hall"], tags: ["work"] },
  { id: "counter", label: "Counter", tile: "counter", roomKinds: ["kitchen", "shop", "taproom", "workshop", "mill", "office"], tags: ["work", "storage"] },
  { id: "shelf", label: "Shelf", tile: "shelf", roomKinds: ["bedroom", "kitchen", "shop", "office", "cellar", "workshop", "mill"], tags: ["storage"] },
  { id: "crate", label: "Crate", tile: "crate", roomKinds: ["bedroom", "taproom", "shop", "workshop", "mill", "cellar", "hall", "loft"], tags: ["storage"] },
  { id: "rug", label: "Rug", tile: "rug", roomKinds: ["bedroom", "taproom", "hall", "parlour", "snug", "sanctuary", "loft"], tags: [] },
  { id: "altar", label: "Altar", tile: "altar", roomKinds: ["sanctuary"], tags: ["work"] },
  { id: "pew", label: "Pew", tile: "pew", roomKinds: ["sanctuary"], tags: ["seat"] },
  { id: "anvil", label: "Anvil", tile: "anvil", roomKinds: ["workshop"], tags: ["work"] },
];

function idx(x: number, y: number, w: number) {
  return y * w + x;
}

function inBounds(x: number, y: number, w: number, h: number) {
  return x >= 0 && y >= 0 && x < w && y < h;
}

const FURNISH: Record<string, TileKind[]> = {
  bedroom: ["bed", "crate", "rug", "shelf"],
  kitchen: ["hearth", "counter", "counter", "shelf"],
  taproom: ["counter", "table", "table", "table", "crate", "rug"],
  shop: ["counter", "counter", "crate", "shelf", "crate"],
  sanctuary: ["altar", "pew", "pew", "pew", "rug"],
  workshop: ["anvil", "counter", "crate", "shelf"],
  mill: ["counter", "crate", "crate", "shelf"],
  hall: ["rug", "table", "crate"],
  office: ["counter", "shelf", "crate"],
  bunk: ["bed", "bed", "crate"],
  cellar: ["crate", "crate", "shelf"],
  loft: ["bed", "crate", "rug"],
  well: ["crate"],
  parlour: ["table", "rug", "shelf"],
  snug: ["table", "rug", "crate"],
};

export function doorSideFromStreet(bx: number, by: number, bw: number, bh: number, ex: number, ey: number): DoorSide {
  const dx = ex + 0.5 - (bx + bw / 2);
  const dy = ey + 0.5 - (by + bh / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}

export function groundFloor(b: Building): Floor {
  return b.floors.find((f) => f.index === 0) ?? b.floors[0]!;
}

export function floorOf(b: Building, i = 0): Floor {
  return b.floors.find((f) => f.index === i) ?? b.floors.find((f) => f.index === 0) ?? b.floors[0]!;
}

export function floorByIndex(b: Building, i: number): Floor | undefined {
  return b.floors.find((f) => f.index === i);
}

export function sortedFloors(b: Building): Floor[] {
  return b.floors.slice().sort((a, c) => a.index - c.index);
}

export function streetDoor(b: Building): { x: number; y: number } {
  return groundFloor(b).door ?? { x: 1, y: 1 };
}

export function allBeds(b: Building): { x: number; y: number; floor: number; id?: string; ownerId?: string }[] {
  const out: { x: number; y: number; floor: number; id?: string; ownerId?: string }[] = [];
  for (const f of b.floors) {
    if (f.furniture?.length) {
      for (const item of f.furniture) {
        if (item.kind === "bed") out.push({ x: item.x, y: item.y, floor: f.index, id: item.id, ownerId: item.ownerId });
      }
    } else {
      for (const bed of f.beds) out.push({ x: bed.x, y: bed.y, floor: f.index });
    }
  }
  return out;
}

export function allFurniture(b: Building): (FurnitureItem & { floor: number })[] {
  const out: (FurnitureItem & { floor: number })[] = [];
  for (const f of b.floors) {
    for (const item of f.furniture ?? []) out.push({ ...item, floor: f.index });
  }
  return out;
}

let furnitureSeq = 0;
export function nextFurnitureId(): string {
  furnitureSeq++;
  return `f${Date.now().toString(36)}${furnitureSeq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Rebuild beds[]/spots[] caches from tiles. Keeps furniture[] in sync (adds missing, drops orphaned). */
export function rebuildFloorCaches(fl: Floor): void {
  fl.beds = [];
  fl.spots = [];
  if (!Array.isArray(fl.furniture)) fl.furniture = [];
  const seen = new Set<string>();
  for (let y = 0; y < fl.h; y++) {
    for (let x = 0; x < fl.w; x++) {
      const t = fl.tiles[y * fl.w + x]!;
      if (t === "bed") fl.beds.push({ x, y });
      if (t === "floor" || t === "rug" || t === "door") fl.spots.push({ x, y });
      if (t === "bed" || t === "table" || t === "hearth" || t === "counter" || t === "shelf" || t === "crate" || t === "rug" || t === "altar" || t === "pew" || t === "anvil") {
        seen.add(`${x},${y}`);
      }
    }
  }
  // Drop furniture items whose tile no longer matches.
  fl.furniture = fl.furniture.filter((item) => {
    if (item.x < 0 || item.y < 0 || item.x >= fl.w || item.y >= fl.h) return false;
    const t = fl.tiles[item.y * fl.w + item.x];
    if (t !== item.kind) return false;
    seen.delete(`${item.x},${item.y}`);
    return true;
  });
  // Create items for furniture tiles that lack one.
  for (const key of seen) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const kind = fl.tiles[y * fl.w + x]!;
    fl.furniture.push({
      id: nextFurnitureId(),
      kind,
      x,
      y,
      floor: fl.index,
      allowsTwo: kind === "bed" ? true : undefined,
    });
  }
  for (const item of fl.furniture) item.floor = fl.index;
}

export function roomAt(floor: Floor, x: number, y: number): Room | undefined {
  return floor.rooms.find((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
}

export function stairAt(floor: Floor, x: number, y: number): Stair | undefined {
  return floor.stairs.find((s) => s.x === x && s.y === y);
}

export function walkableTile(t: TileKind | undefined) {
  return !!t && t !== "wall" && t !== "window";
}

function doorOn(w: number, h: number, side: DoorSide) {
  if (side === "n") return { x: (w / 2) | 0, y: 0 };
  if (side === "s") return { x: (w / 2) | 0, y: h - 1 };
  if (side === "e") return { x: w - 1, y: (h / 2) | 0 };
  return { x: 0, y: (h / 2) | 0 };
}

function blank(w: number, h: number, side: DoorSide | null, name: string, index: number): Floor {
  const tiles: TileKind[] = Array.from({ length: w * h }, () => "floor");
  for (let x = 0; x < w; x++) {
    tiles[idx(x, 0, w)] = "wall";
    tiles[idx(x, h - 1, w)] = "wall";
  }
  for (let y = 0; y < h; y++) {
    tiles[idx(0, y, w)] = "wall";
    tiles[idx(w - 1, y, w)] = "wall";
  }
  let door: { x: number; y: number } | undefined;
  if (side) {
    door = doorOn(w, h, side);
    tiles[idx(door.x, door.y, w)] = "door";
  }
  return { index, name, w, h, tiles, rooms: [], door, stairs: [], beds: [], spots: [], furniture: [] };
}

function punchWindows(fl: Floor, doorSide: DoorSide | null, rng: Rng) {
  const sides: DoorSide[] = ["n", "s", "e", "w"];
  for (const side of sides) {
    if (side === doorSide) continue;
    if (!chance(rng, 0.85)) continue;
    const run = side === "n" || side === "s" ? fl.w : fl.h;
    const step = run > 8 ? 3 : 2;
    for (let i = 2; i < run - 2; i += step) {
      if (!chance(rng, 0.7)) continue;
      if (side === "n") fl.tiles[idx(i, 0, fl.w)] = "window";
      if (side === "s") fl.tiles[idx(i, fl.h - 1, fl.w)] = "window";
      if (side === "w") fl.tiles[idx(0, i, fl.w)] = "window";
      if (side === "e") fl.tiles[idx(fl.w - 1, i, fl.w)] = "window";
    }
  }
  if (fl.door) fl.tiles[idx(fl.door.x, fl.door.y, fl.w)] = "door";
}

/** Compile a data layout cell into room rects on the floor's inner region. */
function applySplit(fl: Floor, x: number, y: number, w: number, h: number, cell: InteriorCell, rng: Rng, rooms: Room[], id: { n: number }) {
  if (cell.t === "room") {
    rooms.push({ id: `r${id.n++}`, name: cell.name ?? cell.kind, kind: cell.kind, x, y, w, h });
    return;
  }
  const min = 3;
  if (cell.t === "v") {
    if (w < min * 2 + 1) {
      const leaf = firstRoomOf(cell);
      rooms.push({ id: `r${id.n++}`, name: leaf.name, kind: leaf.kind, x, y, w, h });
      return;
    }
    const at = cell.at ?? 0.42 + rng() * 0.16;
    const wx = Math.max(x + min, Math.min(x + w - min - 1, x + Math.round(w * at)));
    const gap = Math.max(y + 1, Math.min(y + h - 2, y + randInt(rng, 1, Math.max(1, h - 2))));
    for (let yy = y; yy < y + h; yy++) {
      if (yy === gap) {
        fl.tiles[idx(wx, yy, fl.w)] = "door";
      } else if (inBounds(wx, yy, fl.w, fl.h) && fl.tiles[idx(wx, yy, fl.w)] !== "door") {
        fl.tiles[idx(wx, yy, fl.w)] = "wall";
      }
    }
    applySplit(fl, x, y, wx - x, h, cell.a, rng, rooms, id);
    applySplit(fl, wx + 1, y, x + w - wx - 1, h, cell.b, rng, rooms, id);
  } else {
    if (h < min * 2 + 1) {
      const leaf = firstRoomOf(cell);
      rooms.push({ id: `r${id.n++}`, name: leaf.name, kind: leaf.kind, x, y, w, h });
      return;
    }
    const at = cell.at ?? 0.42 + rng() * 0.16;
    const wy = Math.max(y + min, Math.min(y + h - min - 1, y + Math.round(h * at)));
    const gap = Math.max(x + 1, Math.min(x + w - 2, x + randInt(rng, 1, Math.max(1, w - 2))));
    for (let xx = x; xx < x + w; xx++) {
      if (xx === gap) {
        fl.tiles[idx(xx, wy, fl.w)] = "door";
      } else if (inBounds(xx, wy, fl.w, fl.h) && fl.tiles[idx(xx, wy, fl.w)] !== "door") {
        fl.tiles[idx(xx, wy, fl.w)] = "wall";
      }
    }
    applySplit(fl, x, y, w, wy - y, cell.a, rng, rooms, id);
    applySplit(fl, x, wy + 1, w, y + h - wy - 1, cell.b, rng, rooms, id);
  }
}

function carveAisle(fl: Floor, side: DoorSide) {
  if (!fl.door) return;
  let x = fl.door.x;
  let y = fl.door.y;
  const step = inward({ x, y }, side);
  const dx = Math.sign(step.x - x);
  const dy = Math.sign(step.y - y);
  for (let i = 0; i < 2; i++) {
    x += dx;
    y += dy;
    if (!inBounds(x, y, fl.w, fl.h)) break;
    const t = fl.tiles[idx(x, y, fl.w)];
    if (t === "wall" || t === "window") fl.tiles[idx(x, y, fl.w)] = "floor";
  }
  fl.tiles[idx(fl.door.x, fl.door.y, fl.w)] = "door";
}

function placeTile(fl: Floor, rng: Rng, used: Set<string>, r: Room, tile: TileKind) {
  const cells: { x: number; y: number }[] = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const t = fl.tiles[idx(x, y, fl.w)];
      if (t !== "floor") continue;
      if (fl.door && Math.abs(x - fl.door.x) + Math.abs(y - fl.door.y) < 2) continue;
      if (used.has(`${x},${y}`)) continue;
      cells.push({ x, y });
    }
  }
  if (!cells.length) return false;
  const s = pick(rng, cells);
  used.add(`${s.x},${s.y}`);
  fl.tiles[idx(s.x, s.y, fl.w)] = tile;
  if (tile === "bed") fl.beds.push({ x: s.x, y: s.y });
  return true;
}

function furnish(fl: Floor, plan: FurniturePlanItem[], rng: Rng) {
  const used = new Set<string>();
  for (const r of fl.rooms) {
    // Per-room-kind defaults stay in code (FURNISH); count scales with area.
    const kinds = FURNISH[r.kind] ?? FURNISH.hall!;
    const n = Math.min(kinds.length, Math.max(1, ((r.w * r.h) / 7) | 0));
    for (let i = 0; i < n; i++) {
      if (!placeTile(fl, rng, used, r, kinds[i % kinds.length]!)) break;
    }
  }
  // Data-driven extras on top of the room-kind defaults.
  for (const item of plan) {
    let count = item.count ?? 1;
    for (const r of fl.rooms.filter((r) => r.kind === item.roomKind)) {
      while (count > 0 && placeTile(fl, rng, used, r, item.tile)) count--;
      if (count <= 0) break;
    }
  }
  for (let y = 1; y < fl.h - 1; y++) {
    for (let x = 1; x < fl.w - 1; x++) {
      const t = fl.tiles[idx(x, y, fl.w)]!;
      if (t === "floor" || t === "rug" || t === "door") fl.spots.push({ x, y });
    }
  }
  rebuildFloorCaches(fl);
}

export function linkStairs(lower: Floor, upper: Floor, rng: Rng) {
  const prefer = lower.rooms.filter((r) => r.kind === "hall" || r.kind === "taproom" || r.kind === "kitchen");
  const rooms = prefer.length ? prefer : lower.rooms;
  const room = rooms.length ? pick(rng, rooms) : { x: 1, y: 1, w: lower.w - 2, h: lower.h - 2 };
  const cands: { x: number; y: number }[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (lower.tiles[idx(x, y, lower.w)] !== "floor") continue;
      if (lower.door && Math.abs(x - lower.door.x) + Math.abs(y - lower.door.y) < 2) continue;
      const up = upper.tiles[idx(x, y, upper.w)];
      if (up === "wall" || up === "window") continue;
      cands.push({ x, y });
    }
  }
  const s = cands.length ? pick(rng, cands) : { x: (lower.w / 2) | 0, y: (lower.h / 2) | 0 };
  lower.tiles[idx(s.x, s.y, lower.w)] = "stairs";
  upper.tiles[idx(s.x, s.y, upper.w)] = "stairs";
  lower.stairs.push({ x: s.x, y: s.y, toFloor: upper.index, toX: s.x, toY: s.y });
  upper.stairs.push({ x: s.x, y: s.y, toFloor: lower.index, toX: s.x, toY: s.y });
  rebuildFloorCaches(lower);
  rebuildFloorCaches(upper);
}


/** Generic def for unknown kind ids (removed overlays, pre-catalog saves). */
export function genericKindDef(id: string): BuildingKindDef {
  return { id, slug: id, label: id, names: [], footprint: { w: 5, h: 4 }, stories: 1, ground: [{ kind: "hall", name: "Hall" }], doorSide: "any", tags: [] };
}

/** Flat room list → equal-width strip chain (v or h). List must be non-empty. */
function cellFromList(list: RoomTemplate[], t: "v" | "h"): InteriorCell {
  if (list.length === 1) return { t: "room", kind: list[0]!.kind, name: list[0]!.name ?? list[0]!.kind };
  const n = list.length;
  return { t, at: (n - 1) / n, a: cellFromList(list.slice(0, n - 1), t), b: { t: "room", kind: list[n - 1]!.kind, name: list[n - 1]!.name ?? list[n - 1]!.kind } };
}

/** The first (door-side) leaf room of a cell tree. */
function firstRoomOf(cell: InteriorCell): { kind: string; name: string } {
  if (cell.t === "room") return { kind: cell.kind, name: cell.name ?? cell.kind };
  return firstRoomOf(cell.a);
}

/** No explicit layouts → synthesize strips from the def's flat room lists + clamped footprint. */
function synthesizeLayout(def: BuildingKindDef): FloorLayout {
  const w = Math.max(4, Math.min(14, Math.round(def.footprint.w) || 5));
  const h = Math.max(4, Math.min(12, Math.round(def.footprint.h) || 4));
  const t: "v" | "h" = w >= h ? "v" : "h";
  return {
    w,
    h,
    ground: cellFromList(def.ground.length ? def.ground : [{ kind: "hall", name: "Hall" }], t),
    upper: def.upper ? cellFromList(def.upper, t) : undefined,
  };
}

function hasRoomKind(cell: InteriorCell | undefined, kind: string): boolean {
  if (!cell) return false;
  if (cell.t === "room") return cell.kind === kind;
  return hasRoomKind(cell.a, kind) || hasRoomKind(cell.b, kind);
}

/**
 * Compile floors from the kind def alone — no per-kind case bodies.
 * Explicit layouts are used verbatim (no clamping of given w/h); a def without
 * layouts gets strips synthesized from its flat room lists and footprint.
 */
export function buildFloors(def: BuildingKindDef, doorSide: DoorSide, rng: Rng): Floor[] {
  const layout = def.layouts?.length ? pick(rng, def.layouts) : synthesizeLayout(def);
  const w = Math.max(2, Math.round(layout.w ?? 5));
  const h = Math.max(2, Math.round(layout.h ?? 4));

  const id = { n: 0 };
  const ground = blank(w, h, doorSide, "Ground", 0);
  if (layout.ground && w >= 3 && h >= 3) applySplit(ground, 1, 1, w - 2, h - 2, layout.ground, rng, ground.rooms, id);
  carveAisle(ground, doorSide);
  punchWindows(ground, doorSide, rng);
  furnish(ground, def.furniturePlan ?? [], rng);
  carveAisle(ground, doorSide);
  const floors: Floor[] = [ground];
  if (def.stories === 2) {
    // Named "Loft" when any upper room is a loft, else "Upstairs".
    const upperName = hasRoomKind(layout.upper, "loft") ? "Loft" : "Upstairs";
    const upper = blank(w, h, null, upperName, 1);
    if (layout.upper && w >= 3 && h >= 3) applySplit(upper, 1, 1, w - 2, h - 2, layout.upper, rng, upper.rooms, id);
    punchWindows(upper, null, rng);
    furnish(upper, def.furniturePlan ?? [], rng);
    linkStairs(ground, upper, rng);
    floors.push(upper);
  }
  // Bed guarantee for home kinds (generalized old cottage/farmhouse rule).
  if (!ground.beds.length && def.tags.includes("home")) {
    const s = ground.spots[0];
    if (s) {
      ground.tiles[idx(s.x, s.y, ground.w)] = "bed";
      ground.beds.push(s);
    }
  }
  for (const f of floors) rebuildFloorCaches(f);
  return floors;
}
export function inward(door: { x: number; y: number }, side: DoorSide) {
  if (side === "n") return { x: door.x, y: door.y + 1 };
  if (side === "s") return { x: door.x, y: door.y - 1 };
  if (side === "e") return { x: door.x - 1, y: door.y };
  return { x: door.x + 1, y: door.y };
}
