import type { Loc } from "@/sim/types";
import type { TownSave } from "@/sim/persist";

export type Presence = "here" | "called";

export type ChatTurn = { role: "user" | "assistant"; speaker?: string; content: string; action?: string; presence?: Presence };

export type DirectorAct = { id: string; guidance: string; why?: string };

export type SceneDebug = { pass: 1 | 2; acts: DirectorAct[] };

export type SceneStatus =
  | { phase: "idle" }
  | { phase: "director"; pass: 1 | 2 }
  | { phase: "character"; id: string; name: string }
  | { phase: "done" }
  | { phase: "cancelled" };

export interface SceneView {
  ids: string[];
  presence: Record<string, Presence>;
  history: ChatTurn[];
  status: SceneStatus;
  running: boolean;
  debug?: SceneDebug;
}

export interface Pose {
  id: string;
  px: number;
  py: number;
  facing: number;
  speed: number;
  loc: Loc;
  control?: string;
  goalId?: string | null;
  name?: string;
}

export interface LiveDelta {
  tickIndex: number;
  paused: boolean;
  speed: number;
  player: Pose;
  npcs: Pose[];
  door: { mode: "enter" | "leave" | "stairs"; name: string; id: string } | null;
  scene: SceneView;
  townName: string;
  clock: { day: number; hour: number; minute: number };
  savedAt: number | null;
}

export type ServerEvent =
  | { type: "snapshot"; save: TownSave; delta: LiveDelta }
  | { type: "delta"; delta: LiveDelta }
  | { type: "scene"; status: SceneStatus; beat?: ChatTurn; error?: string; debug?: SceneDebug }
  | { type: "saved"; at: number }
  | { type: "error"; error: string }
  | { type: "hello"; hasSession: boolean; townId: string | null; townName: string | null };

export type ClientIntent =
  | { type: "join" }
  | { type: "load"; id: string }
  | { type: "create"; name: string; seed: number }
  | { type: "leave" }
  | { type: "keys"; codes: string[]; stick?: { dx: number; dy: number } }
  | { type: "walkTo"; loc: Loc; pendingBuy?: boolean }
  | { type: "interact" }
  | { type: "select"; npcId?: string | null; buildingId?: string | null }
  | { type: "setPaused"; paused: boolean }
  | { type: "setSpeed"; speed: number }
  | { type: "approach"; buildingId: string }
  | { type: "speak"; text: string }
  | { type: "sceneAdd"; npcId: string }
  | { type: "sceneCall"; npcId: string }
  | { type: "sceneRemove"; npcId: string }
  | { type: "sceneEnd" }
  | { type: "sceneCancel" }
  | { type: "patchPc"; patch: Record<string, unknown> }
  | { type: "patchNpc"; id: string; patch: Record<string, unknown> }
  | { type: "addVillager"; name?: string; jobId?: string }
  | { type: "addHouse"; kind: string; name?: string }
  | { type: "renameTown"; name: string }
  | { type: "setBible"; text: string }
  | { type: "replaceTree"; tree: unknown }
  | { type: "call"; method: string; args: unknown[] };
