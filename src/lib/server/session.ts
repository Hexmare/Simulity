import { hydrateWorld, snapshotWorld } from "@/sim/persist";
import { World } from "@/sim/world";
import { REAL_SECONDS_PER_TICK } from "@/sim/types";
import { getKit } from "@/sim/kits";
import type { ClientIntent, LiveDelta, Pose, Presence, SceneDebug, SceneStatus, SceneView, ServerEvent } from "@/lib/protocol";
import { dispatchIntent } from "@/lib/server/intents";
import { runSceneRound } from "@/lib/server/orchestrator";
import type { Loc } from "@/sim/types";

export type Sock = { send: (ev: ServerEvent) => void };

export interface LiveScene {
  ids: string[];
  presence: Record<string, Presence>;
  history: SceneView["history"];
  status: SceneStatus;
  running: boolean;
  abort: AbortController | null;
  debug?: SceneDebug;
}

const TICK_MS = 50;

type G = typeof globalThis & { __simulity?: Session };

export class Session {
  world: World | null = null;
  clients = new Set<Sock>();
  keys = new Set<string>();
  stick = { dx: 0, dy: 0 };
  scene: LiveScene = emptyScene();
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
    const pose = (n: { id: string; px: number; py: number; facing: number; speed: number; loc: Loc; bb: { control: string; goalId: string | null }; name: string }): Pose => ({
      id: n.id,
      px: n.px,
      py: n.py,
      facing: n.facing,
      speed: n.speed,
      loc: { ...n.loc },
      control: n.bb.control,
      goalId: n.bb.goalId,
      name: n.name,
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
      },
      townName: w.townName,
      clock: { day: t.day, hour: t.hour, minute: t.minute },
      savedAt: this.savedAt,
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
    this.startLoops();
    this.broadcastSnapshot();
    return true;
  }

  async create(name: string, seed: number): Promise<boolean> {
    if (this.world) await this.persist();
    const w = new World(seed);
    if (name.trim()) w.townName = name.trim();
    else w.townName = getKit(w.kitId).label;
    this.world = w;
    this.scene = emptyScene();
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

  async handle(intent: ClientIntent, sock: Sock): Promise<void> {
    try {
      if (intent.type === "join") {
        this.attach(sock);
        return;
      }
      if (intent.type === "load") {
        const ok = await this.load(intent.id);
        if (!ok) sock.send({ type: "error", error: "That town could not be found — a fresh ward awaits." });
        return;
      }
      if (intent.type === "create") {
        await this.create(intent.name, intent.seed);
        return;
      }
      if (intent.type === "leave") {
        await this.unload();
        sock.send({ type: "hello", hasSession: false, townId: null, townName: null });
        return;
      }
      if (!this.world) {
        sock.send({ type: "error", error: "No ward is loaded." });
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
      if (intent.type === "sceneCancel") {
        this.scene.abort?.abort();
        this.scene.running = false;
        this.scene.status = { phase: "cancelled" };
        this.broadcast({ type: "scene", status: this.scene.status });
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
    this.scene.history.push({ role: "user", speaker: this.world.player.name, content: line });
    this.scene.running = true;
    this.scene.abort = new AbortController();
    this.broadcastDelta();
    try {
      await runSceneRound(this, line, this.scene.abort.signal);
    } catch (err) {
      this.broadcast({ type: "scene", status: this.scene.status, error: err instanceof Error ? err.message : "Round failed." });
    }
    this.scene.running = false;
    if (this.scene.status.phase !== "cancelled") this.scene.status = { phase: "done" };
    this.broadcast({ type: "scene", status: this.scene.status });
    this.broadcastDelta();
  }
}

function emptyScene(): LiveScene {
  return { ids: [], presence: {}, history: [], status: { phase: "idle" }, running: false, abort: null, debug: undefined };
}

export function getSession(): Session {
  const g = globalThis as G;
  if (!g.__simulity) g.__simulity = new Session();
  return g.__simulity;
}