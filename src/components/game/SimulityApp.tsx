import { Pause, Play, PanelRight, LocateFixed, Footprints, User, MessageSquare, ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { Inspector } from "@/components/game/Inspector";
import { Conversation } from "@/components/game/Roleplay";
import { SimCanvas, type Cam } from "@/components/game/SimCanvas";
import { StartScreen } from "@/components/game/StartScreen";
import { YouPane } from "@/components/game/YouPane";
import { Button } from "@/components/ui/button";
import { ZOOM_CITY } from "@/sim/camera";
import {
  deleteTown,
  duplicateTown,
  exportTown,
  importTown,
  listTowns,
  migrateBrowserStoreIfNeeded,
  renameTown,
} from "@/lib/persistence-client";
import { type TownMeta } from "@/sim/persist";
import { World } from "@/sim/world";
import { SessionClient } from "@/lib/session-client";
import type { Loc } from "@/sim/types";
import { cn } from "@/lib/utils";

const LAYOUT_KEY = "simulity.layout";
const LAYOUT_DEFAULTS = { you: 320, ledger: 380, conversation: 280 };
const SPEEDS = [1, 3, 8] as const;

type Chrome = {
  youOpen: boolean;
  ledgerOpen: boolean;
  conversationOpen: boolean;
  you: number;
  ledger: number;
  conversation: number;
};

function clampSize(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function readChrome(): Chrome {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { youOpen: false, ledgerOpen: true, conversationOpen: false, ...LAYOUT_DEFAULTS };
    const p = JSON.parse(raw) as Partial<Chrome>;
    return {
      youOpen: !!p.youOpen,
      ledgerOpen: p.ledgerOpen !== false,
      conversationOpen: !!p.conversationOpen,
      you: clampSize(Number(p.you), 260, 480, LAYOUT_DEFAULTS.you),
      ledger: clampSize(Number(p.ledger), 280, 560, LAYOUT_DEFAULTS.ledger),
      conversation: clampSize(Number(p.conversation), 160, 800, LAYOUT_DEFAULTS.conversation),
    };
  } catch {
    return { youOpen: false, ledgerOpen: true, conversationOpen: false, ...LAYOUT_DEFAULTS };
  }
}

function writeChrome(c: Chrome) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

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
  const [client] = useState(() => new SessionClient());
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  const [phase, setPhase] = useState<"start" | "play">("start");
  const keysRef = useRef(new Set<string>());
  const [keys] = useState(() => keysRef.current);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [chrome, setChrome] = useState<Chrome>(() =>
    typeof window === "undefined" ? { youOpen: false, ledgerOpen: true, conversationOpen: false, ...LAYOUT_DEFAULTS } : readChrome(),
  );
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const camRef = useRef<Cam>({ x: 28, y: 28, z: ZOOM_CITY });
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  const [walkMode, setWalkMode] = useState(false);
  const walkModeRef = useRef(false);
  walkModeRef.current = walkMode;
  const stick = useRef({ active: false, dx: 0, dy: 0 });
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [towns, setTowns] = useState<TownMeta[]>([]);
  const [townsLoaded, setTownsLoaded] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const townsRef = useRef<TownMeta[]>([]);
  const lastIdRef = useRef<string | null>(null);
  const youPanel = usePanelRef();
  const ledgerPanel = usePanelRef();
  const convPanel = usePanelRef();
  const [narrow, setNarrow] = useState(false);

  const world = client.world;
  const delta = client.delta;
  const scene = delta?.scene;

  const persistChrome = (next: Chrome) => {
    chromeRef.current = next;
    setChrome(next);
    writeChrome(next);
  };

  const refreshTowns = useCallback(async () => {
    try {
      const next = await listTowns();
      townsRef.current = next.towns;
      lastIdRef.current = next.lastId;
      setTowns(next.towns);
      setLastId(next.lastId);
    } catch {
      townsRef.current = [];
      lastIdRef.current = null;
      setTowns([]);
      setLastId(null);
    } finally {
      setTownsLoaded(true);
    }
  }, []);

  useEffect(() => {
    client.connect();
    const off = client.on(() => {
      bump();
      if (client.lastError) setBootError(client.lastError);
    });
    void (async () => {
      await migrateBrowserStoreIfNeeded();
      await refreshTowns();
    })();
    return () => {
      off();
      client.disconnect();
    };
  }, [client, bump, refreshTowns]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!booting) return;
    if (client.world && client.delta) {
      setBooting(false);
      setBootError(null);
      camRef.current = { x: client.world.player.px, y: client.world.player.py, z: ZOOM_CITY };
      followRef.current = true;
      setFollow(true);
      setWalkMode(false);
      setSelectedId(null);
      setSelectedBuildingId(null);
      setPhase("play");
    }
  }, [booting, client.world, client.delta]);

  useEffect(() => {
    if (phase !== "start") return;
    void refreshTowns();
  }, [phase, refreshTowns]);

  useEffect(() => {
    if (phase !== "play") return;
    const id = window.setInterval(() => {
      client.setKeys([...keys], { dx: stick.current.dx, dy: stick.current.dy });
    }, stick.current.active || keys.size ? 50 : 500);
    return () => window.clearInterval(id);
  }, [phase, client, keys]);

  const applySheet = (open: boolean, px: number) => {
    if (open) convPanel.current?.resize(`${px}px`);
    else convPanel.current?.collapse();
  };

  const applyDesktop = (cur: Chrome) => {
    if (cur.youOpen) youPanel.current?.resize(`${cur.you}px`);
    else youPanel.current?.collapse();
    if (cur.ledgerOpen) ledgerPanel.current?.resize(`${cur.ledger}px`);
    else ledgerPanel.current?.collapse();
    if (cur.conversationOpen) convPanel.current?.resize(`${cur.conversation}px`);
    else convPanel.current?.collapse();
  };

  const openExclusive = (which: keyof Pick<Chrome, "youOpen" | "ledgerOpen" | "conversationOpen">, next: boolean) => {
    const cur = chromeRef.current;
    if (narrow) {
      const updated: Chrome = {
        ...cur,
        youOpen: which === "youOpen" ? next : false,
        ledgerOpen: which === "ledgerOpen" ? next : false,
        conversationOpen: which === "conversationOpen" ? next : false,
      };
      persistChrome(updated);
      applySheet(next, cur.conversation);
      return;
    }
    const updated = { ...cur, [which]: next };
    persistChrome(updated);
    const panel = which === "youOpen" ? youPanel : which === "ledgerOpen" ? ledgerPanel : convPanel;
    const size = which === "youOpen" ? cur.you : which === "ledgerOpen" ? cur.ledger : cur.conversation;
    if (next) panel.current?.resize(`${size}px`);
    else panel.current?.collapse();
  };

  const restore = (which: "you" | "ledger" | "conversation") => {
    const cur = chromeRef.current;
    const size = LAYOUT_DEFAULTS[which];
    const openKey = which === "you" ? "youOpen" : which === "ledger" ? "ledgerOpen" : "conversationOpen";
    if (narrow) {
      persistChrome({
        ...cur,
        youOpen: which === "you",
        ledgerOpen: which === "ledger",
        conversationOpen: which === "conversation",
        conversation: size,
        [which]: size,
      });
      applySheet(true, size);
      return;
    }
    persistChrome({ ...cur, [which]: size, [openKey]: true });
    const panel = which === "you" ? youPanel : which === "ledger" ? ledgerPanel : convPanel;
    panel.current?.resize(`${size}px`);
  };

  const onPanelResize = (which: "you" | "ledger" | "conversation", px: number, prevPx: number | undefined) => {
    if (prevPx === undefined) return;
    const cur = chromeRef.current;
    if (px < 8) {
      if (narrow) {
        if (cur.youOpen || cur.ledgerOpen || cur.conversationOpen) {
          persistChrome({ ...cur, youOpen: false, ledgerOpen: false, conversationOpen: false });
        }
        return;
      }
      const openKey = which === "you" ? "youOpen" : which === "ledger" ? "ledgerOpen" : "conversationOpen";
      if (cur[openKey]) persistChrome({ ...cur, [openKey]: false });
      return;
    }
    if (narrow) {
      const openKey = cur.youOpen ? "youOpen" : cur.ledgerOpen ? "ledgerOpen" : "conversationOpen";
      persistChrome({ ...cur, conversation: Math.round(px), [openKey]: true });
      return;
    }
    const openKey = which === "you" ? "youOpen" : which === "ledger" ? "ledgerOpen" : "conversationOpen";
    persistChrome({ ...cur, [openKey]: true, [which]: Math.round(px) });
  };

  // Panel refs are stable; only re-apply when the breakpoint flips.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const cur = chromeRef.current;
      if (narrow) applySheet(cur.youOpen || cur.ledgerOpen || cur.conversationOpen, cur.conversation);
      else applyDesktop(cur);
    });
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);

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
      if (field(target) || field(active)) return;
      if (e.repeat) return;
      if ((e.code === "Space" || e.key === " ") && phase === "play") {
        e.preventDefault();
        client.send({ type: "setPaused", paused: !(delta?.paused ?? false) });
        return;
      }
      if (e.code === "KeyE" && phase === "play") {
        e.preventDefault();
        client.send({ type: "interact" });
        return;
      }
      keys.add(e.code);
      client.setKeys([...keys], { dx: stick.current.dx, dy: stick.current.dy });
    };
    const onUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      client.setKeys([...keys], { dx: stick.current.dx, dy: stick.current.dy });
    };
    const clear = () => {
      keys.clear();
      client.setKeys([], { dx: 0, dy: 0 });
    };
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
  }, [keys, phase, client, delta?.paused]);

  const onFollowChange = useCallback((v: boolean) => {
    followRef.current = v;
    setFollow(v);
  }, []);

  useEffect(() => {
    window.__controlsTest = {
      getYaw: () => client.world?.player.facing ?? 0,
      getSpeed: () => client.world?.player.speed ?? 0,
      getX: () => client.world?.player.px ?? 0,
      getY: () => client.world?.player.py ?? 0,
      getLayer: () => client.world?.player.loc.layer ?? "city",
      interact: () => {
        client.send({ type: "interact" });
        return true;
      },
      enterBuilding: (id: string) => {
        client.send({ type: "approach", buildingId: id });
      },
      getFloor: () => client.world?.player.loc.floor ?? 0,
      getBuildingId: () => client.world?.player.loc.buildingId ?? null,
      commandTo: (x: number, y: number) => {
        const w = client.world;
        if (!w) return false;
        const layer = w.player.loc.layer;
        const loc: Loc =
          layer === "interior"
            ? { layer, buildingId: w.player.loc.buildingId, floor: w.player.loc.floor, x, y }
            : { layer: "city", x, y };
        client.send({ type: "walkTo", loc });
        return true;
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
        if (v && client.world) {
          camRef.current.x = client.world.player.px;
          camRef.current.y = client.world.player.py;
        }
      },
      setWalkMode: (v: boolean) => {
        walkModeRef.current = v;
        setWalkMode(v);
      },
      setKeys: (codes: string[]) => {
        keys.clear();
        for (const c of codes) keys.add(c);
        client.setKeys(codes);
      },
    };
    window.__sim = {
      world: () => client.world,
      npcCount: () => client.world?.npcs.length ?? 0,
      events: () => client.world?.events.length ?? 0,
      buildings: () =>
        client.world?.buildings.map((b) => ({
          id: b.id,
          name: b.name,
          kind: b.kind,
          doorSide: b.doorSide,
          floors: b.floors.length,
          rooms: b.floors.reduce((n, f) => n + f.rooms.length, 0),
        })) ?? [],
      talk: (id: string) => {
        if (!client.world?.npc(id)) return false;
        client.send({ type: "sceneCall", npcId: id });
        openExclusive("conversationOpen", true);
        return true;
      },
      save: () => !!client.world,
      towns: () => townsRef.current,
      townId: () => client.world?.townId ?? lastIdRef.current,
      townName: () => client.world?.townName ?? null,
      addVillager: (opts) => {
        client.send({ type: "addVillager", name: opts?.name, jobId: opts?.jobId });
        return "pending";
      },
      addHouse: (kind, name) => {
        if (!kind) return null;
        client.send({ type: "addHouse", kind, name });
        return "pending";
      },
      select: (id) => {
        const w = client.world;
        if (!w?.npc(id)) return false;
        setSelectedId(id);
        setSelectedBuildingId(null);
        openExclusive("ledgerOpen", true);
        return true;
      },
    };
    return () => {
      delete window.__controlsTest;
      delete window.__sim;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, keys]);

  const leave = () => {
    setPhase("start");
    setSelectedId(null);
    setSelectedBuildingId(null);
    void refreshTowns();
  };

  const joinLive = () => {
    if (client.world) {
      setPhase("play");
      camRef.current = { x: client.world.player.px, y: client.world.player.py, z: ZOOM_CITY };
    }
  };

  if (phase === "start" || !world || !delta) {
    return (
      <StartScreen
        towns={towns}
        lastId={lastId}
        townsLoaded={townsLoaded}
        busy={booting}
        error={bootError}
        live={client.hasSession && client.liveTownId ? { id: client.liveTownId, name: client.liveTownName ?? "this ward" } : null}
        onJoin={joinLive}
        onCreate={(name, seed) => {
          setBooting(true);
          setBootError(null);
          client.send({ type: "create", name, seed });
        }}
        onLoad={(id) => {
          if (client.hasSession && client.liveTownId === id && client.world) {
            joinLive();
            return;
          }
          setBooting(true);
          setBootError(null);
          client.send({ type: "load", id });
        }}
        onDelete={(id) => {
          void deleteTown(id).then(() => refreshTowns());
        }}
        onRename={(id, name) => {
          void renameTown(id, name).then(() => refreshTowns());
        }}
        onDuplicate={(id) => {
          void duplicateTown(id).then(() => refreshTowns());
        }}
        onImport={(file) => {
          void file
            .text()
            .then(async (text) => {
              const save = await importTown(JSON.parse(text));
              if (!save) setBootError("That file isn't a ward save — it may be from an older version of Simulity.");
              else setBootError(null);
              await refreshTowns();
            })
            .catch(() => setBootError("Could not read that file."));
        }}
        onExport={(id) => {
          void exportTown(id).then((json) => {
            const meta = towns.find((row) => row.id === id);
            if (!json) return;
            const slug = (meta?.name ?? "fenwick").trim().replace(/[^\w]+/g, "-").toLowerCase() || "fenwick";
            downloadText(`${slug}.json`, json);
          });
        }}
      />
    );
  }

  const t = delta.clock;
  const clock = `Day ${t.day}  ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
  const inside = world.player.loc.layer === "interior" ? world.building(world.player.loc.buildingId) : undefined;
  const floorName = inside && inside.floors.length > 1 ? inside.floors[world.player.loc.floor ?? 0]?.name : undefined;
  const place = inside ? (floorName ? `${inside.name} · ${floorName}` : inside.name) : "The street";
  const prompt = delta.door;
  const paused = delta.paused;
  const speed = delta.speed;
  const kept =
    client.lastError && /save/i.test(client.lastError)
      ? client.lastError
      : delta.savedAt
        ? `Saved ${new Date(delta.savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
        : "Keeping…";
  const sceneLive = (scene?.ids.length ?? 0) > 0;
  const sheetOpen = chrome.youOpen || chrome.ledgerOpen || chrome.conversationOpen;

  const onSelect = (id: string | null, buildingId?: string) => {
    if (id && world.npc(id)?.kind === "pc") {
      setSelectedId(null);
      setSelectedBuildingId(null);
      openExclusive("youOpen", true);
      return;
    }
    setSelectedId(id);
    setSelectedBuildingId(buildingId ?? null);
    if (id || buildingId) openExclusive("ledgerOpen", true);
  };

  const selectSoul = (id: string | null, buildingId?: string) => {
    if (id && world.npc(id)?.kind === "pc") {
      setSelectedId(null);
      setSelectedBuildingId(null);
      openExclusive("youOpen", true);
      return;
    }
    setSelectedId(id);
    setSelectedBuildingId(buildingId ?? null);
    if (id || buildingId) openExclusive("ledgerOpen", true);
  };

  const inspector = (
    <Inspector
      world={world}
      selectedId={selectedId}
      selectedBuildingId={selectedBuildingId}
      version={delta.tickIndex}
      scene={scene}
      onSelect={selectSoul}
      send={(intent) => client.send(intent)}
      onTalk={(id) => {
        client.send({ type: "sceneAdd", npcId: id });
        openExclusive("conversationOpen", true);
      }}
      onEnterBuilding={(id) => {
        client.send({ type: "approach", buildingId: id });
        setSelectedBuildingId(id);
        setSelectedId(null);
      }}
      onClose={() => openExclusive("ledgerOpen", false)}
      onMutate={bump}
    />
  );

  const conversation = (
    <Conversation
      world={world}
      scene={scene ?? { ids: [], presence: {}, history: [], status: { phase: "idle" }, running: false }}
      client={client}
      error={client.lastError}
      onEnded={() => openExclusive("conversationOpen", false)}
      onSelectSoul={(id) => selectSoul(id)}
    />
  );

  const stage = (
    <PlayStage
      world={world}
      camRef={camRef}
      followRef={followRef}
      walkModeRef={walkModeRef}
      onFollowChange={onFollowChange}
      selectedId={selectedId}
      hoverId={hoverId}
      selectedBuildingId={selectedBuildingId}
      onWalkTo={(loc, opts) => client.send({ type: "walkTo", loc, pendingBuy: opts?.pendingBuy })}
      onInteract={() => client.send({ type: "interact" })}
      onApproach={(id) => client.send({ type: "approach", buildingId: id })}
      onSelect={onSelect}
      onHover={setHoverId}
      clock={clock}
      place={place}
      prompt={prompt}
      follow={follow}
      walkMode={walkMode}
      setFollow={(v) => {
        followRef.current = v;
        setFollow(v);
        if (v) {
          camRef.current.x = world.player.px;
          camRef.current.y = world.player.py;
        }
      }}
      setWalkMode={(v) => {
        walkModeRef.current = v;
        setWalkMode(v);
      }}
      stick={stick}
      narrow={narrow}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <PlayHeader
        townName={world.townName}
        clock={clock}
        place={`${place} · ${world.npcs.length} souls`}
        kept={kept}
        paused={paused}
        speed={speed}
        chrome={chrome}
        sceneCount={scene?.ids.length ?? 0}
        sceneLive={sceneLive}
        narrow={narrow}
        onLeave={leave}
        onPause={() => client.send({ type: "setPaused", paused: !paused })}
        onSpeed={(s) => client.send({ type: "setSpeed", speed: s })}
        onToggle={openExclusive}
      />
      {narrow ? (
        <Group orientation="vertical" className="min-h-0 flex-1" id="play-shell">
          <Panel id="canvas" minSize="200px">
            {stage}
          </Panel>
          <Splitter open={sheetOpen} orientation="horizontal" onRestore={() => restore("conversation")} />
          <Panel
            id="conversation"
            panelRef={convPanel}
            collapsible
            collapsedSize={0}
            minSize="160px"
            maxSize="70%"
            defaultSize={sheetOpen ? `${chrome.conversation}px` : 0}
            onResize={(size, _id, prev) => onPanelResize("conversation", size.inPixels, prev?.inPixels)}
          >
            {chrome.youOpen ? <YouPane world={world} client={client} /> : null}
            {chrome.ledgerOpen ? inspector : null}
            {chrome.conversationOpen ? conversation : null}
          </Panel>
        </Group>
      ) : (
        <Group orientation="vertical" className="min-h-0 flex-1" id="play-shell">
          <Panel id="main" minSize="240px">
            <Group orientation="horizontal" className="h-full" id="play-row">
              <Panel
                id="you"
                panelRef={youPanel}
                collapsible
                collapsedSize={0}
                minSize="260px"
                maxSize="480px"
                defaultSize={chrome.youOpen ? `${chrome.you}px` : 0}
                onResize={(size, _id, prev) => onPanelResize("you", size.inPixels, prev?.inPixels)}
              >
                {chrome.youOpen ? <YouPane world={world} client={client} /> : null}
              </Panel>
              <Splitter open={chrome.youOpen} orientation="vertical" onRestore={() => restore("you")} />
              <Panel id="canvas" minSize="320px">
                {stage}
              </Panel>
              <Splitter open={chrome.ledgerOpen} orientation="vertical" onRestore={() => restore("ledger")} />
              <Panel
                id="ledger"
                panelRef={ledgerPanel}
                collapsible
                collapsedSize={0}
                minSize="280px"
                maxSize="560px"
                defaultSize={chrome.ledgerOpen ? `${chrome.ledger}px` : 0}
                onResize={(size, _id, prev) => onPanelResize("ledger", size.inPixels, prev?.inPixels)}
              >
                {chrome.ledgerOpen ? inspector : null}
              </Panel>
            </Group>
          </Panel>
          <Splitter open={chrome.conversationOpen} orientation="horizontal" onRestore={() => restore("conversation")} />
          <Panel
            id="conversation"
            panelRef={convPanel}
            collapsible
            collapsedSize={0}
            minSize="160px"
            maxSize="50%"
            defaultSize={chrome.conversationOpen ? `${chrome.conversation}px` : 0}
            onResize={(size, _id, prev) => onPanelResize("conversation", size.inPixels, prev?.inPixels)}
          >
            {chrome.conversationOpen ? conversation : null}
          </Panel>
        </Group>
      )}
    </div>
  );
}

function PlayHeader({
  townName,
  clock,
  place,
  kept,
  paused,
  speed,
  chrome,
  sceneCount,
  sceneLive,
  narrow,
  onLeave,
  onPause,
  onSpeed,
  onToggle,
}: {
  townName: string;
  clock: string;
  place: string;
  kept: string;
  paused: boolean;
  speed: number;
  chrome: Chrome;
  sceneCount: number;
  sceneLive: boolean;
  narrow: boolean;
  onLeave: () => void;
  onPause: () => void;
  onSpeed: (n: number) => void;
  onToggle: (which: "youOpen" | "ledgerOpen" | "conversationOpen", next: boolean) => void;
}) {
  const icon = narrow ? "icon-sm" : "icon";
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length] ?? 1;
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-border px-2 md:gap-3 md:px-4">
      <p className="min-w-0 truncate font-display text-base tracking-tight md:max-w-48 md:text-lg">{townName}</p>
      <p className="hidden shrink-0 tabular-nums text-sm text-muted sm:block">{clock}</p>
      <p className="hidden min-w-0 flex-1 truncate text-sm text-muted lg:block">{place}</p>
      <p className="hidden shrink-0 text-xs text-subtle xl:block">{kept}</p>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 md:gap-1">
        <Button variant="ghost" size={narrow ? "icon-sm" : "sm"} aria-label="Wards" title="Wards" onClick={onLeave}>
          {narrow ? <ArrowLeft className="size-4" /> : "Wards"}
        </Button>
        <Button variant="ghost" size={icon} aria-label={paused ? "Resume" : "Pause"} onClick={onPause}>
          {paused ? <Play className="size-4 translate-x-px" /> : <Pause className="size-4" />}
        </Button>
        {narrow ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Speed ${speed}×`} title={`Speed ${speed}×`} onClick={() => onSpeed(nextSpeed)} className="tabular-nums">
            {speed}×
          </Button>
        ) : (
          <div className="flex rounded-md bg-card-2 p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={cn(
                  "h-9 min-w-9 rounded-xs px-2 text-sm tabular-nums transition-colors",
                  speed === s && !paused ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground",
                )}
                onClick={() => onSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        )}
        <Button
          variant={chrome.youOpen ? "primary" : "ghost"}
          size={icon}
          aria-label={chrome.youOpen ? "Close you" : "Open you"}
          title="You"
          onClick={() => onToggle("youOpen", !chrome.youOpen)}
        >
          <User className="size-4" />
        </Button>
        <Button
          variant={chrome.ledgerOpen ? "primary" : "ghost"}
          size={icon}
          aria-label={chrome.ledgerOpen ? "Close ledger" : "Open ledger"}
          title="Ledger"
          onClick={() => onToggle("ledgerOpen", !chrome.ledgerOpen)}
        >
          <PanelRight className="size-4" />
        </Button>
        <Button
          variant={chrome.conversationOpen ? "primary" : "ghost"}
          size={icon}
          aria-label={chrome.conversationOpen ? "Hide conversation" : "Open conversation"}
          title="Conversation"
          className="relative"
          onClick={() => onToggle("conversationOpen", !chrome.conversationOpen)}
        >
          <MessageSquare className="size-4" />
          {sceneLive && !chrome.conversationOpen && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-ok px-1 text-center font-mono text-xs leading-4 text-background">
              {sceneCount}
            </span>
          )}
        </Button>
      </div>
    </header>
  );
}

function Splitter({
  open,
  orientation,
  onRestore,
}: {
  open: boolean;
  orientation: "horizontal" | "vertical";
  onRestore: () => void;
}) {
  if (!open) return null;
  return (
    <Separator
      className={cn(
        "bg-transparent hover:bg-border data-[separator]:transition-colors",
        orientation === "vertical" ? "w-2 data-[separator]:cursor-col-resize" : "h-2 data-[separator]:cursor-row-resize",
      )}
      title="Drag to resize · double-click restores default"
      onDoubleClick={onRestore}
    />
  );
}

function PlayStage({
  world,
  camRef,
  followRef,
  walkModeRef,
  onFollowChange,
  selectedId,
  hoverId,
  selectedBuildingId,
  onWalkTo,
  onInteract,
  onApproach,
  onSelect,
  onHover,
  clock,
  place,
  prompt,
  follow,
  walkMode,
  setFollow,
  setWalkMode,
  stick,
  narrow,
}: {
  world: World;
  camRef: MutableRefObject<Cam>;
  followRef: MutableRefObject<boolean>;
  walkModeRef: MutableRefObject<boolean>;
  onFollowChange: (v: boolean) => void;
  selectedId: string | null;
  hoverId: string | null;
  selectedBuildingId: string | null;
  onWalkTo: (loc: Loc, opts?: { pendingBuy?: boolean }) => void;
  onInteract: () => void;
  onApproach: (id: string) => void;
  onSelect: (id: string | null, buildingId?: string) => void;
  onHover: (id: string | null) => void;
  clock: string;
  place: string;
  prompt: { mode: string; name: string } | null | undefined;
  follow: boolean;
  walkMode: boolean;
  setFollow: (v: boolean) => void;
  setWalkMode: (v: boolean) => void;
  stick: MutableRefObject<{ active: boolean; dx: number; dy: number }>;
  narrow: boolean;
}) {
  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
      <SimCanvas
        world={world}
        camRef={camRef}
        followRef={followRef}
        walkModeRef={walkModeRef}
        onFollowChange={onFollowChange}
        selectedId={selectedId}
        hoverId={hoverId}
        selectedBuildingId={selectedBuildingId}
        onWalkTo={onWalkTo}
        onInteract={onInteract}
        onApproach={onApproach}
        onSelect={onSelect}
        onHover={onHover}
      />
      {narrow && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[70%] rounded-md bg-card/90 px-3 py-2 text-xs text-muted shadow-[var(--shadow-border)]">
          {clock}
          {place ? ` · ${place}` : ""}
        </div>
      )}
      {prompt && (
        <button
          type="button"
          className={cn(
            "absolute left-1/2 z-10 flex h-11 max-w-xs -translate-x-1/2 items-center gap-3 truncate rounded-md bg-card px-4 text-sm shadow-[var(--shadow-border)]",
            narrow ? "bottom-36" : "bottom-6",
          )}
          onClick={onInteract}
        >
          <span className="truncate">
            {prompt.mode === "enter" ? `Enter ${prompt.name}` : prompt.mode === "stairs" ? `To ${prompt.name}` : `Leave ${prompt.name}`}
          </span>
          <span className="hidden shrink-0 text-xs text-muted sm:inline">E</span>
        </button>
      )}
      <Joystick stick={stick} />
      <div
        className={cn(
          "absolute z-10 flex flex-col gap-1",
          narrow ? "right-3 top-3 items-end" : "bottom-6 left-3 items-start",
        )}
      >
        {!narrow && (
          <p className="pointer-events-none rounded-md bg-card/80 px-3 py-1 text-xs text-muted">
            Scroll zoom · drag pan · middle-click walk
          </p>
        )}
        <div className="flex gap-1">
          <Button
            className="bg-card/90 shadow-[var(--shadow-border)]"
            variant={follow ? "primary" : "ghost"}
            size={narrow ? "icon-sm" : "icon"}
            aria-label={follow ? "Camera following" : "Follow you"}
            title={follow ? "Following — pan or zoom to look around" : "Follow you"}
            onClick={() => setFollow(!follow)}
          >
            <LocateFixed className="size-4" />
          </Button>
          <Button
            className="bg-card/90 shadow-[var(--shadow-border)]"
            variant={walkMode ? "primary" : "ghost"}
            size={narrow ? "icon-sm" : "icon"}
            aria-label={walkMode ? "Walk mode on" : "Walk mode"}
            title={walkMode ? "Taps walk — tap again to select" : "Walk mode (or middle-click / double-tap)"}
            onClick={() => setWalkMode(!walkMode)}
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
  );
}

function Joystick({ stick }: { stick: MutableRefObject<{ active: boolean; dx: number; dy: number }> }) {
  const origin = useRef({ x: 0, y: 0 });
  return (
    <div
      className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] size-28 rounded-full bg-card/70 shadow-[var(--shadow-border)] md:hidden"
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
    />
  );
}