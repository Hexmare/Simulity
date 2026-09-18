import { useEffect, useRef, type MutableRefObject, type PointerEvent } from "react";
import { followToward, panCam, screenToWorld, zoomToward, type Cam } from "@/sim/camera";
import { cityWalkable, interiorWalkable } from "@/sim/nav";
import { floorOf, stairAt, streetDoor } from "@/sim/interiors";
import type { AncestryMark, Building, Npc, TileKind } from "@/sim/types";
import type { World } from "@/sim/world";

export type { Cam };

const PAL = [
  "#c4b7a6",
  "#8ea07a",
  "#7a8fa3",
  "#b08978",
  "#9a8aa8",
  "#c9a66b",
  "#6e8b7a",
  "#b07070",
  "#8b9aa0",
  "#a3927a",
  "#d0c4a8",
  "#6d7c6a",
];

// Roof tint palettes chosen from the kind row's tags (data-driven — custom/overlay
// kinds get a palette via their own tag list). The index within the palette is
// Building.roof, which gen stamps from the kind row's `roof` preference.
const ROOF_BY_TAG: Record<string, string[]> = {
  worship: ["#5a5e58", "#4a4e48", "#6a6e68", "#50544e"],
  shop: ["#7a5a40", "#5c2f2c", "#8a6a4c", "#4a2826"],
  gather: ["#4d5348", "#3f4640", "#5a6058", "#454a44"],
  work: ["#4a4742", "#3c3a36", "#5a564e", "#42403c"],
  home: ["#6a4538", "#5a3a32", "#7a4e3c", "#4a3830"],
};
const ROOF_PRIORITY = ["worship", "shop", "gather", "work"];
function roofTints(tags: string[]): string[] {
  for (const t of ROOF_PRIORITY) if (tags.includes(t)) return ROOF_BY_TAG[t]!;
  return ROOF_BY_TAG.home!;
}

interface Props {
  world: World;
  camRef: MutableRefObject<Cam>;
  followRef: MutableRefObject<boolean>;
  walkModeRef: MutableRefObject<boolean>;
  onFollowChange: (v: boolean) => void;
  selectedId: string | null;
  hoverId: string | null;
  selectedBuildingId: string | null;
  keys: Set<string>;
  stick: MutableRefObject<{ active: boolean; dx: number; dy: number }>;
  onSelect: (id: string | null, buildingId?: string) => void;
  onHover: (id: string | null) => void;
}

type Gesture = {
  pointers: Map<number, { x: number; y: number }>;
  down: {
    id: number;
    button: number;
    sx: number;
    sy: number;
    t: number;
    hitSoul: string | null;
    hitBuilding: string | null;
    empty: boolean;
    pointerType: string;
  } | null;
  dragged: boolean;
  pinching: boolean;
  pinchDist: number;
  lastTap: { t: number; x: number; y: number } | null;
};

