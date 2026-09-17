import { floorOf, inward, streetDoor, walkableTile } from "./interiors";
import type { Building, Floor, Layer, Loc, MapGrid, TileKind, Waypoint } from "./types";
import { MAP_H, MAP_W } from "./types";

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export function idx(x: number, y: number, w = MAP_W) {
  return y * w + x;
}

export function inBounds(x: number, y: number, w = MAP_W, h = MAP_H) {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function cityWalkable(map: MapGrid, x: number, y: number) {
  if (!inBounds(x, y, map.w, map.h)) return false;
  return map.blocked[idx(x, y, map.w)] === 0;
}

export function interiorWalkable(b: Building, x: number, y: number, floor = 0) {
  const fl = floorOf(b, floor);
  if (!inBounds(x, y, fl.w, fl.h)) return false;
  return walkableTile(fl.tiles[idx(x, y, fl.w)]);
}

export function floorWalkable(fl: Floor, x: number, y: number) {
  if (!inBounds(x, y, fl.w, fl.h)) return false;
  return walkableTile(fl.tiles[idx(x, y, fl.w)]);
}

export function tileCost(kind: TileKind) {
  if (kind === "road" || kind === "plaza" || kind === "door") return 1;
  if (kind === "dirt") return 1.15;
  if (kind === "floor") return 1;
  return 1.45;
}

class MinHeap {
  a: { k: number; v: number }[] = [];
  push(k: number, v: number) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.k <= a[i]!.k) break;
      const t = a[p]!;
      a[p] = a[i]!;
      a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && a[l]!.k < a[s]!.k) s = l;
        if (r < a.length && a[r]!.k < a[s]!.k) s = r;
        if (s === i) break;
        const t = a[i]!;
        a[i] = a[s]!;
        a[s] = t;
        i = s;
      }
    }
    return top.v;
  }
  get size() {
    return this.a.length;
  }
}

function astar(
  w: number,
  h: number,
  walk: (x: number, y: number) => boolean,
  cost: (x: number, y: number) => number,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): { x: number; y: number }[] | null {
  if (!walk(sx, sy) || !walk(tx, ty)) return null;
  const start = sy * w + sx;
  const goal = ty * w + tx;
  if (start === goal) return [{ x: sx, y: sy }];
  const open = new MinHeap();
  const g = new Float32Array(w * h);
  g.fill(1e9);
  const came = new Int32Array(w * h);
  came.fill(-1);
  g[start] = 0;
  open.push(Math.abs(tx - sx) + Math.abs(ty - sy), start);
  const closed = new Uint8Array(w * h);
  while (open.size) {
    const cur = open.pop()!;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walk(nx, ny)) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = g[cur]! + cost(nx, ny);
      if (ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = cur;
        const f = ng + Math.abs(tx - nx) + Math.abs(ty - ny);
        open.push(f, ni);
      }
    }
  }
  if (came[goal] < 0 && start !== goal) return null;
  const path: { x: number; y: number }[] = [];
  let c = goal;
  while (c >= 0) {
    path.push({ x: c % w, y: (c / w) | 0 });
    if (c === start) break;
    c = came[c]!;
  }
  path.reverse();
  return path;
}

export function cityPath(map: MapGrid, sx: number, sy: number, tx: number, ty: number) {
  const p = astar(
    map.w,
    map.h,
    (x, y) => cityWalkable(map, x, y),
    (x, y) => tileCost(map.tiles[idx(x, y, map.w)]!),
    Math.round(sx),
    Math.round(sy),
    Math.round(tx),
    Math.round(ty),
  );
  return p;
}

export function interiorPath(b: Building, sx: number, sy: number, tx: number, ty: number, floor = 0) {
  const fl = floorOf(b, floor);
  return astar(
    fl.w,
    fl.h,
    (x, y) => floorWalkable(fl, x, y),
    () => 1,
    Math.round(sx),
    Math.round(sy),
    Math.round(tx),
    Math.round(ty),
  );
}

function tag(layer: Layer, pts: { x: number; y: number }[], buildingId?: string, floor?: number): Waypoint[] {
  return pts.map((p) => ({ layer, buildingId, floor, x: p.x, y: p.y }));
}

