import { Pause, Play, PanelRight, LocateFixed, Footprints } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Inspector } from "@/components/game/Inspector";
import { Roleplay } from "@/components/game/Roleplay";
import { SimCanvas, type Cam } from "@/components/game/SimCanvas";
import { StartScreen } from "@/components/game/StartScreen";
import { Button } from "@/components/ui/button";
import { ZOOM_CITY } from "@/sim/camera";
import {
  createTown,
  deleteTown,
  duplicateTown,
  exportTown,
  importTown,
  lastTownId,
  listTowns,
  loadTown,
  putTown,
  renameTown,
  type TownMeta,
} from "@/sim/persist";
import { World } from "@/sim/world";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getX: () => number;
      getY: () => number;
      getLayer: () => string;
      getFloor: () => number;
      getBuildingId: () => string | null;
      interact: () => boolean;
      enterBuilding: (id: string) => void;
      commandTo: (x: number, y: number) => boolean;
      getCam: () => { x: number; y: number; z: number; follow: boolean; walkMode: boolean };
      setFollow: (v: boolean) => void;
      setWalkMode: (v: boolean) => void;
      setKeys: (codes: string[]) => void;
    };
    __sim?: {
      world: () => World | null;
      npcCount: () => number;
      events: () => number;
      buildings: () => { id: string; name: string; kind: string; doorSide: string; floors: number; rooms: number }[];
      talk: (id: string) => boolean;
      save: () => boolean;
      towns: () => TownMeta[];
      townId: () => string | null;
      townName: () => string | null;
      addVillager: (opts?: { name?: string; jobId?: string }) => string | null;
      addHouse: (kind?: string, name?: string) => string | null;
      select: (id: string) => boolean;
    };
  }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SimulityApp() {
  const [phase, setPhase] = useState<"start" | "play">("start");
  const worldRef = useRef<World | null>(null);
  const keysRef = useRef(new Set<string>());
  const [keys] = useState(() => keysRef.current);
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [talkId, setTalkId] = useState<string | null>(null);
  const talkRef = useRef<string | null>(null);
  talkRef.current = talkId;
  const [panel, setPanel] = useState(true);
  const camRef = useRef<Cam>({ x: 28, y: 28, z: ZOOM_CITY });
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  const [walkMode, setWalkMode] = useState(false);
  const walkModeRef = useRef(false);
  walkModeRef.current = walkMode;
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const stick = useRef({ active: false, dx: 0, dy: 0 });
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const bootingRef = useRef(false);
  const [towns, setTowns] = useState<TownMeta[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refreshTowns = useCallback(() => {
    try {
      setTowns(listTowns());
      setLastId(lastTownId());
    } catch {
      setTowns([]);
      setLastId(null);
    }
  }, []);

  const flushSave = useCallback(() => {
    const w = worldRef.current;
    if (!w) return false;
    try {
      putTown(w);
      setSavedAt(Date.now());
      setSaveError(null);
      return true;
    } catch {
      setSaveError("Storage is full — export a copy.");
      return false;
    }
  }, []);

  const bootWorld = useCallback((factory: () => World | null, fail = "That borough could not be found.") => {
    if (bootingRef.current) return;
    bootingRef.current = true;
    setBooting(true);
    setBootError(null);
    const run = () => {
      try {
        const w = factory();
        if (!w) throw new Error(fail);
        worldRef.current = w;
        w.speed = 1;
        w.paused = false;
        camRef.current = { x: w.player.px, y: w.player.py, z: ZOOM_CITY };
        followRef.current = true;
        setFollow(true);
        setWalkMode(false);
        setPaused(false);
        setSpeed(1);
        setSelectedId(null);
        setSelectedBuildingId(null);
        setTalkId(null);
        setPanel(true);
        setSaveError(null);
        setSavedAt(Date.now());
        setPhase("play");
        setVersion((v) => v + 1);
      } catch (err) {
        console.error(err);
        worldRef.current = null;
        setPhase("start");
        setBootError(err instanceof Error ? err.message : "Simulity failed to wake.");
        refreshTowns();
      } finally {
        bootingRef.current = false;
        setBooting(false);
      }
    };
    requestAnimationFrame(run);
  }, [refreshTowns]);

  const leave = useCallback(() => {
    flushSave();
    worldRef.current = null;
    setTalkId(null);
    setSelectedId(null);
    setSelectedBuildingId(null);
    setPhase("start");
    refreshTowns();
  }, [flushSave, refreshTowns]);

  const onMutate = useCallback(() => {
    const w = worldRef.current;
    if (w) {
      setSelectedId((id) => (id && !w.npc(id) ? null : id));
      setSelectedBuildingId((id) => (id && !w.building(id) ? null : id));
    }
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    refreshTowns();
    void navigator.storage?.persist?.();
  }, [refreshTowns]);

  useEffect(() => {
    if (phase !== "start") return;
    refreshTowns();
  }, [phase, refreshTowns]);

  useEffect(() => {
    if (phase !== "play") return;
    const tick = () => {
      flushSave();
    };
    const id = window.setInterval(tick, 8000);
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", tick);
    };
  }, [phase, flushSave]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const active = document.activeElement as HTMLElement | null;
      const field = (el: HTMLElement | null) => {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        if (el.isContentEditable) return true;
        return !!el.closest?.("input, textarea, select, [contenteditable='true'], [data-roleplay-input]");
      };
      if (field(target) || field(active) || talkRef.current) return;
      if (e.repeat) return;
      if ((e.code === "Space" || e.key === " ") && phase === "play") {
        e.preventDefault();
        setPaused((p) => !p);
        return;
      }
      if (e.code === "KeyE" && phase === "play") {
        e.preventDefault();
        const w = worldRef.current;
        if (w?.interact()) setVersion((v) => v + 1);
        return;
      }
      keys.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };
    const clear = () => keys.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [keys, phase]);

  useEffect(() => {
    const w = worldRef.current;
    if (!w) return;
    w.speed = speed;
    w.paused = paused;
  }, [speed, paused, version]);

  useEffect(() => {
    if (phase !== "play") return;
    const id = window.setInterval(() => setVersion((v) => v + 1), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const onFollowChange = useCallback((v: boolean) => {
    followRef.current = v;
    setFollow(v);
  }, []);

  useEffect(() => {
    window.__controlsTest = {
      getYaw: () => worldRef.current?.player.facing ?? 0,
      getSpeed: () => worldRef.current?.player.speed ?? 0,
      getX: () => worldRef.current?.player.px ?? 0,
      getY: () => worldRef.current?.player.py ?? 0,
      getLayer: () => worldRef.current?.player.loc.layer ?? "city",
      interact: () => worldRef.current?.interact() ?? false,
      enterBuilding: (id: string) => worldRef.current?.enterBuilding(id),
      getFloor: () => worldRef.current?.player.loc.floor ?? 0,
      getBuildingId: () => worldRef.current?.player.loc.buildingId ?? null,
      commandTo: (x: number, y: number) => {
        const w = worldRef.current;
        if (!w) return false;
        w.pendingEnter = null;
        w.pendingExit = false;
        w.pendingStair = null;
        const layer = w.player.loc.layer;
        return w.commandPlayerTo(
          layer === "interior"
            ? { layer, buildingId: w.player.loc.buildingId, floor: w.player.loc.floor, x, y }
            : { layer: "city", x, y },
        );
      },
      getCam: () => ({
        x: camRef.current.x,
        y: camRef.current.y,
        z: camRef.current.z,
        follow: followRef.current,
        walkMode: walkModeRef.current,
      }),
      setFollow: (v: boolean) => {
        followRef.current = v;
        setFollow(v);
        if (v && worldRef.current) {
          camRef.current.x = worldRef.current.player.px;
          camRef.current.y = worldRef.current.player.py;
        }
      },
      setWalkMode: (v: boolean) => {
        walkModeRef.current = v;
        setWalkMode(v);
      },
      setKeys: (codes: string[]) => {
        keys.clear();
        for (const c of codes) keys.add(c);
      },
    };
    window.__sim = {
      world: () => worldRef.current,
      npcCount: () => worldRef.current?.npcs.length ?? 0,
      events: () => worldRef.current?.events.length ?? 0,
      buildings: () =>
        worldRef.current?.buildings.map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
          doorSide: b.doorSide,
          floors: b.floors.length,
          rooms: b.floors.reduce((n, f) => n + f.rooms.length, 0),
        })) ?? [],
      talk: (id: string) => {
        const w = worldRef.current;
        if (!w) return false;
        w.startRoleplay(id);
        setTalkId(id);
        setPanel(true);
        return true;
      },
      save: () => flushSave(),
      towns: () => listTowns(),
      townId: () => worldRef.current?.townId ?? lastTownId(),
      townName: () => worldRef.current?.townName ?? null,
      addVillager: (opts) => {
        const w = worldRef.current;
        if (!w) return null;
        const n = w.addVillager(opts);
        onMutate();
        return n?.id ?? null;
      },
      addHouse: (kind, name) => {
        const w = worldRef.current;
        if (!w) return null;
        const b = w.addHouse(kind || "cottage", name);
        onMutate();
        return b?.id ?? null;
      },
      select: (id) => {
        const w = worldRef.current;
        if (!w?.npc(id)) return false;
        setSelectedId(id);
        setSelectedBuildingId(null);
        setPanel(true);
        onMutate();
        return true;
      },
    };
    return () => {
      delete window.__controlsTest;
      delete window.__sim;
    };
  }, [keys, flushSave, onMutate]);

  useEffect(() => {
    if (talkId) keys.clear();
  }, [talkId, keys]);

  if (phase === "start" || !worldRef.current) {
    return (
      <StartScreen
        towns={towns}
        lastId={lastId}
        busy={booting}
        error={bootError}
        onCreate={(name, seed) => bootWorld(() => createTown(name, seed), "Simulity failed to wake.")}
        onLoad={(id) => bootWorld(() => loadTown(id))}
        onDelete={(id) => {
          deleteTown(id);
          refreshTowns();
        }}
        onRename={(id, name) => {
          renameTown(id, name);
          refreshTowns();
        }}
        onDuplicate={(id) => {
          duplicateTown(id);
          refreshTowns();
        }}
        onImport={(file) => {
          void file
            .text()
            .then((text) => {
              const save = importTown(JSON.parse(text));
              if (!save) setBootError("That file is not a Simulity borough.");
              else setBootError(null);
              refreshTowns();
            })
            .catch(() => setBootError("Could not read that file."));
        }}
        onExport={(id) => {
          const json = exportTown(id);
          const meta = towns.find((t) => t.id === id);
          if (!json) return;
          const slug = (meta?.name ?? "fenwick").trim().replace(/[^\w]+/g, "-").toLowerCase() || "fenwick";
          downloadText(`${slug}.json`, json);
        }}
      />
    );
  }

  const world = worldRef.current;
  const t = world.time();
  const clock = `Day ${t.day}  ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
  const inside = world.player.loc.layer === "interior" ? world.building(world.player.loc.buildingId) : undefined;
  const prompt = world.doorPrompt();
  const kept =
    saveError ??
    (savedAt
      ? `Saved ${new Date(savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
      : "Keeping…");

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 md:px-5">
        <p className="font-display text-lg tracking-tight truncate">{world.townName}</p>
        <p className="hidden tabular-nums text-sm text-muted sm:block">{clock}</p>
        <p className="hidden truncate text-sm text-muted md:block">
          {inside
            ? `${inside.name}${inside.floors.length > 1 ? ` · ${inside.floors[world.player.loc.floor ?? 0]?.name ?? "Ground"}` : ""}`
            : "The street"}{" "}
          · {world.npcs.length} souls
        </p>
        <p className={cn("hidden truncate text-xs lg:block", saveError ? "text-danger" : "text-subtle")}>{kept}</p>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={leave}>
            Boroughs
          </Button>
          <Button variant="ghost" size="icon" aria-label={paused ? "Resume" : "Pause"} onClick={() => setPaused((p) => !p)}>
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </Button>
          {[1, 3, 8].map((s) => (
            <button
              key={s}
              className={cn(
                "h-11 min-w-11 rounded-md px-2 text-sm tabular-nums",
                speed === s && !paused ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground",
              )}
              onClick={() => {
                setPaused(false);
                setSpeed(s);
              }}
            >
              {s}×
            </button>
          ))}
          <Button variant="ghost" size="icon" aria-label={panel ? "Close ledger" : "Open ledger"} onClick={() => setPanel((p) => !p)}>
            <PanelRight className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <SimCanvas
            world={world}
            camRef={camRef}
            followRef={followRef}
            walkModeRef={walkModeRef}
            onFollowChange={onFollowChange}
            selectedId={selectedId}
            hoverId={hoverId}
            selectedBuildingId={selectedBuildingId}
            keys={keys}
            stick={stick}
            onSelect={(id, buildingId) => {
              setSelectedId(id);
              setSelectedBuildingId(buildingId ?? null);
              if (id || buildingId) setPanel(true);
            }}
            onHover={setHoverId}
          />
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-card/90 px-3 py-2 text-xs text-muted shadow-[var(--shadow-border)] md:hidden">
            {clock}
            {inside ? ` · ${inside.name}` : ""}
          </div>
          {prompt && (
            <button
              type="button"
              className={cn(
                "absolute left-1/2 z-10 flex h-12 -translate-x-1/2 items-center gap-3 rounded-md bg-card px-4 text-sm shadow-[var(--shadow-border)]",
                panel ? "bottom-[calc(62%+12px)] md:bottom-6" : "bottom-6",
              )}
              onClick={() => {
                world.interact();
                setVersion((v) => v + 1);
              }}
            >
              <span>
                {prompt.mode === "enter"
                  ? `Enter ${prompt.name}`
                  : prompt.mode === "stairs"
                    ? `To ${prompt.name}`
                    : `Leave ${prompt.name}`}
              </span>
              <span className="hidden text-xs text-muted sm:inline">E</span>
            </button>
          )}
          <Joystick stick={stick} />
          <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1 md:bottom-6 md:left-3 md:right-auto md:top-auto md:items-start">
            <p className="pointer-events-none hidden rounded-md bg-card/80 px-3 py-1 text-xs text-muted md:block">
              Scroll zoom · drag pan · middle-click walk · counter buys
            </p>
            <div className="flex gap-1">
            <Button
              className="bg-card/90 shadow-[var(--shadow-border)]"
              variant={follow ? "primary" : "ghost"}
              size="icon"
              aria-label={follow ? "Camera following" : "Follow you"}
              title={follow ? "Following — pan or zoom to look around" : "Follow you"}
              onClick={() => {
                const next = !follow;
                followRef.current = next;
                setFollow(next);
                if (next) {
                  camRef.current.x = world.player.px;
                  camRef.current.y = world.player.py;
                }
              }}
            >
              <LocateFixed className="size-4" />
            </Button>
            <Button
              className="bg-card/90 shadow-[var(--shadow-border)]"
              variant={walkMode ? "primary" : "ghost"}
              size="icon"
              aria-label={walkMode ? "Walk mode on" : "Walk mode"}
              title={walkMode ? "Taps walk — tap again to select" : "Walk mode (or middle-click / double-tap)"}
              onClick={() => {
                const next = !walkMode;
                walkModeRef.current = next;
                setWalkMode(next);
              }}
            >
              <Footprints className="size-4" />
            </Button>
            </div>
          </div>
          {hoverId && world.npc(hoverId) && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-card px-3 py-2 text-sm shadow-[var(--shadow-border)]">
              {world.npc(hoverId)!.name}
            </div>
          )}
        </div>

        <div
          data-open={panel ? "true" : "false"}
          className={cn(
            "z-20 flex bg-card",
            "absolute inset-x-0 bottom-0 h-[62%] md:relative md:h-auto md:w-[380px] md:shrink-0",
          )}
          style={{ display: panel ? "flex" : "none" }}
          hidden={!panel}
        >
          {talkId ? (
            <Roleplay
              world={world}
              npcId={talkId}
              onClose={() => {
                setTalkId(null);
                setVersion((v) => v + 1);
              }}
            />
          ) : (
            <Inspector
              world={world}
              selectedId={selectedId}
              selectedBuildingId={selectedBuildingId}
              version={version}
              onTalk={(id) => {
                world.startRoleplay(id);
                setTalkId(id);
              }}
              onEnterBuilding={(id) => {
                world.approachBuilding(id);
                setSelectedBuildingId(id);
                setSelectedId(null);
                setVersion((v) => v + 1);
              }}
              onClose={() => setPanel(false)}
              onMutate={onMutate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Joystick({ stick }: { stick: MutableRefObject<{ active: boolean; dx: number; dy: number }> }) {
  const origin = useRef({ x: 0, y: 0 });
  return (
    <div
      className="absolute bottom-5 left-4 size-28 rounded-full bg-card/70 shadow-[var(--shadow-border)] md:hidden"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        origin.current = { x: e.clientX, y: e.clientY };
        stick.current.active = true;
      }}
      onPointerMove={(e) => {
        if (!stick.current.active) return;
        const dx = (e.clientX - origin.current.x) / 40;
        const dy = (e.clientY - origin.current.y) / 40;
        const len = Math.hypot(dx, dy) || 1;
        const s = Math.min(1, len);
        stick.current.dx = (dx / len) * s;
        stick.current.dy = (dy / len) * s;
      }}
      onPointerUp={() => {
        stick.current.active = false;
        stick.current.dx = 0;
        stick.current.dy = 0;
      }}
    >
    </div>
  );
}