export function SimCanvas({
  world,
  camRef,
  followRef,
  walkModeRef,
  onFollowChange,
  selectedId,
  hoverId,
  selectedBuildingId,
  keys,
  stick,
  onSelect,
  onHover,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const selRef = useRef(selectedId);
  selRef.current = selectedId;
  const hoverRef = useRef(hoverId);
  hoverRef.current = hoverId;
  const bSelRef = useRef(selectedBuildingId);
  bSelRef.current = selectedBuildingId;
  const layerKeyRef = useRef("");
  const cityZRef = useRef(16);
  const interiorZRef = useRef(32);
  const gesture = useRef<Gesture>({
    pointers: new Map(),
    down: null,
    dragged: false,
    pinching: false,
    pinchDist: 0,
    lastTap: null,
  });
  const onFollowChangeRef = useRef(onFollowChange);
  onFollowChangeRef.current = onFollowChange;
  const unfollow = () => {
    if (!followRef.current) return;
    followRef.current = false;
    onFollowChangeRef.current(false);
  };
  const attachFollow = () => {
    followRef.current = true;
    onFollowChange(true);
    const p = world.player;
    camRef.current.x = p.px;
    camRef.current.y = p.py;
  };

  useEffect(() => {
    const canvas = ref.current;
    const parent = wrap.current;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = parent.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const raw = Math.min(0.05, (now - last) / 1000);
      last = now;
      let mx = 0;
      let my = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
      if (stick.current.active) world.movePlayer(stick.current.dx, stick.current.dy, raw);
      else if (mx !== 0 || my !== 0) world.movePlayer(mx, my, raw);
      else world.tickPlayerMove(raw);

      acc += raw * (world.paused ? 0 : Math.max(0, world.speed));
      const step = 0.25;
      let guard = 0;
      while (acc >= step && guard++ < 8) {
        world.step();
        acc -= step;
      }
      world.animate(raw * (world.paused ? 0 : Math.max(0, world.speed)));

      const p = world.player;
      const layerKey = `${p.loc.layer}:${p.loc.buildingId ?? ""}:${p.loc.floor ?? 0}`;
      const cam = camRef.current;
      if (layerKey !== layerKeyRef.current) {
        const wasCity = layerKeyRef.current.startsWith("city") || layerKeyRef.current === "";
        if (layerKeyRef.current) {
          if (wasCity) cityZRef.current = cam.z;
          else interiorZRef.current = cam.z;
        }
        layerKeyRef.current = layerKey;
        cam.x = p.px;
        cam.y = p.py;
        cam.z = p.loc.layer === "interior" ? interiorZRef.current : cityZRef.current;
      } else if (followRef.current) {
        followToward(cam, p.px, p.py);
      }

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      draw(ctx, world, cam, w, h, selRef.current, hoverRef.current, bSelRef.current, now);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [world, keys, camRef, followRef, stick]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomToward(camRef.current, e.clientX - r.left, e.clientY - r.top, r.width, r.height, factor);
      unfollow();
    };
    const onMenu = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onMenu);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onMenu);
    };
    // Re-attaching listeners every render (unfollow is recreated each render) is avoided on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camRef]);

  const localPos = (e: PointerEvent) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return { sx: 0, sy: 0, x: 0, y: 0, w: 1, h: 1 };
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const worldPt = screenToWorld(camRef.current, sx, sy, r.width, r.height);
    return { sx, sy, x: worldPt.x, y: worldPt.y, w: r.width, h: r.height };
  };

  const issueWalk = (x: number, y: number) => {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (world.player.loc.layer === "interior") {
      const b = world.building(world.player.loc.buildingId);
      if (!b) return;
      const fl = floorOf(b, world.player.loc.floor ?? 0);
      const door = streetDoor(b);
      if ((world.player.loc.floor ?? 0) === 0 && gx === door.x && gy === door.y) {
        if (world.interact()) return;
        world.pendingEnter = null;
        world.pendingStair = null;
        world.pendingExit = true;
        world.commandPlayerTo({
          layer: "interior",
          buildingId: b.id,
          floor: 0,
          x: door.x,
          y: door.y,
        });
        return;
      }
      const st = stairAt(fl, gx, gy);
      if (st) {
        if (world.nearStair(b) === st) {
          world.useStairs(b, st);
          return;
        }
        world.pendingEnter = null;
        world.pendingExit = false;
        world.pendingStair = st;
        world.commandPlayerTo({
          layer: "interior",
          buildingId: b.id,
          floor: world.player.loc.floor ?? 0,
          x: st.x,
          y: st.y,
        });
        return;
      }
      if (interiorWalkable(b, gx, gy, world.player.loc.floor ?? 0)) {
        const tile = fl.tiles[gy * fl.w + gx];
        world.pendingEnter = null;
        world.pendingExit = false;
        world.pendingStair = null;
        // Middle-click a counter: walk over, then buy a meal on arrival.
        world.pendingBuy = tile === "counter" ? { x: gx, y: gy, floor: world.player.loc.floor ?? 0 } : null;
        world.commandPlayerTo({
          layer: "interior",
          buildingId: b.id,
          floor: world.player.loc.floor ?? 0,
          x: gx,
          y: gy,
        });
      }
      return;
    }
    const b = pickBuilding(world, x, y);
    if (b) {
      world.approachBuilding(b.id);
      return;
    }
    const doorB = pickEntrance(world, x, y);
    if (doorB) {
      world.approachBuilding(doorB.id);
      return;
    }
    if (cityWalkable(world.map, gx, gy)) {
      world.pendingEnter = null;
      world.pendingExit = false;
      world.pendingStair = null;
      world.commandPlayerTo({ layer: "city", x: gx, y: gy });
    }
  };

  const issueSelect = (x: number, y: number) => {
    if (world.player.loc.layer === "interior") {
      const b = world.building(world.player.loc.buildingId);
      if (b) {
        const fl = floorOf(b, world.player.loc.floor ?? 0);
        const gx = Math.floor(x);
        const gy = Math.floor(y);
        const door = streetDoor(b);
        if ((world.player.loc.floor ?? 0) === 0 && gx === door.x && gy === door.y) {
          if (Math.hypot(world.player.px - (door.x + 0.5), world.player.py - (door.y + 0.5)) < 1.45) {
            world.exitBuilding();
            onSelect(null);
            return;
          }
          onSelect(null, b.id);
          return;
        }
        const st = stairAt(fl, gx, gy);
        if (st) {
          if (world.nearStair(b)) {
            world.useStairs(b, st);
            return;
          }
          onSelect(null, b.id);
          return;
        }
      }
      const hit = pickNpc(world, x, y);
      onSelect(hit?.id ?? null, hit ? undefined : world.player.loc.buildingId);
      return;
    }
    const hit = pickNpc(world, x, y);
    if (hit) {
      onSelect(hit.id);
      return;
    }
    const doorB = pickEntrance(world, x, y);
    if (doorB) {
      if (world.nearEntrance(doorB, 1.45)) {
        world.enterBuilding(doorB.id);
        onSelect(null, doorB.id);
        return;
      }
      onSelect(null, doorB.id);
      return;
    }
    const b = pickBuilding(world, x, y);
    if (b) {
      onSelect(null, b.id);
      return;
    }
    onSelect(null);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const pos = localPos(e);
    g.pointers.set(e.pointerId, { x: pos.sx, y: pos.sy });
    if (e.button === 2) {
      e.preventDefault();
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      if (!selRef.current && !bSelRef.current) {
        const soul = pickNpc(world, pos.x, pos.y);
        const b = world.player.loc.layer === "city" ? pickBuilding(world, pos.x, pos.y) : null;
        if (!soul && !b) {
          /* keep selection empty */
        }
      }
      issueWalk(pos.x, pos.y);
      return;
    }
    if (g.pointers.size === 2) {
      const pts = [...g.pointers.values()];
      g.pinching = true;
      g.dragged = true;
      g.pinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) || 1;
      g.down = null;
      unfollow();
      return;
    }
    const soul = pickNpc(world, pos.x, pos.y);
    const building =
      world.player.loc.layer === "city"
        ? (pickEntrance(world, pos.x, pos.y) ?? pickBuilding(world, pos.x, pos.y))
        : world.building(world.player.loc.buildingId);
    g.dragged = false;
    g.down = {
      id: e.pointerId,
      button: e.button,
      sx: pos.sx,
      sy: pos.sy,
      t: performance.now(),
      hitSoul: soul?.id ?? null,
      hitBuilding: building?.id ?? null,
      empty: !soul && world.player.loc.layer === "city" && !pickBuilding(world, pos.x, pos.y) && !pickEntrance(world, pos.x, pos.y),
      pointerType: e.pointerType,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const pos = localPos(e);
    if (g.pointers.has(e.pointerId)) g.pointers.set(e.pointerId, { x: pos.sx, y: pos.sy });
    const hit = pickNpc(world, pos.x, pos.y);
    onHover(hit?.id ?? null);
    if (wrap.current) {
      const b = world.player.loc.layer === "city" ? pickBuilding(world, pos.x, pos.y) : null;
      wrap.current.style.cursor = hit || b ? "pointer" : "crosshair";
    }
    if (g.pinching && g.pointers.size >= 2) {
      const pts = [...g.pointers.values()];
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) || 1;
      const midX = (pts[0]!.x + pts[1]!.x) / 2;
      const midY = (pts[0]!.y + pts[1]!.y) / 2;
      const r = wrap.current?.getBoundingClientRect();
      if (r && g.pinchDist > 0) {
        zoomToward(camRef.current, midX, midY, r.width, r.height, dist / g.pinchDist);
        g.pinchDist = dist;
        unfollow();
      }
      return;
    }
    const down = g.down;
    if (!down || down.id !== e.pointerId || down.button !== 0) return;
    const dx = pos.sx - down.sx;
    const dy = pos.sy - down.sy;
    const dist = Math.hypot(dx, dy);
    const threshold = down.pointerType === "touch" ? 10 : 8;
    const canPan = down.pointerType === "touch" || down.empty || dist > 16;
    if (!g.dragged && dist < threshold) return;
    if (!canPan && !g.dragged) return;
    g.dragged = true;
    panCam(camRef.current, e.movementX, e.movementY);
    unfollow();
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size < 2) g.pinching = false;
    const down = g.down;
    if (!down || down.id !== e.pointerId) return;
    g.down = null;
    if (down.button !== 0) return;
    if (g.dragged || g.pinching) return;
    const pos = localPos(e);
    const now = performance.now();
    const prev = g.lastTap;
    const isDouble = !!(prev && now - prev.t < 340 && Math.hypot(pos.sx - prev.x, pos.sy - prev.y) < 22);
    g.lastTap = { t: now, x: pos.sx, y: pos.sy };
    const soul = pickNpc(world, pos.x, pos.y);
    if (isDouble && soul?.kind === "pc") {
      attachFollow();
      return;
    }
    if (isDouble || (walkModeRef.current && !soul)) {
      issueWalk(pos.x, pos.y);
      return;
    }
    issueSelect(pos.x, pos.y);
  };

  return (
    <div
      ref={wrap}
      className="relative h-full min-h-0 w-full overflow-hidden bg-background"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={ref} className="block h-full w-full" />
    </div>
  );
}

