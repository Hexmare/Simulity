import { hydrateWorld, snapshotWorld } from "@/sim/persist";
import { World } from "@/sim/world";
import { REAL_SECONDS_PER_TICK } from "@/sim/types";
import type { ClientIntent, LiveDelta, Pose, Presence, RoundFailed, SceneDebug, SceneStatus, SceneView, ServerEvent } from "@/lib/protocol";
import { dispatchIntent } from "@/lib/server/intents";
import { runSceneRound } from "@/lib/server/orchestrator";
import { claimUse, resolveWhere } from "@/sim/ai";
import type { Loc, Npc } from "@/sim/types";

export type Sock = { send: (ev: ServerEvent) => void };

export interface LiveScene {
  ids: string[];
  presence: Record<string, Presence>;
  history: SceneView["history"];
  status: SceneStatus;
  running: boolean;
  abort: AbortController | null;
  debug?: SceneDebug;
  failed?: RoundFailed | null;
}

export interface RoundCursor {
  playerLine: string;
  pass: 1 | 2;
  acts: { id: string; guidance: string }[];
  alreadyActed: string[];
  failed: RoundFailed | null;
}

const TICK_MS = 50;

type G = typeof globalThis & { __simulity?: Session };

export class Session {
  world: World | null = null;
  clients = new Set<Sock>();
  keys = new Set<string>();
  stick = { dx: 0, dy: 0 };
  scene: LiveScene = emptyScene();
  round: RoundCursor | null = null;
  savedAt: number | null = null;
  private acc = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private dropTimer: ReturnType<typeof setTimeout> | null = null;

  hasSession() {
    return !!this.world;
  }

  view(): LiveDelta | null {
    const w = this.world;
    if (!w) return null;
    const t = w.time();
    const pose = (n: { id: string; px: number; py: number; facing: number; speed: number; loc: Loc; bb: { control: string; goalId: string | null; needs: Record<string, number>; mood: number; pose?: string; usingId?: string | null }; relationships: Pose["relationships"]; name: string }): Pose => ({
      id: n.id,
      px: n.px,
      py: n.py,
      facing: n.facing,
      speed: n.speed,
      loc: { ...n.loc },
      control: n.bb.control,
      goalId: n.bb.goalId,
      name: n.name,
      needs: { ...n.bb.needs },
      mood: n.bb.mood,
      relationships: JSON.parse(JSON.stringify(n.relationships ?? {})) as Pose["relationships"],
      pose: (n.bb.pose as Pose["pose"]) ?? "stand",
      usingId: n.bb.usingId ?? null,
    });
    return {
      tickIndex: w.tickIndex,
      paused: w.paused,
      speed: w.speed,
      player: pose(w.player),
      npcs: w.npcs.map(pose),
      door: w.doorPrompt(),
      scene: {
        ids: this.scene.ids,
        presence: { ...this.scene.presence },
        history: this.scene.history.slice(),
        status: this.scene.status,
        running: this.scene.running,
        debug: this.scene.debug,
        failed: this.scene.failed ?? null,
      },
      townName: w.townName,
      clock: { day: t.day, hour: t.hour, minute: t.minute },
      savedAt: this.savedAt,
      events: w.events.slice(-80),
    };
  }

  broadcast(ev: ServerEvent) {
    for (const c of this.clients) {
      try {
        c.send(ev);
      } catch {
        /* ignore */
      }
    }
  }

  broadcastDelta() {
    const d = this.view();
    if (d) this.broadcast({ type: "delta", delta: d });
  }

  broadcastSnapshot() {
    const w = this.world;
    const d = this.view();
    if (!w || !d) return;
    this.broadcast({ type: "snapshot", save: snapshotWorld(w), delta: d });
  }

  attach(sock: Sock) {
    if (this.dropTimer) {
      clearTimeout(this.dropTimer);
      this.dropTimer = null;
    }
    this.clients.add(sock);
    sock.send({
      type: "hello",
      hasSession: !!this.world,
      townId: this.world?.townId ?? null,
      townName: this.world?.townName ?? null,
    });
    if (this.world) {
      const d = this.view()!;
      sock.send({ type: "snapshot", save: snapshotWorld(this.world), delta: d });
    }
  }

  detach(sock: Sock) {
    this.clients.delete(sock);
    if (this.clients.size === 0 && this.world) {
      this.dropTimer = setTimeout(() => {
        void this.unload();
      }, 30_000);
    }
  }

