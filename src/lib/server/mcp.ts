import type { Session } from "@/lib/server/session";
import { queueTask } from "@/sim/ai";
import type { TaskStep } from "@/sim/types";

export const MCP_TOOLS = ["list_souls", "list_places", "move_soul", "call_soul", "assign_task", "wear_item", "remove_item", "take_item", "store_item"] as const;
export type McpTool = (typeof MCP_TOOLS)[number];

export async function handleMcp(session: Session, tool: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  switch (tool) {
    case "list_souls":
      return { ok: true, result: session.listSouls() };
    case "list_places":
      return { ok: true, result: session.listPlaces() };
    case "move_soul": {
      const npcId = String(args.npcId ?? "");
      const to = (args.to ?? {}) as { buildingId?: string; room?: string; floor?: number } | string;
      if (!npcId) return { ok: false, error: "npcId is required." };
      const r = session.moveSoul(npcId, to as never);
      if (!r.ok) return { ok: false, error: r.error ?? "No path." };
      return { ok: true, result: { label: r.label } };
    }
    case "call_soul": {
      const npcId = String((args.npcId ?? args.id) ?? "");
      if (!npcId) return { ok: false, error: "npcId is required." };
      const r = session.callSoul(npcId);
      if (!r.ok) return { ok: false, error: r.error ?? "Call failed." };
      return { ok: true, result: { joined: npcId } };
    }
    case "assign_task": {
      const npcId = String(args.npcId ?? "");
      const steps = Array.isArray(args.steps) ? (args.steps as TaskStep[]) : [];
      if (!npcId || !steps.length) return { ok: false, error: "npcId and steps[] are required." };
      const w = session.world;
      if (!w) return { ok: false, error: "No city is loaded." };
      const q = queueTask(w, npcId, steps);
      if (!q) return { ok: false, error: "Unknown soul or empty steps." };
      session.broadcastDelta();
      return { ok: true, result: { taskId: q.id } };
    }
    case "wear_item": {
      const npcId = String(args.npcId ?? "");
      const itemId = String(args.itemId ?? "");
      if (!npcId || !itemId) return { ok: false, error: "npcId and itemId are required." };
      const w = session.world;
      if (!w) return { ok: false, error: "No city is loaded." };
      const err = w.wearItem(npcId, itemId);
      if (err) return { ok: false, error: err };
      session.broadcastDelta();
      return { ok: true, result: { worn: itemId } };
    }
    case "remove_item": {
      const npcId = String(args.npcId ?? "");
      const target = String(args.slot ?? args.itemId ?? "");
      const to = args.to === "hands" || args.to === "hook" ? (args.to as "hands" | "hook") : "here";
      if (!npcId || !target) return { ok: false, error: "npcId and slot/itemId are required." };
      const w = session.world;
      if (!w) return { ok: false, error: "No city is loaded." };
      const err = w.removeItem(npcId, target, to);
      if (err) return { ok: false, error: err };
      session.broadcastDelta();
      return { ok: true, result: { removed: target, to } };
    }
    case "take_item": {
      const npcId = String(args.npcId ?? "");
      const itemId = String(args.itemId ?? "");
      if (!npcId || !itemId) return { ok: false, error: "npcId and itemId are required." };
      const w = session.world;
      if (!w) return { ok: false, error: "No city is loaded." };
      const err = w.takeItem(npcId, itemId);
      if (err) return { ok: false, error: err };
      session.broadcastDelta();
      return { ok: true, result: { taken: itemId } };
    }
    case "store_item": {
      const npcId = String(args.npcId ?? "");
      const itemId = String(args.itemId ?? "");
      if (!npcId || !itemId) return { ok: false, error: "npcId and itemId are required." };
      const w = session.world;
      if (!w) return { ok: false, error: "No city is loaded." };
      const err = w.storeItem(npcId, itemId);
      if (err) return { ok: false, error: err };
      session.broadcastDelta();
      return { ok: true, result: { stored: itemId } };
    }
    default:
      return { ok: false, error: `Unknown tool: ${tool}` };
  }
}
