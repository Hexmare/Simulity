import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FURNITURE_CATALOG } from "@/sim/interiors";
import type { Room, TileKind } from "@/sim/types";
import type { World } from "@/sim/world";
import { cn } from "@/lib/utils";

type StructTool = "wall" | "floor" | "door" | "window" | "stairs" | "erase";
type Tool = StructTool | { furniture: TileKind } | { room: true };

const STRUCT_TOOLS: { id: StructTool; label: string }[] = [
  { id: "wall", label: "Wall" },
  { id: "floor", label: "Floor" },
  { id: "door", label: "Door" },
  { id: "window", label: "Window" },
  { id: "stairs", label: "Stairs" },
  { id: "erase", label: "Erase" },
];

const ROOM_KINDS = [
  "bedroom",
  "kitchen",
  "taproom",
  "shop",
  "sanctuary",
  "workshop",
  "mill",
  "hall",
  "office",
  "bunk",
  "cellar",
  "loft",
  "parlour",
  "snug",
];

function toolKey(t: Tool): string {
  return typeof t === "string" ? t : "furniture" in t ? `f:${t.furniture}` : "room";
}

function tileClass(t: TileKind): string {
  switch (t) {
    case "wall":
      return "bg-stone-700";
    case "window":
      return "bg-sky-800";
    case "door":
      return "bg-amber-100";
    case "bed":
      return "bg-rose-900";
    case "stairs":
      return "bg-amber-600";
    case "hearth":
      return "bg-orange-900";
    case "table":
      return "bg-amber-900";
    case "counter":
    case "shelf":
    case "crate":
      return "bg-stone-600";
    case "rug":
      return "bg-red-900";
    case "altar":
    case "pew":
    case "anvil":
      return "bg-stone-500";
    default:
      return "bg-stone-800";
  }
}

