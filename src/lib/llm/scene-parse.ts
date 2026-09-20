import type { RoleplayDeltas, TaskStep } from "../../sim/types.ts";

export function extractJsonObject(raw: string): string | null {
  let text = raw.trim();
  // Strip markdown fences (```json ... ``` or ``` ... ```), possibly with language tag.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) text = fence[1]!.trim();
  // Bare array of acts without the {"acts": ...} wrapper.
  if (text.startsWith("[")) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === "[") {
        depth++;
      } else if (ch === "]") {
        depth--;
        if (depth === 0) return `{"acts":${text.slice(0, i + 1)}}`;
      }
    }
    return null;
  }
  // Find the first balanced {...} block.
  const start = text.indexOf("{");
  if (start < 0) {
    // Bare array: {"acts": [...]} wrapper missing.
    const arrStart = text.indexOf("[");
    const arrEnd = text.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) return `{"acts":${text.slice(arrStart, arrEnd + 1)}}`;
    return null;
  }
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

export function parseDirector(
  raw: string,
  legal: Set<string>,
): { acts: { id: string; guidance: string; why?: string }[]; add: { id: string; how: "here" | "call" }[]; remove: string[]; parseError: boolean } {
  const candidate = extractJsonObject(raw);
  if (!candidate) return { acts: [], add: [], remove: [], parseError: true };
  try {
    const parsed = JSON.parse(candidate) as {
      acts?: { id?: string; guidance?: string; why?: string }[];
      add?: { id?: string; how?: string }[];
      remove?: unknown;
    };
    const acts: { id: string; guidance: string; why?: string }[] = [];
    const seen = new Set<string>();
    for (const a of Array.isArray(parsed.acts) ? parsed.acts : []) {
      const id = String(a.id ?? "");
      if (!legal.has(id) || seen.has(id)) continue;
      seen.add(id);
      acts.push({ id, guidance: String(a.guidance ?? "").slice(0, 400), why: a.why ? String(a.why).slice(0, 200) : undefined });
    }
    const add: { id: string; how: "here" | "call" }[] = [];
    for (const a of Array.isArray(parsed.add) ? parsed.add : []) {
      const id = String(a.id ?? "");
      if (!id) continue;
      const how = a.how === "call" ? "call" : "here";
      add.push({ id, how });
    }
    const remove: string[] = [];
    if (Array.isArray(parsed.remove)) {
      for (const r of parsed.remove) {
        const id = String(r ?? "");
        if (id && legal.has(id) && !remove.includes(id)) remove.push(id);
      }
    }
    return { acts, add, remove, parseError: false };
  } catch {
    return { acts: [], add: [], remove: [], parseError: true };
  }
}

export function parseActs(raw: string, legal: Set<string>): { id: string; guidance: string; why?: string }[] {
  return parseDirector(raw, legal).acts;
}

export interface CharacterBeat {
  speech: string;
  action?: string;
  deltas: RoleplayDeltas;
  parseError?: boolean;
  move?: { buildingId?: string; room?: string; floor?: number };
  call?: { npcId: string };
  task?: { steps: TaskStep[] };
}

export function parseCharacter(raw: string): CharacterBeat {
  const candidate = extractJsonObject(raw);
  if (!candidate) return { speech: "", deltas: {}, parseError: true };
  try {
    const parsed = JSON.parse(candidate) as {
      speech?: unknown;
      action?: unknown;
      deltas?: RoleplayDeltas;
      move?: unknown;
      call?: unknown;
      task?: unknown;
    };
    const speech = typeof parsed.speech === "string" ? parsed.speech.slice(0, 800) : "";
    // If speech itself looks like JSON, treat as parse failure — never paint {...} in the thread.
    if (speech && looksLikeJson(speech)) return { speech: "", deltas: {}, parseError: true };
    const action = typeof parsed.action === "string" && parsed.action.trim() ? parsed.action.slice(0, 200) : undefined;
    const d = parsed.deltas ?? {};
    const deltas: RoleplayDeltas = { ...(d as object) };
    delete (deltas as { location?: unknown }).location;
    if (!speech && !action) return { speech: "", action: undefined, deltas, parseError: true };
    const out: CharacterBeat = { speech, action, deltas };
    if (parsed.move && typeof parsed.move === "object") {
      const m = parsed.move as { buildingId?: unknown; room?: unknown; floor?: unknown };
      const move: { buildingId?: string; room?: string; floor?: number } = {};
      if (typeof m.buildingId === "string" && m.buildingId) move.buildingId = m.buildingId;
      if (typeof m.room === "string" && m.room) move.room = m.room.slice(0, 80);
      if (typeof m.floor === "number" && Number.isFinite(m.floor)) move.floor = Math.round(m.floor);
      if (move.buildingId || move.room) out.move = move;
    }
    if (parsed.call && typeof parsed.call === "object") {
      const c = parsed.call as { npcId?: unknown };
      if (typeof c.npcId === "string" && c.npcId) out.call = { npcId: c.npcId };
    }
    if (parsed.task && typeof parsed.task === "object") {
      const t = parsed.task as { steps?: unknown };
      if (Array.isArray(t.steps)) {
        const steps = (t.steps as unknown[]).slice(0, 8).filter((s) => s && typeof s === "object") as TaskStep[];
        if (steps.length) out.task = { steps };
      }
    }
    return out;
  } catch {
    // Never copy raw JSON into speech. Raw lives in /debug.
    return { speech: "", deltas: {}, parseError: true };
  }
}
