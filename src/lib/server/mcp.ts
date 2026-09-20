import type { Session } from "@/lib/server/session";
import { queueTask } from "@/sim/ai";
import type { TaskStep } from "@/sim/types";

export const MCP_TOOLS = ["list_souls", "list_places", "move_soul", "call_soul", "assign_task"] as const;
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
      if (!w) return { ok: false, error: "No ward is loaded." };
      const q = queueTask(w, npcId, steps);
      if (!q) return { ok: false, error: "Unknown soul or empty steps." };
      session.broadcastDelta();
      return { ok: true, result: { taskId: q.id } };
    }
    default:
      return { ok: false, error: `Unknown tool: ${tool}` };
  }
}