function pickNpc(world: World, x: number, y: number): Npc | null {
  let best: Npc | null = null;
  let bestD = 0.55;
  const consider = (n: Npc, wx: number, wy: number) => {
    const d = Math.hypot(n.px - wx, n.py - wy);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  };
  if (world.player.loc.layer === "interior") {
    const bid = world.player.loc.buildingId;
    const floor = world.player.loc.floor ?? 0;
    consider(world.player, x, y);
    for (const n of world.occupants(bid!, floor)) consider(n, x, y);
    return best;
  }
  consider(world.player, x, y);
  for (const n of world.npcs) {
    if (n.loc.layer !== "city") continue;
    consider(n, x, y);
  }
  return best;
}

function pickBuilding(world: World, x: number, y: number) {
  return world.buildings.find((b) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h);
}

function pickEntrance(world: World, x: number, y: number) {
  const gx = Math.floor(x);
  const gy = Math.floor(y);
  return world.buildings.find((b) => b.entrance.x === gx && b.entrance.y === gy);
}

function draw(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Cam,
  w: number,
  h: number,
  selectedId: string | null,
  hoverId: string | null,
  selectedBuildingId: string | null,
  now: number,
) {
  ctx.clearRect(0, 0, w, h);
  const t = world.time();
  ctx.fillStyle = t.period === "night" ? "#1a2228" : t.period === "dusk" ? "#242018" : "#2a3326";
  ctx.fillRect(0, 0, w, h);

  if (world.player.loc.layer === "interior") {
    drawInterior(ctx, world, world.player.loc.buildingId!, cam, w, h, selectedId, hoverId, now);
    return;
  }

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  const tw = 1;
  const viewL = Math.floor(cam.x - w / 2 / cam.z) - 1;
  const viewT = Math.floor(cam.y - h / 2 / cam.z) - 1;
  const viewR = Math.ceil(cam.x + w / 2 / cam.z) + 1;
  const viewB = Math.ceil(cam.y + h / 2 / cam.z) + 1;

  for (let y = viewT; y < viewB; y++) {
    for (let x = viewL; x < viewR; x++) {
      if (x < 0 || y < 0 || x >= world.map.w || y >= world.map.h) continue;
      const kind = world.map.tiles[world.map.w * y + x] as TileKind;
      ctx.fillStyle = tileColor(kind, x, y);
      ctx.fillRect(x, y, tw, tw);
    }
  }

  const nearby = world.closestEntrance(1.15);
  for (const b of world.buildings) {
    drawBuilding(ctx, world, b, selectedId, b.id === selectedBuildingId || b.id === nearby?.id);
  }

  if (world.player.bb.path) {
    ctx.strokeStyle = "rgba(236,234,228,0.35)";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    const path = world.player.bb.path;
    ctx.moveTo(world.player.px, world.player.py);
    for (let i = world.player.bb.pathI; i < path.length; i++) {
      const wp = path[i]!;
      if (wp.layer !== "city") break;
      ctx.lineTo(wp.x + 0.5, wp.y + 0.5);
    }
    ctx.stroke();
  }

  for (const n of world.npcs) {
    if (n.loc.layer !== "city") continue;
    const anc = world.defs.ancestries[n.ancestryId];
    drawPerson(ctx, n, n.id === selectedId, n.id === hoverId, now, false, anc?.mark ?? "none", anc?.paletteBias ?? 0);
  }
  drawPerson(ctx, world.player, true, false, now, true, world.defs.ancestries[world.player.ancestryId]?.mark ?? "none");

  ctx.restore();

  if (t.period === "night") {
    ctx.fillStyle = "rgba(12, 18, 32, 0.38)";
    ctx.fillRect(0, 0, w, h);
  } else if (t.period === "dusk") {
    ctx.fillStyle = "rgba(40, 22, 14, 0.18)";
    ctx.fillRect(0, 0, w, h);
  } else if (t.period === "dawn") {
    ctx.fillStyle = "rgba(40, 28, 18, 0.1)";
    ctx.fillRect(0, 0, w, h);
  }
}