  async load(id: string): Promise<boolean> {
    const { readTown } = await import("@/lib/server/store");
    const save = await readTown(id);
    if (!save) return false;
    if (this.world) await this.persist();
    this.world = hydrateWorld(save, { live: true });
    this.scene = emptyScene();
    this.round = null;
    this.startLoops();
    this.broadcastSnapshot();
    return true;
  }

  async create(name: string, seed: number, kitId?: string, population?: number): Promise<boolean> {
    if (this.world) await this.persist();
    // Kits + custom catalog come from the server Library (duplicate-to-custom).
    const { readLibraryCatalog, readLibraryKits } = await import("@/lib/server/store");
    const { getKitWithCustom } = await import("@/sim/kits");
    const [kits, catalog] = await Promise.all([readLibraryKits(), readLibraryCatalog()]);
    const kit = getKitWithCustom(kitId, kits);
    const customCatalog = Object.keys(catalog).length ? (catalog as Record<string, unknown[]>) : undefined;
    const w = new World(seed, kit.id, { population, kit, customCatalog });
    if (name.trim()) w.townName = name.trim();
    this.world = w;
    this.scene = emptyScene();
    this.round = null;
    await this.persist();
    this.startLoops();
    this.broadcastSnapshot();
    return true;
  }

  async persist() {
    const w = this.world;
    if (!w) return;
    const { writeTown } = await import("@/lib/server/store");
    await writeTown(snapshotWorld(w));
    this.savedAt = Date.now();
    this.broadcast({ type: "saved", at: this.savedAt });
  }

  async unload() {
    this.stopLoops();
    if (this.world) await this.persist();
    this.world = null;
    this.scene = emptyScene();
    this.round = null;
    this.keys.clear();
  }

  private startLoops() {
    this.stopLoops();
    this.acc = 0;
    this.timer = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
    this.persistTimer = setInterval(() => void this.persist(), 8000);
  }