export function PlanEditor({ world, buildingId, onMutate }: { world: World; buildingId: string; onMutate: () => void }) {
  const b = world.building(buildingId);
  // world.tickIndex intentionally refreshes the floor list every tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const floors = useMemo(() => (b ? b.floors.slice().sort((x, y) => x.index - y.index) : []), [b, world.tickIndex]);
  const [floorIndex, setFloorIndex] = useState<number>(() => {
    if (b && world.player.loc.buildingId === b.id) return world.player.loc.floor ?? 0;
    return 0;
  });
  const [tool, setTool] = useState<Tool>("wall");
  const [msg, setMsg] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("Bedroom");
  const [roomKind, setRoomKind] = useState("bedroom");
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [sel, setSel] = useState<{ x: number; y: number } | null>(null);
  const [confirmFloor, setConfirmFloor] = useState<number | null>(null);

  if (!b) return null;
  const fl = floors.find((f) => f.index === floorIndex) ?? floors.find((f) => f.index === 0) ?? floors[0];
  if (!fl) return <p className="text-sm text-muted">No floors.</p>;
  const activeFloor = fl.index;

  const residents = [world.player, ...world.npcs].filter((n) => n.bb.homeId === b.id);
  const beds = (fl.furniture ?? []).filter((i) => i.kind === "bed");
  const below = floors.find((f) => f.index === activeFloor - 1);
  void below;
  const hasStairs = (idx: number) => (b.floors.find((f) => f.index === idx)?.stairs.length ?? 0) > 0;

  const snapshot = () => JSON.stringify(b.floors.map((f) => ({ tiles: f.tiles, stairs: f.stairs, furniture: f.furniture, door: f.door, rooms: f.rooms })));
  const restore = (raw: string) => {
    const arr = JSON.parse(raw) as { tiles: TileKind[]; stairs: typeof fl.stairs; furniture: typeof fl.furniture; door?: { x: number; y: number }; rooms: Room[] }[];
    b.floors.forEach((f, i) => {
      const s = arr[i];
      if (!s) return;
      f.tiles = s.tiles;
      f.stairs = s.stairs;
      f.furniture = s.furniture;
      f.door = s.door;
      f.rooms = s.rooms;
    });
    // Rebuild derived caches.
    for (const f of b.floors) {
      f.beds = [];
      f.spots = [];
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const t = f.tiles[y * f.w + x]!;
          if (t === "bed") f.beds.push({ x, y });
          if (t === "floor" || t === "rug" || t === "door") f.spots.push({ x, y });
        }
      }
    }
  };

  const afterEdit = (prev: string, what: string) => {
    const v = world.validateWholeBuilding(b.id);
    if (!v.ok) {
      restore(prev);
      const roomNames = v.closedRooms
        .map((id) => {
          for (const f of b.floors) {
            const r = f.rooms.find((r) => r.id === id);
            if (r) return r.name;
          }
          return id;
        })
        .join(", ");
      setMsg(`Refused ${what} — it would cut off ${roomNames || "a room"}${v.badStairs.length ? " (bad stairs)" : ""}. Add a door first.`);
      onMutate();
      return false;
    }
    setMsg(null);
    onMutate();
    return true;
  };

  const onTile = (x: number, y: number) => {
    setSel({ x, y });
    if (typeof tool === "object" && "room" in tool) {
      if (!anchor) {
        setAnchor({ x, y });
        setMsg("Corner set — tap the opposite corner.");
        return;
      }
      const rx = Math.max(1, Math.min(anchor.x, x));
      const ry = Math.max(1, Math.min(anchor.y, y));
      const rw = Math.min(fl.w - 1 - rx, Math.abs(x - anchor.x) + 1);
      const rh = Math.min(fl.h - 1 - ry, Math.abs(y - anchor.y) + 1);
      const prev = snapshot();
      const room = world.addRoomRect(b.id, activeFloor, { x: rx, y: ry, w: rw, h: rh }, roomName, roomKind);
      setAnchor(null);
      if (!room) {
        setMsg("That rect does not fit.");
        return;
      }
      if (!afterEdit(prev, "room")) return;
      setMsg(`Room “${room.name}” drawn.`);
      return;
    }
    if (typeof tool === "object" && "furniture" in tool) {
      const prev = snapshot();
      const id = world.placeFurniture(b.id, activeFloor, x, y, tool.furniture);
      if (!id) {
        setMsg("Cannot place that there (street door is fixed).");
        return;
      }
      afterEdit(prev, "furniture");
      return;
    }
    const t = tool as StructTool;
    const prev = snapshot();
    if (t === "door") {
      if (activeFloor !== 0) {
        setMsg("Only the ground floor has a street door — paint interior doors with the Wall tool gaps… use Floor to open, Door is for the street wall.");
      }
      const ok = world.setBuildingStreetDoor(b.id, x, y);
      if (!ok) {
        setMsg("Street door must sit on the outer wall.");
        return;
      }
      setMsg(`Street door moved — the road side is now ${b.doorSide}.`);
      onMutate();
      return;
    }
    if (t === "erase") {
      const cur = fl.tiles[y * fl.w + x]!;
      if (cur === "bed" || cur === "table" || cur === "counter" || cur === "shelf" || cur === "crate" || cur === "rug" || cur === "hearth" || cur === "altar" || cur === "pew" || cur === "anvil") {
        const res = world.removeFurnitureAt(b.id, activeFloor, x, y);
        if (!res.ok) {
          setMsg("Cannot erase that tile.");
          return;
        }
        if (res.unassigned?.length) {
          const names = res.unassigned.map((id) => world.npc(id)?.name ?? id).join(", ");
          setMsg(`Removed — ${names} ${res.unassigned.length > 1 ? "are" : "is"} unassigned.`);
        } else setMsg(null);
        afterEdit(prev, "erase");
        return;
      }
      const ok = world.paintFloorTile(b.id, activeFloor, x, y, "erase");
      if (!ok) {
        setMsg("Cannot erase the street door — move it first.");
        return;
      }
      afterEdit(prev, "erase");
      return;
    }
    const tile: TileKind = t === "wall" ? "wall" : t === "floor" ? "floor" : t === "window" ? "window" : "stairs";
    const ok = world.paintFloorTile(b.id, activeFloor, x, y, tile);
    if (!ok) {
      setMsg("Cannot paint the street door — move it first.");
      return;
    }
    if (tile === "stairs") {
      setMsg("Stairs painted — link them with “Link ↑/↓” below.");
      onMutate();
      return;
    }
    afterEdit(prev, t);
  };

  const link = (dir: 1 | -1) => {
    if (!sel) {
      setMsg("Tap a stairs tile first, then Link.");
      return;
    }
    const ok = world.linkStairs(b.id, activeFloor, sel.x, sel.y, activeFloor + dir);
    if (!ok) {
      setMsg(dir > 0 ? "No floor above to link to — add one first." : "No cellar below — dig one first.");
      return;
    }
    const v = world.validateWholeBuilding(b.id);
    setMsg(v.ok ? `Stairs linked ${dir > 0 ? "up" : "down"}.` : `Linked, but something is cut off: ${v.closedRooms.join(", ")}`);
    onMutate();
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1">
        {floors.map((f) => (
          <button
            key={f.index}
            type="button"
            className={cn("h-10 rounded-sm px-2 text-xs", f.index === activeFloor ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
            onClick={() => {
              setFloorIndex(f.index);
              setAnchor(null);
              setSel(null);
              setMsg(null);
            }}
          >
            {f.name} ({f.index})
          </button>
        ))}
        <button
          type="button"
          className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card-2 hover:text-foreground"
          onClick={() => {
            const f = world.addFloorAbove(b.id);
            if (f) {
              setFloorIndex(f.index);
              setMsg(`Storey added — ${f.name}.`);
            } else setMsg("Could not add a storey.");
            onMutate();
          }}
        >
          + Storey
        </button>
        {!floors.some((f) => f.index === -1) && (
          <button
            type="button"
            className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card-2 hover:text-foreground"
            onClick={() => {
              const f = world.addBasement(b.id);
              if (f) {
                setFloorIndex(-1);
                setMsg("Cellar dug — link stairs down.");
              } else setMsg("Could not dig a cellar.");
              onMutate();
            }}
          >
            + Cellar
          </button>
        )}
        {activeFloor !== 0 && (
          <button
            type="button"
            className="h-10 rounded-sm px-2 text-xs text-danger hover:bg-card-2"
            onClick={() => {
              if (confirmFloor !== activeFloor && hasStairs(activeFloor)) {
                setConfirmFloor(activeFloor);
                setMsg("That floor holds stairs — tap Remove again to delete the paired stair too.");
                return;
              }
              setConfirmFloor(null);
              const res = world.removeFloor(b.id, activeFloor, { deletePair: true });
              if (!res.ok) {
                setMsg(res.reason ?? "Could not remove that floor.");
                return;
              }
              setFloorIndex(0);
              setMsg(`Floor removed${res.moved ? ` — ${res.moved} inside moved to ground` : ""}.`);
              onMutate();
            }}
          >
            {confirmFloor === activeFloor ? "Confirm remove" : "Remove floor"}
          </button>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs text-muted">Structure</p>
        <div className="flex flex-wrap gap-1">
          {STRUCT_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={cn("h-10 rounded-sm px-2 text-xs", toolKey(tool) === t.id ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
              onClick={() => {
                setTool(t.id);
                setMsg(null);
              }}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            className={cn("h-10 rounded-sm px-2 text-xs", toolKey(tool) === "room" ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
            onClick={() => {
              setTool({ room: true });
              setAnchor(null);
              setMsg("Tap two opposite corners on the grid.");
            }}
          >
            Room
          </button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted">Furniture</p>
        <div className="flex flex-wrap gap-1">
          {FURNITURE_CATALOG.map((f) => (
            <button
              key={f.id}
              type="button"
              className={cn("h-10 rounded-sm px-2 text-xs", toolKey(tool) === `f:${f.tile}` ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
              onClick={() => {
                setTool({ furniture: f.tile });
                setMsg(null);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {typeof tool === "object" && "room" in tool && (
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-muted">
            Room name
            <Input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={32} />
          </label>
          <label className="grid gap-1 text-xs text-muted">
            Kind
            <select
              className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
              value={roomKind}
              onChange={(e) => {
                setRoomKind(e.target.value);
                setRoomName((n) => n);
              }}
            >
              {ROOM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div
        className="grid gap-[2px] overflow-auto rounded-md bg-card-2 p-2"
        style={{ gridTemplateColumns: `repeat(${fl.w}, minmax(22px, 1fr))` }}
      >
        {fl.tiles.map((t, i) => {
          const x = i % fl.w;
          const y = Math.floor(i / fl.w);
          const isDoor = fl.door?.x === x && fl.door?.y === y && fl.index === 0;
          const isSel = sel?.x === x && sel?.y === y;
          const owned = (fl.furniture ?? []).find((f) => f.x === x && f.y === y && f.ownerId);
          return (
            <button
              key={i}
              type="button"
              title={`${x},${y} ${t}${owned ? ` — ${world.npc(owned.ownerId!)?.name ?? "claimed"}` : ""}`}
              aria-label={`tile ${x},${y} ${t}`}
              className={cn("relative aspect-square min-h-[22px] rounded-[2px]", tileClass(t), isSel && "outline outline-2 outline-accent")}
              onClick={() => onTile(x, y)}
            >
              {isDoor && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-amber-900">D</span>}
              {t === "stairs" && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white">⇅</span>}
              {owned && <span className="absolute right-[2px] top-[2px] size-1.5 rounded-full bg-emerald-400" />}
            </button>
          );
        })}
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
      {anchor && (
        <p className="text-xs text-muted">
          Room from {anchor.x},{anchor.y}… tap the opposite corner.
        </p>
      )}

      <div className="flex gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => link(1)}>
          Link ↑
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => link(-1)}>
          Link ↓
        </Button>
      </div>

      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Rooms on {fl.name}</p>
        {fl.rooms.length === 0 && <p className="text-xs text-muted">No rooms drawn yet.</p>}
        {fl.rooms.map((r) => (
          <RoomRow key={r.id} world={world} buildingId={b.id} floorIndex={activeFloor} room={r} residents={residents.map((n) => ({ id: n.id, name: n.name }))} onMutate={onMutate} />
        ))}
      </div>

      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Beds on {fl.name}</p>
        {beds.length === 0 && <p className="text-xs text-muted">No beds here — place one from the furniture row.</p>}
        {beds.map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-sm">
            <span className="text-muted">
              Bed {item.x},{item.y}
            </span>
            <select
              className="h-11 flex-1 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
              value={item.ownerId ?? ""}
              onChange={(e) => {
                world.assignBed(b.id, item.id, e.target.value || null);
                onMutate();
              }}
            >
              <option value="">Unclaimed</option>
              {residents.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomRow({
  world,
  buildingId,
  floorIndex,
  room,
  residents,
  onMutate,
}: {
  world: World;
  buildingId: string;
  floorIndex: number;
  room: Room;
  residents: { id: string; name: string }[];
  onMutate: () => void;
}) {
  const [name, setName] = useState(room.name);
  return (
    <div className="grid gap-1 rounded-md bg-card-2 p-2 text-sm">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          maxLength={32}
          onChange={(e) => {
            setName(e.target.value);
            world.renameRoom(buildingId, floorIndex, room.id, e.target.value, room.kind);
            onMutate();
          }}
        />
        <span className="shrink-0 text-xs text-muted">
          {room.kind} · {room.w}×{room.h}
        </span>
        <button
          type="button"
          className="h-10 shrink-0 rounded-sm px-2 text-xs text-danger hover:bg-card"
          onClick={() => {
            world.deleteRoom(buildingId, floorIndex, room.id);
            onMutate();
          }}
        >
          Delete
        </button>
      </div>
      <select
        className="h-11 rounded-md bg-card px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
        value={room.ownerId ?? ""}
        onChange={(e) => {
          world.assignRoom(buildingId, floorIndex, room.id, e.target.value || null);
          onMutate();
        }}
      >
        <option value="">Bedroom unassigned</option>
        {residents.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
    </div>
  );
}