export function samePlace(a: Loc, b: Loc) {
  if (a.layer !== b.layer) return false;
  if ((a.buildingId ?? "") !== (b.buildingId ?? "")) return false;
  if ((a.floor ?? 0) !== (b.floor ?? 0)) return false;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 0.45;
}

function stairLink(b: Building, fromFloor: number, toFloor: number) {
  const fl = floorOf(b, fromFloor);
  return fl.stairs.find((s) => s.toFloor === toFloor) ?? fl.stairs.find((s) => Math.sign(s.toFloor - fromFloor) === Math.sign(toFloor - fromFloor)) ?? fl.stairs[0];
}

export function planRoute(
  map: MapGrid,
  buildings: Building[],
  from: Loc,
  to: Loc,
): Waypoint[] | null {
  const bById = (id?: string) => buildings.find((b) => b.id === id);

  if (from.layer === "interior" && to.layer === "interior" && from.buildingId === to.buildingId) {
    const b = bById(from.buildingId);
    if (!b) return null;
    return planInside(b, from, to);
  }

  const out: Waypoint[] = [];

  let cityFromX = from.x;
  let cityFromY = from.y;

  if (from.layer === "interior") {
    const b = bById(from.buildingId);
    if (!b) return null;
    const door = streetDoor(b);
    const toExit = planInside(b, from, { layer: "interior", buildingId: b.id, floor: 0, x: door.x, y: door.y });
    if (!toExit) return null;
    out.push(...toExit);
    out.push({ layer: "city", x: b.entrance.x, y: b.entrance.y });
    cityFromX = b.entrance.x;
    cityFromY = b.entrance.y;
  }

  let cityToX = to.x;
  let cityToY = to.y;
  let destB: Building | undefined;

  if (to.layer === "interior") {
    destB = bById(to.buildingId);
    if (!destB) return null;
    cityToX = destB.entrance.x;
    cityToY = destB.entrance.y;
  }

  const road = cityPath(map, cityFromX, cityFromY, cityToX, cityToY);
  if (!road) return null;
  out.push(...tag("city", road));

  if (destB && to.layer === "interior") {
    const door = streetDoor(destB);
    out.push({
      layer: "interior",
      buildingId: destB.id,
      floor: 0,
      x: door.x,
      y: door.y,
    });
    const inn = planInside(destB, { layer: "interior", buildingId: destB.id, floor: 0, x: door.x, y: door.y }, to);
    if (!inn) return null;
    out.push(...inn);
  }

  return simplify(out);
}

function planInside(b: Building, from: Loc, to: Loc): Waypoint[] | null {
  const fi = from.floor ?? 0;
  const ti = to.floor ?? 0;
  if (fi === ti) {
    const p = interiorPath(b, from.x, from.y, to.x, to.y, fi);
    return p ? tag("interior", p, b.id, fi) : null;
  }
  // Walk the stair chain one floor at a time (supports cellars at -1 and lofts above).
  const order = b.floors.map((f) => f.index).sort((a, c) => a - c);
  if (!order.includes(fi) || !order.includes(ti)) return null;
  const step = ti > fi ? 1 : -1;
  const chain: number[] = [];
  let cur = fi;
  let guard = 0;
  while (cur !== ti && guard++ < 12) {
    const next = order.includes(cur + step) ? cur + step : step > 0 ? order.find((v) => v > cur) : [...order].reverse().find((v) => v < cur);
    if (next == null) return null;
    chain.push(next);
    cur = next;
  }
  if (cur !== ti) return null;
  const out: Waypoint[] = [];
  let px = from.x;
  let py = from.y;
  let floor = fi;
  for (const next of chain) {
    const link = stairLink(b, floor, next);
    if (!link) return null;
    const a = interiorPath(b, px, py, link.x, link.y, floor);
    if (!a) return null;
    out.push(...tag("interior", a, b.id, floor));
    out.push({ layer: "interior", buildingId: b.id, floor: next, x: link.toX, y: link.toY });
    px = link.toX;
    py = link.toY;
    floor = next;
  }
  const bth = interiorPath(b, px, py, to.x, to.y, ti);
  if (!bth) return null;
  // Drop the duplicated stair-arrival waypoint (already emitted as the floor-change hop).
  const tail = bth.length && bth[0]!.x === px && bth[0]!.y === py ? bth.slice(1) : bth;
  out.push(...tag("interior", tail, b.id, ti));
  return out;
}