  private stopLoops() {
    if (this.timer) clearInterval(this.timer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.timer = null;
    this.persistTimer = null;
  }

  tick(dt: number) {
    const w = this.world;
    if (!w) return;
    // Scene clock: the whole live session runs at 1 tick = 1 sim second while
    // any scene is open (Hide counts); otherwise 1 tick = 1 sim minute.
    w.setSceneClock(this.scene.ids.length > 0);
    const mx = (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? -1 : 0) + (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0);
    const my = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? -1 : 0) + (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    if (this.stick.dx || this.stick.dy) w.movePlayer(this.stick.dx, this.stick.dy, dt);
    else if (mx || my) w.movePlayer(mx, my, dt);
    else w.tickPlayerMove(dt);
    this.followPresent();
    this.acc += dt * (w.paused ? 0 : Math.max(0, w.speed));
    const step = REAL_SECONDS_PER_TICK;
    let guard = 0;
    while (this.acc >= step && guard++ < 32) {
      w.step();
      this.acc -= step;
    }
    w.animate(dt * (w.paused ? 0 : Math.max(0, w.speed)));
    this.broadcastDelta();
  }

  followPresent() {
    const w = this.world;
    if (!w) return;
    const dest = { ...w.player.loc, x: Math.floor(w.player.px), y: Math.floor(w.player.py) };
    for (const id of this.scene.ids) {
      if (this.scene.presence[id] === "called") continue;
      const n = w.npc(id);
      if (!n || n.bb.control !== "llm") continue;
      if (w.isHere(id)) continue;
      w.commandNpcTo(id, dest);
    }
  }

  currentWitnesses(): string[] {
    return [...this.scene.ids, "pc"];
  }

  async handle(intent: ClientIntent, sock: Sock): Promise<void> {
    try {
      if (intent.type === "join") {
        this.attach(sock);
        return;
      }
      if (intent.type === "load") {
        const ok = await this.load(intent.id);
        if (!ok) sock.send({ type: "error", error: "That city could not be found — a fresh city awaits." });
        return;
      }
      if (intent.type === "create") {
        await this.create(intent.name, intent.seed, intent.kitId, intent.population);
        return;
      }
      if (intent.type === "leave") {
        await this.unload();
        sock.send({ type: "hello", hasSession: false, townId: null, townName: null });
        return;
      }
      if (!this.world) {
        sock.send({ type: "error", error: "No city is loaded." });
        return;
      }
      if (intent.type === "keys") {
        this.keys = new Set(intent.codes);
        this.stick = intent.stick ?? { dx: 0, dy: 0 };
        return;
      }
      if (intent.type === "speak") {
        await this.onSpeak(intent.text);
        return;
      }
      if (intent.type === "sceneRetry") {
        await this.onRetry();
        return;
      }
      if (intent.type === "sceneCancel") {
        this.scene.abort?.abort();
        this.scene.running = false;
        if ((this.scene.status as SceneStatus).phase !== "failed") this.scene.status = { phase: "cancelled" };
        // Cancel aborts in-flight auto-retries; a recorded failure keeps its banner so Retry still works.
        this.broadcast({ type: "scene", status: this.scene.status, failed: this.scene.failed ?? null });
        this.broadcastDelta();
        return;
      }
      const heavy = await dispatchIntent(this, intent);
      if (heavy) this.broadcastSnapshot();
      else this.broadcastDelta();
    } catch (err) {
      sock.send({ type: "error", error: err instanceof Error ? err.message : "Intent failed." });
    }
  }

  async onSpeak(text: string) {
    const line = text.trim().slice(0, 800);
    if (!line || !this.world || this.scene.running || this.scene.ids.length === 0) return;
    const { readBundle, resolveEffective } = await import("@/lib/server/profiles");
    const bundle = await readBundle();
    const eff = resolveEffective(bundle, "character");
    if (!eff.enabled || !eff.baseUrl.trim()) {
      this.broadcast({ type: "scene", status: this.scene.status, error: "Roleplay is offline — set a provider in Settings." });
      return;
    }
    // New Speak discards the paused cursor and clears the banner.
    this.round = { playerLine: line, pass: 1, acts: [], alreadyActed: [], failed: null };
    this.scene.failed = null;
    this.scene.status = { phase: "director", pass: 1 };
    const witnesses = this.currentWitnesses();
    this.scene.history.push({ role: "user", speaker: this.world.player.name, speakerId: "pc", content: line, witnesses });
    this.world.log({ type: "talk", actorId: "pc", summary: line.slice(0, 240), source: "llm" });
    this.scene.running = true;
    this.scene.abort = new AbortController();
    this.broadcastDelta();
    try {
      await runSceneRound(this, line, this.scene.abort.signal);
    } catch (err) {
      this.broadcast({ type: "scene", status: this.scene.status, error: err instanceof Error ? err.message : "Round failed.", failed: this.scene.failed ?? null });
    }
    this.scene.running = false;
    {
      const ph = (this.scene.status as SceneStatus).phase;
      if (ph !== "cancelled" && ph !== "failed") this.scene.status = { phase: "done" };
    }
    this.broadcast({ type: "scene", status: this.scene.status, failed: this.scene.failed ?? null });
    this.broadcastDelta();
  }

  async onRetry() {
    if (!this.world || this.scene.running) return;
    if ((this.scene.status as SceneStatus).phase !== "failed" || !this.scene.failed || !this.round) return;
    this.scene.running = true;
    this.scene.abort = new AbortController();
    this.broadcastDelta();
    try {
      await runSceneRound(this, this.round.playerLine, this.scene.abort.signal, undefined, true);
    } catch (err) {
      this.broadcast({ type: "scene", status: this.scene.status, error: err instanceof Error ? err.message : "Round failed.", failed: this.scene.failed ?? null });
    }
    this.scene.running = false;
    {
      const ph = (this.scene.status as SceneStatus).phase;
      if (ph !== "cancelled" && ph !== "failed") this.scene.status = { phase: "done" };
    }
    this.broadcast({ type: "scene", status: this.scene.status, failed: this.scene.failed ?? null });
    this.broadcastDelta();
  }

  // ---- MCP / tool wrappers (same Session as /ws) ----

  listSouls() {
    const w = this.world;
    if (!w) return [];
    return [...w.npcs, w.player].map((n) => ({
      id: n.id,
      name: n.name,
      job: w.defs.jobs[n.bb.jobId]?.label ?? n.bb.jobId,
      loc: n.loc,
      pose: (n.bb.pose ?? "stand") as string,
      here: n.kind === "pc" ? true : w.isHere(n.id),
    }));
  }

  listPlaces() {
    const w = this.world;
    if (!w) return [];
    return w.buildings.map((b) => ({
      id: b.id,
      name: b.name,
      kind: w.defs.buildingKinds[b.kind]?.slug ?? b.kind,
      floors: b.floors.map((f) => ({ index: f.index, name: f.name, rooms: f.rooms.map((r) => r.name), furniture: (f.furniture ?? []).length })),
    }));
  }

  moveSoul(npcId: string, to: { buildingId?: string; room?: string; floor?: number } | "sys:home" | "sys:work" | "sys:eat"): { ok: boolean; label?: string; error?: string } {
    const w = this.world;
    if (!w) return { ok: false, error: "No city is loaded." };
    const n = w.npc(npcId);
    if (!n || n.kind === "pc") return { ok: false, error: "Unknown soul." };
    let dest;
    if (typeof to === "string") {
      dest = resolveWhere(w, n, to);
    } else if (to.buildingId || to.room) {
      // Resolve via generic claim so occupancy applies; named room preferred
      // (a room alone means the soul's current building).
      dest = fileMoveDest(w, n, to);
    } else {
      return { ok: false, error: "Unknown destination." };
    }
    if (!dest) return { ok: false, error: "No path." };
    // Path, not teleport. Legal during a scene even when control === "llm".
    const ok = w.commandNpcTo(npcId, dest);
    if (!ok) return { ok: false, error: "No path." };
    // Re-reserve a seat at the destination building for arrival (commandNpcTo releases).
    if (dest.layer === "interior" && dest.buildingId) {
      const b = w.building(dest.buildingId);
      if (b) {
        const prefer = to === "sys:work" ? "work" : "seat";
        try {
          claimUse(w, n, b, prefer as "seat");
        } catch {
          /* ignore */
        }
      }
    }
    const label = dest.layer === "interior" ? (w.building(dest.buildingId)?.name ?? "inside") : "the street";
    if (this.scene.ids.includes(npcId)) {
      this.scene.history.push({
        role: "assistant",
        speaker: n.name,
        speakerId: n.id,
        content: "",
        action: `walks toward ${label}`,
        presence: this.scene.presence[npcId],
        witnesses: this.currentWitnesses(),
      });
      this.broadcast({ type: "scene", status: this.scene.status, beat: this.scene.history[this.scene.history.length - 1] });
    }
    this.broadcastDelta();
    return { ok: true, label };
  }

  callSoul(npcId: string): { ok: boolean; error?: string } {
    const w = this.world;
    if (!w) return { ok: false, error: "No city is loaded." };
    const n = w.npc(npcId);
    if (!n || n.kind === "pc") return { ok: false, error: "Unknown soul." };
    if (this.scene.ids.includes(npcId)) return { ok: false, error: "Already in the scene." };
    if (w.isHere(npcId)) return { ok: false, error: "They are here — use Add." };
    w.startRoleplay(npcId);
    this.scene.ids.push(npcId);
    this.scene.presence[npcId] = "called";
    this.broadcastDelta();
    return { ok: true };
  }
}

function emptyScene(): LiveScene {
  return { ids: [], presence: {}, history: [], status: { phase: "idle" }, running: false, abort: null, debug: undefined, failed: null };
}

export function getSession(): Session {
  const g = globalThis as G;
  if (!g.__simulity) g.__simulity = new Session();
  return g.__simulity;
}

function fileMoveDest(w: World, n: Npc, to: { buildingId?: string; room?: string; floor?: number }): Loc | null {
  // A room alone means the soul's current building (the only rooms a Character
  // can name from prompt knowledge). Unknown destinations return null.
  const b = w.building(to.buildingId) ?? (to.room ? w.building(n.loc.buildingId) : undefined);
  if (!b) return null;
  // Named room: pick a free chair/counter tile inside it when possible.
  if (to.room) {
    for (const f of b.floors) {
      if (to.floor != null && f.index !== to.floor) continue;
      const room = f.rooms.find((r) => r.name === to.room || r.kind === to.room);
      if (!room) continue;
      const cands = (f.furniture ?? []).filter((i) => i.kind === "chair" || i.kind === "counter" || i.kind === "pew");
      const free = cands.filter((c) => {
        if (c.x < room.x || c.y < room.y || c.x >= room.x + room.w || c.y >= room.y + room.h) return false;
        return ![...w.npcs, w.player].some((o) => o.id !== n.id && (o.bb.usingId === c.id));
      });
      free.sort((a, c) => (a.id < c.id ? -1 : 1));
      if (free.length) {
        const item = free[0]!;
        n.bb.usingId = item.id;
        n.bb.pose = "sit";
        return { layer: "interior", buildingId: b.id, floor: f.index, x: item.x, y: item.y };
      }
      return { layer: "city", x: b.entrance.x, y: b.entrance.y };
    }
  }
  return resolveWhere(w, n, b.kind);
}
