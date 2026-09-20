import { floorByIndex, floorOf, nextFurnitureId, rebuildFloorCaches, walkableTile } from "./interiors.ts";
import type { Building, Floor, Room, Stair, TileKind } from "./types.ts";

function tileIdx(x: number, y: number, w: number) {
  return y * w + x;
}

function inBounds(x: number, y: number, w: number, h: number) {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export type PaintTile = TileKind | "erase";

const FURNITURE_TILES: TileKind[] = ["bed", "table", "hearth", "counter", "shelf", "crate", "rug", "altar", "pew", "anvil", "chair"];

function isFurnitureTile(t: TileKind): boolean {
  return FURNITURE_TILES.includes(t);
}

export function paintTile(b: Building, floorIndex: number, x: number, y: number, tile: PaintTile): boolean {
  const fl = floorByIndex(b, floorIndex);
  if (!fl) return false;
  if (!inBounds(x, y, fl.w, fl.h)) return false;
  const next: TileKind = tile === "erase" ? "floor" : tile;
  // Street door tile is protected: use setStreetDoor to move it.
  if (fl.door && fl.index === 0 && fl.door.x === x && fl.door.y === y && next !== "door") return false;
  fl.tiles[tileIdx(x, y, fl.w)] = next;
  // Painting over stairs removes the stair link on this floor.
  if (next !== "stairs") {
    const si = fl.stairs.findIndex((s) => s.x === x && s.y === y);
    if (si >= 0) {
      const removed = fl.stairs[si]!;
      fl.stairs.splice(si, 1);
      const other = floorByIndex(b, removed.toFloor);
      if (other) {
        other.stairs = other.stairs.filter((s) => !(s.toFloor === fl.index && s.toX === x && s.toY === y));
        rebuildFloorCaches(other);
      }
    }
  } else {
    // Painting stairs without a link is a plain walkable tile until linked; validation will flag it.
  }
  if (fl.door && fl.tiles[tileIdx(fl.door.x, fl.door.y, fl.w)] !== "door") {
    fl.tiles[tileIdx(fl.door.x, fl.door.y, fl.w)] = "door";
  }
  rebuildFloorCaches(fl);
  return true;
}

export function setStreetDoor(b: Building, x: number, y: number): boolean {
  const fl = floorByIndex(b, 0) ?? floorOf(b, 0);
  if (!inBounds(x, y, fl.w, fl.h)) return false;
  const onEdge = x === 0 || y === 0 || x === fl.w - 1 || y === fl.h - 1;
  if (!onEdge) return false;
  if (fl.door) {
    fl.tiles[tileIdx(fl.door.x, fl.door.y, fl.w)] = "wall";
  }
  fl.door = { x, y };
  fl.tiles[tileIdx(x, y, fl.w)] = "door";
  if (y === 0) b.doorSide = "n";
  else if (y === fl.h - 1) b.doorSide = "s";
  else if (x === 0) b.doorSide = "w";
  else b.doorSide = "e";
  rebuildFloorCaches(fl);
  return true;
}

export function setRoomRect(b: Building, floorIndex: number, rect: { x: number; y: number; w: number; h: number }, name: string, kind: string): Room | null {
  const fl = floorByIndex(b, floorIndex);
  if (!fl) return null;
  const x = Math.max(1, Math.min(rect.x, fl.w - 2));
  const y = Math.max(1, Math.min(rect.y, fl.h - 2));
  const w = Math.max(1, Math.min(rect.w, fl.w - 1 - x));
  const h = Math.max(1, Math.min(rect.h, fl.h - 1 - y));
  if (w < 1 || h < 1) return null;
  const room: Room = {
    id: `r${fl.index}_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name: name.trim() || kind,
    kind,
    x,
    y,
    w,
    h,
  };
  fl.rooms.push(room);
  return room;
}

export function renameRoom(b: Building, floorIndex: number, roomId: string, name: string, kind: string): boolean {
  const fl = floorByIndex(b, floorIndex);
  if (!fl) return false;
  const r = fl.rooms.find((r) => r.id === roomId);
  if (!r) return false;
  if (name.trim()) r.name = name.trim();
  if (kind.trim()) r.kind = kind.trim();
  return true;
}

export function deleteRoom(b: Building, floorIndex: number, roomId: string): boolean {
  const fl = floorByIndex(b, floorIndex);
  if (!fl) return false;
  const i = fl.rooms.findIndex((r) => r.id === roomId);
  if (i < 0) return false;
  fl.rooms.splice(i, 1);
  return true;
}

export interface FloorValidation {
  ok: boolean;
  closedRooms: string[];
  badStairs: { x: number; y: number }[];
}

/** Every floor needs a walkable path from its entry (street door on ground, stairs elsewhere) to each room. */
export function validateFloor(b: Building, floorIndex: number): FloorValidation {
  const fl = floorByIndex(b, floorIndex);
  if (!fl) return { ok: false, closedRooms: [], badStairs: [] };
  const entries: { x: number; y: number }[] = [];
  if (fl.index === 0 && fl.door) entries.push({ ...fl.door });
  for (const s of fl.stairs) entries.push({ x: s.x, y: s.y });
  const badStairs: { x: number; y: number }[] = [];
  for (const s of fl.stairs) {
    const other = floorByIndex(b, s.toFloor);
    if (!other) {
      badStairs.push({ x: s.x, y: s.y });
      continue;
    }
    if (!inBounds(s.toX, s.toY, other.w, other.h)) {
      badStairs.push({ x: s.x, y: s.y });
      continue;
    }
    const t = other.tiles[tileIdx(s.toX, s.toY, other.w)];
    if (!walkableTile(t)) badStairs.push({ x: s.x, y: s.y });
  }
  if (!entries.length) {
    return { ok: fl.rooms.length === 0 && badStairs.length === 0, closedRooms: fl.rooms.map((r) => r.id), badStairs };
  }
  const seen = new Uint8Array(fl.w * fl.h);
  const q: { x: number; y: number }[] = [];
  for (const e of entries) {
    if (!inBounds(e.x, e.y, fl.w, fl.h)) continue;
    const t = fl.tiles[tileIdx(e.x, e.y, fl.w)];
    if (!walkableTile(t)) continue;
    const k = tileIdx(e.x, e.y, fl.w);
    if (!seen[k]) {
      seen[k] = 1;
      q.push(e);
    }
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (q.length) {
    const c = q.pop()!;
    for (const [dx, dy] of dirs) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!inBounds(nx, ny, fl.w, fl.h)) continue;
      const k = tileIdx(nx, ny, fl.w);
      if (seen[k]) continue;
      if (!walkableTile(fl.tiles[k])) continue;
      seen[k] = 1;
      q.push({ x: nx, y: ny });
    }
  }
  const closedRooms: string[] = [];
  for (const r of fl.rooms) {
    let reach = false;
    for (let yy = r.y; yy < r.y + r.h && !reach; yy++) {
      for (let xx = r.x; xx < r.x + r.w && !reach; xx++) {
        if (!inBounds(xx, yy, fl.w, fl.h)) continue;
        if (seen[tileIdx(xx, yy, fl.w)]) reach = true;
      }
    }
    if (!reach) closedRooms.push(r.id);
  }
  return { ok: closedRooms.length === 0 && badStairs.length === 0, closedRooms, badStairs };
}

export function validateBuilding(b: Building): FloorValidation & { floor: number } {
  for (const f of b.floors) {
    const v = validateFloor(b, f.index);
    if (!v.ok) return { ...v, floor: f.index };
  }
  return { ok: true, closedRooms: [], badStairs: [], floor: 0 };
}

export function nearestWalkable(fl: Floor, x: number, y: number): { x: number; y: number } | null {
  if (inBounds(x, y, fl.w, fl.h) && walkableTile(fl.tiles[tileIdx(x, y, fl.w)])) return { x, y };
  const seen = new Set<string>([`${x},${y}`]);
  const q = [{ x, y }];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (q.length) {
    const c = q.shift()!;
    for (const [dx, dy] of dirs) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!inBounds(nx, ny, fl.w, fl.h)) continue;
      if (walkableTile(fl.tiles[tileIdx(nx, ny, fl.w)])) return { x: nx, y: ny };
      if (q.length < 400) q.push({ x: nx, y: ny });
    }
  }
  for (let yy = 0; yy < fl.h; yy++) {
    for (let xx = 0; xx < fl.w; xx++) {
      if (walkableTile(fl.tiles[tileIdx(xx, yy, fl.w)])) return { x: xx, y: yy };
    }
  }
  return null;
}

function blankFloor(w: number, h: number, index: number, name: string): Floor {
  const tiles: TileKind[] = Array.from({ length: w * h }, () => "floor");
  for (let x = 0; x < w; x++) {
    tiles[tileIdx(x, 0, w)] = "wall";
    tiles[tileIdx(x, h - 1, w)] = "wall";
  }
  for (let y = 0; y < h; y++) {
    tiles[tileIdx(0, y, w)] = "wall";
    tiles[tileIdx(w - 1, y, w)] = "wall";
  }
  return { index, name, w, h, tiles, rooms: [], stairs: [], beds: [], spots: [], furniture: [] };
}

function stairSpot(lower: Floor, upper: Floor): { x: number; y: number } | null {
  for (let y = 1; y < lower.h - 1; y++) {
    for (let x = 1; x < lower.w - 1; x++) {
      if (lower.tiles[tileIdx(x, y, lower.w)] !== "floor") continue;
      if (lower.door && Math.abs(x - lower.door.x) + Math.abs(y - lower.door.y) < 2) continue;
      const up = upper.tiles[tileIdx(x, y, upper.w)];
      if (up === "wall" || up === "window") continue;
      if (!walkableTile(up)) continue;
      return { x, y };
    }
  }
  return null;
}

function linkPair(lower: Floor, upper: Floor, at?: { x: number; y: number }): Stair | null {
  const s = at ?? stairSpot(lower, upper);
  if (!s) return null;
  lower.tiles[tileIdx(s.x, s.y, lower.w)] = "stairs";
  upper.tiles[tileIdx(s.x, s.y, upper.w)] = "stairs";
  const down: Stair = { x: s.x, y: s.y, toFloor: upper.index, toX: s.x, toY: s.y };
  const up: Stair = { x: s.x, y: s.y, toFloor: lower.index, toX: s.x, toY: s.y };
  lower.stairs.push(down);
  upper.stairs.push(up);
  rebuildFloorCaches(lower);
  rebuildFloorCaches(upper);
  return down;
}

export function addFloorAbove(b: Building): Floor | null {
  const top = b.floors.slice().sort((a, c) => a.index - c.index).at(-1);
  if (!top) return null;
  if (b.floors.some((f) => f.index === top.index + 1)) return null;
  const fl = blankFloor(top.w, top.h, top.index + 1, top.index + 1 === 1 ? "Upstairs" : `Storey ${top.index + 1}`);
  b.floors.push(fl);
  const at = stairSpot(top, fl);
  if (at) linkPair(top, fl, at);
  rebuildFloorCaches(top);
  rebuildFloorCaches(fl);
  return fl;
}

export function addBasement(b: Building): Floor | null {
  if (b.floors.some((f) => f.index === -1)) return null;
  const ground = floorByIndex(b, 0) ?? floorOf(b, 0);
  const fl = blankFloor(ground.w, ground.h, -1, "Cellar");
  b.floors.push(fl);
  b.floors.sort((a, c) => a.index - c.index);
  const at = stairSpot(fl, ground) ?? stairSpot(ground, fl);
  if (at) {
    // Stairs live on both floors at the same x/y.
    linkPair(fl, ground, at);
  }
  rebuildFloorCaches(fl);
  rebuildFloorCaches(ground);
  return fl;
}

export interface RemoveFloorResult {
  ok: boolean;
  reason?: string;
  moved?: number;
}

export function removeFloor(b: Building, index: number, opts?: { deletePair?: boolean }): RemoveFloorResult {
  if (index === 0) return { ok: false, reason: "Ground floor cannot be removed." };
  const i = b.floors.findIndex((f) => f.index === index);
  if (i < 0) return { ok: false, reason: "No such floor." };
  const paired = b.floors.filter((f) => f.stairs.some((s) => s.toFloor === index));
  if (paired.length && !opts?.deletePair) {
    return { ok: false, reason: "That floor holds stairs. Confirm to delete the paired stair." };
  }
  // Remove paired stairs pointing at this floor.
  for (const f of b.floors) {
    const before = f.stairs.length;
    f.stairs = f.stairs.filter((s) => s.toFloor !== index);
    if (f.stairs.length !== before) {
      // A stair tile with no remaining link back becomes plain floor.
      const kept = new Set(f.stairs.map((s) => tileIdx(s.x, s.y, f.w)));
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const ti = tileIdx(x, y, f.w);
          if (f.tiles[ti] === "stairs" && !kept.has(ti)) f.tiles[ti] = "floor";
        }
      }
      rebuildFloorCaches(f);
    }
  }
  b.floors.splice(i, 1);
  return { ok: true, moved: 0 };
}

export function placeFurniture(b: Building, floorIndex: number, x: number, y: number, kind: TileKind, ownerId?: string): string | null {
  const fl = floorByIndex(b, floorIndex);
  if (!fl) return null;
  if (!inBounds(x, y, fl.w, fl.h)) return null;
  if (!isFurnitureTile(kind)) return null;
  if (fl.door && fl.index === 0 && fl.door.x === x && fl.door.y === y) return null;
  fl.tiles[tileIdx(x, y, fl.w)] = kind;
  rebuildFloorCaches(fl);
  const item = fl.furniture.find((f) => f.x === x && f.y === y && f.kind === kind);
  if (!item) return null;
  if (ownerId) item.ownerId = ownerId;
  if (kind === "bed" && item.allowsTwo == null) item.allowsTwo = true;
  return item.id;
}

export function removeFurniture(b: Building, floorIndex: number, x: number, y: number): { ok: boolean; unassigned?: string[] } {  const fl = floorByIndex(b, floorIndex);
  if (!fl) return { ok: false };
  if (!inBounds(x, y, fl.w, fl.h)) return { ok: false };
  if (fl.door && fl.index === 0 && fl.door.x === x && fl.door.y === y) return { ok: false };
  const doomed = fl.furniture.filter((f) => f.x === x && f.y === y);
  const unassigned = doomed.map((d) => d.ownerId).filter((v): v is string => !!v);
  fl.tiles[tileIdx(x, y, fl.w)] = "floor";
  fl.stairs = fl.stairs.filter((s) => !(s.x === x && s.y === y));
  rebuildFloorCaches(fl);
  return { ok: true, unassigned };
}

export function assignBedOwner(b: Building, furnitureId: string, ownerId: string | null): boolean {
  for (const f of b.floors) {
    const item = (f.furniture ?? []).find((i) => i.id === furnitureId);
    if (item) {
      if (ownerId) item.ownerId = ownerId;
      else delete item.ownerId;
      return true;
    }
  }
  return false;
}

export function unassignSoulBeds(b: Building, soulId: string): number {
  let n = 0;
  for (const f of b.floors) {
    for (const item of f.furniture ?? []) {
      if (item.ownerId === soulId) {
        delete item.ownerId;
        n++;
      }
    }
    for (const r of f.rooms) {
      if (r.ownerId === soulId) delete r.ownerId;
      if (r.ownerIds?.includes(soulId)) r.ownerIds = r.ownerIds.filter((id) => id !== soulId);
    }
  }
  return n;
}

export function assignRoomOwner(b: Building, floorIndex: number, roomId: string, ownerId: string | null): boolean {
  const fl = floorByIndex(b, floorIndex);
  if (!fl) return false;
  const r = fl.rooms.find((r) => r.id === roomId);
  if (!r) return false;
  if (ownerId) r.ownerId = ownerId;
  else delete r.ownerId;
  return true;
}

export function claimFreeBed(b: Building, soulId: string): { x: number; y: number; floor: number; id: string } | null {
  for (const f of b.floors.slice().sort((a, c) => a.index - c.index)) {
    const free = (f.furniture ?? []).find((i) => i.kind === "bed" && !i.ownerId);
    if (free) {
      free.ownerId = soulId;
      return { x: free.x, y: free.y, floor: f.index, id: free.id };
    }
  }
  return null;
}

export function bedAssignmentOf(b: Building, soulId: string): { x: number; y: number; floor: number; id: string } | null {
  for (const f of b.floors) {
    const own = (f.furniture ?? []).find((i) => i.kind === "bed" && i.ownerId === soulId);
    if (own) return { x: own.x, y: own.y, floor: f.index, id: own.id };
  }
  return null;
}

/** Adopt legacy saves: every bed tile gets a furniture item. */
export function ensureFurniture(b: Building): void {
  for (const f of b.floors) {
    if (!Array.isArray(f.furniture)) f.furniture = [];
    rebuildFloorCaches(f);
  }
}

/** Link a stairs tile on one floor to another floor (same or paired x/y). Creates both directions. */
export function linkStairPair(b: Building, fromIndex: number, x: number, y: number, toIndex: number, toX?: number, toY?: number): boolean {
  const from = floorByIndex(b, fromIndex);
  const to = floorByIndex(b, toIndex);
  if (!from || !to) return false;
  if (!inBounds(x, y, from.w, from.h)) return false;
  const tx = toX ?? x;
  const ty = toY ?? y;
  if (!inBounds(tx, ty, to.w, to.h)) return false;
  from.tiles[tileIdx(x, y, from.w)] = "stairs";
  to.tiles[tileIdx(tx, ty, to.w)] = "stairs";
  from.stairs = from.stairs.filter((s) => !(s.x === x && s.y === y));
  to.stairs = to.stairs.filter((s) => !(s.x === tx && s.y === ty));
  from.stairs.push({ x, y, toFloor: toIndex, toX: tx, toY: ty });
  to.stairs.push({ x: tx, y: ty, toFloor: fromIndex, toX: x, toY: y });
  rebuildFloorCaches(from);
  rebuildFloorCaches(to);
  return true;
}

export { nextFurnitureId };