function simplify(path: Waypoint[]) {
  if (path.length < 3) return path;
  const r: Waypoint[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const a = r[r.length - 1]!;
    const b = path[i]!;
    const c = path[i + 1]!;
    const sameLayer =
      a.layer === b.layer &&
      b.layer === c.layer &&
      a.buildingId === b.buildingId &&
      b.buildingId === c.buildingId &&
      (a.floor ?? 0) === (b.floor ?? 0) &&
      (b.floor ?? 0) === (c.floor ?? 0);
    const colinear = sameLayer && ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y));
    if (!colinear) r.push(b);
  }
  r.push(path[path.length - 1]!);
  return r;
}

export function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function locKey(l: Loc) {
  return `${l.layer}:${l.buildingId ?? ""}:${l.floor ?? 0}:${Math.round(l.x)}:${Math.round(l.y)}`;
}

export function entranceOf(b: Building): Loc {
  return { layer: "city", x: b.entrance.x, y: b.entrance.y };
}

export function doorOf(b: Building): Loc {
  const d = streetDoor(b);
  return { layer: "interior", buildingId: b.id, floor: 0, x: d.x, y: d.y };
}

export function insideOf(b: Building): Loc {
  const d = streetDoor(b);
  const p = inward(d, b.doorSide);
  if (interiorWalkable(b, p.x, p.y, 0)) {
    return { layer: "interior", buildingId: b.id, floor: 0, x: p.x, y: p.y };
  }
  return { layer: "interior", buildingId: b.id, floor: 0, x: d.x, y: d.y };
}

export function streetNudge(b: Building): { x: number; y: number } {
  return { x: b.entrance.x + 0.5, y: b.entrance.y + 0.5 };
}

/** A walkable street tile beside the door — not the doorstep itself. */
export function streetStand(map: MapGrid, buildings: Building[], b: Building): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  const opts: { x: number; y: number; away: number }[] = [];
  for (const [dx, dy] of dirs) {
    const x = b.entrance.x + dx;
    const y = b.entrance.y + dy;
    if (!cityWalkable(map, x, y)) continue;
    const onFootprint = buildings.some((o) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
    if (onFootprint) continue;
    opts.push({ x, y, away: Math.hypot(x + 0.5 - cx, y + 0.5 - cy) });
  }
  opts.sort((a, c) => c.away - a.away);
  const pick = opts[0];
  if (pick) return { x: pick.x + 0.5, y: pick.y + 0.5 };
  return streetNudge(b);
}

export function locFromBody(loc: Loc, px: number, py: number): Loc {
  return {
    layer: loc.layer,
    buildingId: loc.buildingId,
    floor: loc.floor,
    x: Math.floor(px),
    y: Math.floor(py),
  };
}

export function trimLeadingWaypoints(path: Waypoint[], px: number, py: number, loc: Loc): Waypoint[] {
  if (path.length <= 1) return path;
  const hereX = Math.floor(px);
  const hereY = Math.floor(py);
  const onLayer = (wp: Waypoint) =>
    wp.layer === loc.layer &&
    (wp.buildingId ?? "") === (loc.buildingId ?? "") &&
    (wp.floor ?? 0) === (loc.floor ?? 0);
  let i = 0;
  while (i < path.length - 1 && onLayer(path[i]!) && path[i]!.x === hereX && path[i]!.y === hereY) {
    i++;
  }
  if (i < path.length - 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (onLayer(a) && a.layer === b.layer && (a.floor ?? 0) === (b.floor ?? 0)) {
      const toAx = a.x + 0.5 - px;
      const toAy = a.y + 0.5 - py;
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      if (toAx * abx + toAy * aby < -0.02) i++;
    }
  }
  return i === 0 ? path : path.slice(i);
}