function drawBuilding(
  ctx: CanvasRenderingContext2D,
  world: World,
  b: Building,
  selectedId: string | null,
  lit: boolean,
) {
  const roofs = roofTints(world.defs.buildingKinds[b.kind]?.tags ?? []);
  ctx.fillStyle = roofs[b.roof % roofs.length]!;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  if (b.floors.length > 1) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(b.x, b.y, b.w, b.h * 0.38);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(b.x + b.w - 0.45, b.y - 0.35, 0.28, 0.45);
  }
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(b.x, b.y + b.h - 0.28, b.w, 0.28);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(b.x, b.y, b.w, 0.12);
  ctx.fillStyle = "rgba(160, 190, 200, 0.28)";
  if (b.doorSide !== "n") {
    ctx.fillRect(b.x + 0.35, b.y + 0.28, 0.32, 0.26);
    if (b.w > 3) ctx.fillRect(b.x + b.w - 0.7, b.y + 0.28, 0.32, 0.26);
  }
  if (b.doorSide !== "s" && b.h > 2) {
    ctx.fillRect(b.x + 0.35, b.y + b.h - 0.62, 0.32, 0.26);
    if (b.w > 3) ctx.fillRect(b.x + b.w - 0.7, b.y + b.h - 0.62, 0.32, 0.26);
  }
  if (lit) {
    ctx.strokeStyle = "#eceae4";
    ctx.lineWidth = 0.08;
    ctx.strokeRect(b.x + 0.06, b.y + 0.06, b.w - 0.12, b.h - 0.12);
  }
  ctx.fillStyle = lit ? "#eceae4" : "#d2c4a8";
  ctx.fillRect(b.entrance.x + 0.28, b.entrance.y + 0.28, 0.44, 0.44);
  ctx.fillStyle = lit ? "#eceae4" : "#c4b49a";
  if (b.doorSide === "s") ctx.fillRect(b.x + b.w / 2 - 0.28, b.y + b.h - 0.22, 0.56, 0.22);
  if (b.doorSide === "n") ctx.fillRect(b.x + b.w / 2 - 0.28, b.y, 0.56, 0.22);
  if (b.doorSide === "e") ctx.fillRect(b.x + b.w - 0.22, b.y + b.h / 2 - 0.28, 0.22, 0.56);
  if (b.doorSide === "w") ctx.fillRect(b.x, b.y + b.h / 2 - 0.28, 0.22, 0.56);
  void streetDoor(b);
  const inside = world.occupants(b.id);
  inside.forEach((n, i) => {
    const ox = b.x + 0.45 + (i % Math.max(1, b.w - 1)) * 0.55;
    const oy = b.y + 0.5 + Math.floor(i / Math.max(1, b.w - 1)) * 0.45;
    ctx.beginPath();
    ctx.arc(ox, oy, 0.22, 0, Math.PI * 2);
    ctx.fillStyle = PAL[n.palette % PAL.length]!;
    ctx.fill();
  });
  void selectedId;
}

