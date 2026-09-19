import type { ClientIntent } from "@/lib/protocol";
import type { Session } from "@/lib/server/session";
import type { Loc } from "@/sim/types";
import type { BtTree } from "@/sim/types";

const HEAVY = new Set([
  "addVillager",
  "addHouse",
  "replaceTree",
  "call",
  "renameTown",
  "setBible",
  "sceneAdd",
  "sceneCall",
  "sceneRemove",
  "sceneEnd",
  "patchPc",
  "patchNpc",
  "interact",
  "approach",
]);

export async function dispatchIntent(session: Session, intent: ClientIntent): Promise<boolean> {
  const w = session.world;
  if (!w) return false;
  switch (intent.type) {
    case "walkTo":
      w.pendingEnter = null;
      w.pendingExit = false;
      w.pendingStair = null;
      w.pendingBuy = intent.pendingBuy
        ? { x: intent.loc.x, y: intent.loc.y, floor: intent.loc.floor ?? 0 }
        : null;
      w.commandPlayerTo(intent.loc);
      return false;
    case "interact":
      w.interact();
      return true;
    case "setPaused":
      w.paused = intent.paused;
      return false;
    case "setSpeed":
      w.speed = intent.speed;
      w.paused = false;
      return false;
    case "approach":
      w.approachBuilding(intent.buildingId);
      return true;
    case "patchPc":
      w.patchVillager("pc", intent.patch as Parameters<typeof w.patchVillager>[1]);
      return true;
    case "patchNpc":
      w.patchVillager(intent.id, intent.patch as Parameters<typeof w.patchVillager>[1]);
      return true;
    case "addVillager":
      w.addVillager({ name: intent.name, jobId: intent.jobId });
      return true;
    case "addHouse":
      w.addHouse(intent.kind, intent.name);
      return true;
    case "renameTown":
      w.townName = intent.name.trim() || w.townName;
      return true;
    case "setBible":
      w.settingBible = intent.text.trim() || w.settingBible;
      return false;
    case "replaceTree":
      w.replaceTree(intent.tree as BtTree);
      return false;
    case "sceneAdd":
      addToScene(session, intent.npcId, "here");
      return false;
    case "sceneCall":
      addToScene(session, intent.npcId, "called");
      return false;
    case "sceneRemove":
      removeFromScene(session, intent.npcId);
      return false;
    case "sceneEnd":
      session.scene.abort?.abort();
      for (const id of session.scene.ids) w.endRoleplay(id);
      session.scene.ids = [];
      session.scene.presence = {};
      session.scene.history = [];
      session.scene.running = false;
      session.scene.status = { phase: "idle" };
      session.scene.abort = null;
      session.scene.debug = undefined;
      return false;
    case "call":
      return invoke(w as unknown as { [k: string]: unknown }, intent.method, intent.args);
    default:
      return false;
  }
}

export function addToScene(session: Session, npcId: string, want: "here" | "called") {
  const w = session.world;
  if (!w) return false;
  const n = w.npc(npcId);
  if (!n || n.kind === "pc") return false;
  if (session.scene.ids.includes(npcId)) return false;
  if (want === "here" && !w.isHere(npcId)) return false;
  if (want === "called" && w.isHere(npcId)) want = "here";
  w.startRoleplay(npcId);
  session.scene.ids.push(npcId);
  session.scene.presence[npcId] = want;
  return true;
}

function removeFromScene(session: Session, npcId: string) {
  const w = session.world;
  if (!w) return;
  if (!session.scene.ids.includes(npcId)) return;
  w.endRoleplay(npcId);
  session.scene.ids = session.scene.ids.filter((id) => id !== npcId);
  delete session.scene.presence[npcId];
}

const ALLOWED = new Set([
  "addVillager",
  "addHouse",
  "removeVillager",
  "removeBuilding",
  "renameBuilding",
  "grantSpell",
  "revokeSpell",
  "setSpouse",
  "addParent",
  "removeParent",
  "assignBed",
  "addBuildingKind",
  "removeBuildingKind",
  "addJob",
  "removeJob",
  "addRoomRect",
  "placeFurniture",
  "setBuildingStreetDoor",
  "removeFurnitureAt",
  "paintFloorTile",
  "linkStairs",
  "addFloorAbove",
  "addBasement",
  "removeFloor",
  "renameRoom",
  "deleteRoom",
  "assignRoom",
]);

function invoke(w: { [k: string]: unknown }, method: string, args: unknown[]): boolean {
  if (!ALLOWED.has(method)) return false;
  const fn = w[method];
  if (typeof fn !== "function") return false;
  (fn as (...a: unknown[]) => unknown).apply(w, args);
  return true;
}

export function locFromCity(x: number, y: number): Loc {
  return { layer: "city", x, y };
}

export { HEAVY };
