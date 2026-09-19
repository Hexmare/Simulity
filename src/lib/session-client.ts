import { hydrateWorld } from "@/sim/persist";
import { World } from "@/sim/world";
import type { ClientIntent, LiveDelta, ServerEvent } from "@/lib/protocol";
import type { Loc } from "@/sim/types";

export class SessionClient {
  ws: WebSocket | null = null;
  world: World | null = null;
  delta: LiveDelta | null = null;
  lastError: string | null = null;
  hasSession = false;
  liveTownId: string | null = null;
  liveTownName: string | null = null;
  connected = false;
  private listeners = new Set<() => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private queue: ClientIntent[] = [];
  codes: string[] = [];
  stick = { dx: 0, dy: 0 };

  on(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  connect() {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (typeof window === "undefined") return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      for (const intent of this.queue) {
        ws.send(JSON.stringify(intent));
      }
      this.queue = [];
      this.emit();
    };
    ws.onmessage = (e) => {
      try {
        this.onEvent(JSON.parse(String(e.data)) as ServerEvent);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      this.connected = false;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.ws = null;
      this.emit();
      if (this.wanted) this.retry = setTimeout(() => this.connect(), 1000);
    };
    this.heartbeat = setInterval(() => this.flushKeys(), 500);
  }

  disconnect() {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws?.close();
    this.ws = null;
  }

  send(intent: ClientIntent) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(intent));
    else this.queue.push(intent);
  }

  setKeys(codes: string[], stick?: { dx: number; dy: number }) {
    this.codes = codes;
    if (stick) this.stick = stick;
    this.flushKeys();
  }

  private flushKeys() {
    if (!this.world) return;
    this.send({ type: "keys", codes: this.codes, stick: this.stick });
  }

  private onEvent(ev: ServerEvent) {
    if (ev.type === "error") {
      this.lastError = ev.error;
      this.emit();
      return;
    }
    if (ev.type === "hello") {
      this.hasSession = ev.hasSession;
      this.liveTownId = ev.townId;
      this.liveTownName = ev.townName;
      if (!ev.hasSession) {
        this.world = null;
        this.delta = null;
      }
      this.emit();
      return;
    }
    if (ev.type === "snapshot") {
      this.world = hydrateWorld(ev.save, { live: true });
      this.applyDelta(ev.delta);
      this.hasSession = true;
      this.liveTownId = this.world.townId;
      this.liveTownName = this.world.townName;
      this.lastError = null;
      this.emit();
      return;
    }
    if (ev.type === "delta") {
      this.applyDelta(ev.delta);
      this.emit();
      return;
    }
    if (ev.type === "scene") {
      if (this.delta) {
        this.delta.scene.status = ev.status;
        if (ev.status.phase === "idle") {
          this.delta.scene.ids = [];
          this.delta.scene.presence = {};
          this.delta.scene.history = [];
          this.delta.scene.running = false;
          this.delta.scene.debug = undefined;
        } else if (ev.status.phase === "cancelled" || ev.status.phase === "done") {
          this.delta.scene.running = false;
        }
      }
      if (ev.beat && this.delta) this.delta.scene.history = [...this.delta.scene.history, ev.beat];
      if (ev.debug && this.delta) this.delta.scene.debug = ev.debug;
      if (ev.error) this.lastError = ev.error;
      this.emit();
      return;
    }
    if (ev.type === "saved" && this.delta) {
      this.delta.savedAt = ev.at;
      this.emit();
    }
  }

  private applyDelta(d: LiveDelta) {
    this.delta = d;
    const w = this.world;
    if (!w) return;
    w.tickIndex = d.tickIndex;
    w.paused = d.paused;
    w.speed = d.speed;
    w.townName = d.townName;
    const apply = (body: { px: number; py: number; facing: number; speed: number; loc: Loc; bb: { control: string; goalId: string | null } }, pose: LiveDelta["player"]) => {
      body.px = pose.px;
      body.py = pose.py;
      body.facing = pose.facing;
      body.speed = pose.speed;
      body.loc = { ...pose.loc };
      if (pose.control) body.bb.control = pose.control as typeof body.bb.control;
      if (pose.goalId !== undefined) body.bb.goalId = pose.goalId;
    };
    apply(w.player, d.player);
    for (const pose of d.npcs) {
      const n = w.npc(pose.id);
      if (n) apply(n, pose);
    }
  }
}