function drawPerson(
  ctx: CanvasRenderingContext2D,
  n: Npc,
  sel: boolean,
  hover: boolean,
  now: number,
  isPc = false,
  mark: AncestryMark = "none",
  tint = 0,
) {
  const bob = Math.sin(now / 180 + n.px) * (n.speed > 0.2 ? 0.05 : 0);
  const x = n.px;
  const y = n.py + bob;
  if (sel || hover) {
    ctx.beginPath();
    ctx.arc(x, y, 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = isPc ? "#eceae4" : "#c5c8c1";
    ctx.lineWidth = 0.08;
    ctx.stroke();
  }
  if (mark === "halo") {
    ctx.beginPath();
    ctx.ellipse(x, y - 0.52, 0.24, 0.08, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(236, 234, 228, 0.85)";
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, isPc ? 0.38 : 0.32, 0, Math.PI * 2);
  ctx.fillStyle = isPc ? "#eceae4" : PAL[(((n.palette + tint) % PAL.length) + PAL.length) % PAL.length]!;
  ctx.fill();
  if (mark === "horns") {
    ctx.fillStyle = "#d8d2c4";
    ctx.fillRect(x - 0.3, y - 0.52, 0.1, 0.18);
    ctx.fillRect(x + 0.2, y - 0.52, 0.1, 0.18);
  }
  ctx.beginPath();
  ctx.arc(x, y - 0.22, 0.16, 0, Math.PI * 2);
  ctx.fillStyle = isPc ? "#1a1a18" : "rgba(20,20,18,0.55)";
  ctx.fill();
  if (mark === "fangs") {
    ctx.fillStyle = "#eceae4";
    ctx.fillRect(x - 0.07, y - 0.14, 0.05, 0.09);
    ctx.fillRect(x + 0.02, y - 0.14, 0.05, 0.09);
  }
  if (n.bb.control === "llm") {
    ctx.fillStyle = "#eceae4";
    ctx.fillRect(x - 0.08, y - 0.7, 0.16, 0.16);
  }
}

function drawInterior(
  ctx: CanvasRenderingContext2D,
  world: World,
  buildingId: string,
  cam: Cam,
  w: number,
  h: number,
  selectedId: string | null,
  hoverId: string | null,
  now: number,
) {
  const b = world.building(buildingId);
  if (!b) return;
  const fl = floorOf(b, world.player.loc.floor ?? 0);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  ctx.fillStyle = fl.index === 0 ? "#1a1814" : "#1c1612";
  ctx.fillRect(-4, -4, fl.w + 8, fl.h + 8);
  if (fl.index === 0 && fl.door) {
    ctx.fillStyle = "#6a6358";
    if (b.doorSide === "s") ctx.fillRect(0, fl.h, fl.w, 0.55);
    if (b.doorSide === "n") ctx.fillRect(0, -0.55, fl.w, 0.55);
    if (b.doorSide === "e") ctx.fillRect(fl.w, 0, 0.55, fl.h);
    if (b.doorSide === "w") ctx.fillRect(-0.55, 0, 0.55, fl.h);
  }
  for (let y = 0; y < fl.h; y++) {
    for (let x = 0; x < fl.w; x++) {
      const tile = fl.tiles[fl.w * y + x]!;
      ctx.fillStyle = interiorColor(tile);
      ctx.fillRect(x, y, 0.97, 0.97);
      drawProp(ctx, tile, x, y, 0.97);
    }
  }
  for (const item of fl.furniture ?? []) {
    if (item.kind === "bed" && item.ownerId) {
      ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
      ctx.fillRect(item.x + 0.72, item.y + 0.06, 0.2, 0.2);
    }
  }
  ctx.fillStyle = "rgba(236,234,228,0.38)";
  ctx.font = "0.38px 'Source Sans 3', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const r of fl.rooms) {
    ctx.fillText(r.name, r.x + r.w / 2, r.y + 0.45);
  }
  const pulse = 0.35 + 0.2 * Math.sin(now / 240);
  if (fl.door && fl.index === 0) {
    ctx.fillStyle = `rgba(197, 200, 193, ${pulse})`;
    ctx.fillRect(fl.door.x, fl.door.y, 0.97, 0.97);
  }
  for (const s of fl.stairs) {
    ctx.fillStyle = `rgba(196, 163, 90, ${0.4 + 0.2 * Math.sin(now / 200)})`;
    ctx.fillRect(s.x, s.y, 0.97, 0.97);
    ctx.fillStyle = "#eceae4";
    ctx.font = "0.32px 'Source Sans 3', sans-serif";
    ctx.fillText(s.toFloor > fl.index ? "up" : "down", s.x + 0.5, s.y + 0.5);
  }

  if (world.player.bb.path) {
    ctx.strokeStyle = "rgba(236,234,228,0.4)";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    const path = world.player.bb.path;
    ctx.moveTo(world.player.px, world.player.py);
    for (let i = world.player.bb.pathI; i < path.length; i++) {
      const wp = path[i]!;
      if (wp.layer !== "interior") break;
      ctx.lineTo(wp.x + 0.5, wp.y + 0.5);
    }
    ctx.stroke();
  }

  const floor = fl.index;
  for (const n of world.occupants(b.id, floor)) {
    const anc = world.defs.ancestries[n.ancestryId];
    drawPerson(ctx, n, n.id === selectedId, n.id === hoverId, now, false, anc?.mark ?? "none", anc?.paletteBias ?? 0);
  }
  if (world.player.loc.buildingId === b.id && (world.player.loc.floor ?? 0) === floor) {
    drawPerson(ctx, world.player, true, false, now, true, world.defs.ancestries[world.player.ancestryId]?.mark ?? "none");
  }
  ctx.restore();

  ctx.fillStyle = "rgba(236,234,228,0.55)";
  ctx.font = "12px 'Source Serif 4', serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const labelX = w / 2 + (0 - cam.x) * cam.z;
  const labelY = h / 2 + (0 - cam.y) * cam.z;
  ctx.fillText(fl.name, labelX, labelY - 8);
}

function tileColor(kind: TileKind, x: number, y: number) {
  const h = ((x * 17 + y * 31) & 7) / 7;
  if (kind === "road") return h > 0.6 ? "#9a9186" : "#8f877c";
  if (kind === "plaza") return h > 0.5 ? "#b0a898" : "#a69e8e";
  if (kind === "dirt") return "#7a6e5c";
  if (kind === "tree") return h > 0.5 ? "#3d5a38" : "#334e30";
  if (kind === "water") return "#3d5c68";
  if (kind === "door") return "#d2c4a8";
  return h > 0.5 ? "#4a5c42" : "#42563c";
}

function drawProp(ctx: CanvasRenderingContext2D, t: TileKind, x: number, y: number, s: number) {
  const p = s * 0.12;
  if (t === "bed") {
    ctx.fillStyle = "#6a4a40";
    ctx.fillRect(x + p, y + p * 2, s - p * 2, s - p * 3);
    ctx.fillStyle = "#d2c4a8";
    ctx.fillRect(x + p * 1.4, y + p * 2.4, s * 0.28, s * 0.42);
    return;
  }
  if (t === "table") {
    ctx.fillStyle = "#5a4638";
    ctx.fillRect(x + p * 1.5, y + p * 2, s - p * 3, s - p * 4);
    ctx.fillStyle = "#3a2e26";
    ctx.fillRect(x + p * 2, y + s - p * 3, p, p * 2);
    ctx.fillRect(x + s - p * 3, y + s - p * 3, p, p * 2);
    return;
  }
  if (t === "hearth") {
    ctx.fillStyle = "#4a2c28";
    ctx.fillRect(x + p, y + p, s - p * 2, s - p * 2);
    ctx.fillStyle = "#c47848";
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s * 0.55, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (t === "counter" || t === "shelf") {
    ctx.fillStyle = t === "shelf" ? "#3a342c" : "#4a4034";
    ctx.fillRect(x + p, y + s * 0.35, s - p * 2, s * 0.42);
    return;
  }
  if (t === "crate") {
    ctx.fillStyle = "#4a4034";
    ctx.strokeStyle = "#2a2420";
    ctx.lineWidth = 0.03;
    ctx.fillRect(x + p * 1.5, y + p * 1.5, s - p * 3, s - p * 3);
    ctx.strokeRect(x + p * 1.5, y + p * 1.5, s - p * 3, s - p * 3);
    return;
  }
  if (t === "rug") {
    ctx.fillStyle = "#5a3838";
    ctx.fillRect(x + p, y + p, s - p * 2, s - p * 2);
    return;
  }
  if (t === "pew") {
    ctx.fillStyle = "#3a342c";
    ctx.fillRect(x + p, y + s * 0.4, s - p * 2, s * 0.28);
    return;
  }
  if (t === "altar") {
    ctx.fillStyle = "#5a5e58";
    ctx.fillRect(x + p * 1.5, y + p * 2, s - p * 3, s - p * 4);
    return;
  }
  if (t === "anvil") {
    ctx.fillStyle = "#3a3c3a";
    ctx.fillRect(x + p * 2, y + s * 0.35, s - p * 4, s * 0.28);
    return;
  }
  if (t === "stairs") {
    ctx.fillStyle = "#6a5a48";
    ctx.fillRect(x + p, y + p, s - p * 2, s * 0.18);
    ctx.fillRect(x + p, y + s * 0.38, s - p * 2, s * 0.18);
    ctx.fillRect(x + p, y + s * 0.66, s - p * 2, s * 0.18);
  }
}

function interiorColor(t: TileKind) {
  if (t === "wall") return "#2a2622";
  if (t === "window") return "#3a4850";
  if (t === "door") return "#c5c8c1";
  if (t === "bed") return "#5a4038";
  if (t === "counter") return "#4a4036";
  if (t === "altar") return "#4a4e48";
  if (t === "stairs") return "#8a7348";
  if (t === "hearth") return "#6a3830";
  if (t === "table") return "#4a3c30";
  if (t === "rug") return "#4a3838";
  if (t === "crate") return "#4a4034";
  if (t === "shelf") return "#3e3830";
  if (t === "pew") return "#3a342c";
  if (t === "anvil") return "#3a3c40";
  return "#3a342e";
}
