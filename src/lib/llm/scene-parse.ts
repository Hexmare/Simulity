import type { RoleplayDeltas, TaskStep } from "../../sim/types.ts";

function stripFences(raw: string): string {
  const text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fence ? fence[1]!.trim() : text;
}

export function extractJsonObject(raw: string): string | null {
  const text = stripFences(raw).replace(/^\uFEFF/, "");
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
  const blocks = balancedBlocks(text);
  if (blocks.length) return blocks[0]!;
  // Bare array: {"acts": [...]} wrapper missing.
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) return `{"acts":${text.slice(arrStart, arrEnd + 1)}}`;
  return null;
}

/** Every top-level balanced {...} block in order (string-aware). */
function balancedBlocks(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

/** Strict parse, then one lenient retry (trailing commas). Never throws. */
function tryParse(block: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(block) };
  } catch {
    try {
      return { ok: true, value: JSON.parse(block.replace(/,\s*([}\]])/g, "$1")) };
    } catch {
      return { ok: false };
    }
  }
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function parseDirector(
  raw: string,
  legal: Set<string>,
): { acts: { id: string; guidance: string; why?: string }[]; add: { id: string; how: "here" | "call" }[]; remove: string[]; parseError: boolean } {
  const candidate = extractJsonObject(raw);
  if (!candidate) return { acts: [], add: [], remove: [], parseError: true };
  const attempt = tryParse(candidate);
  if (!attempt.ok || !isPlainObject(attempt.value)) return { acts: [], add: [], remove: [], parseError: true };
  const parsed = attempt.value as {
    acts?: { id?: string; guidance?: string; why?: string }[];
    add?: { id?: string; how?: string }[];
    remove?: unknown;
  };
  const acts: { id: string; guidance: string; why?: string }[] = [];
  const seen = new Set<string>();
  for (const a of Array.isArray(parsed.acts) ? parsed.acts : []) {
    if (!isPlainObject(a)) continue;
    const id = typeof a.id === "string" ? a.id : String(a.id ?? "");
    if (!legal.has(id) || seen.has(id)) continue;
    seen.add(id);
    acts.push({
      id,
      guidance: typeof a.guidance === "string" ? a.guidance.slice(0, 400) : "",
      why: typeof a.why === "string" && a.why ? a.why.slice(0, 200) : undefined,
    });
  }
  const add: { id: string; how: "here" | "call" }[] = [];
  for (const a of Array.isArray(parsed.add) ? parsed.add : []) {
    if (!isPlainObject(a) || typeof a.id !== "string" || !a.id) continue;
    add.push({ id: a.id, how: a.how === "call" ? "call" : "here" });
  }
  const remove: string[] = [];
  if (Array.isArray(parsed.remove)) {
    for (const r of parsed.remove) {
      const id = typeof r === "string" ? r : String(r ?? "");
      if (id && legal.has(id) && !remove.includes(id)) remove.push(id);
    }
  }
  return { acts, add, remove, parseError: false };
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
  clothing?: { op: string; slot?: string; itemId?: string; to?: string };
}

/** Last resort: pull a "speech" string value out of otherwise-broken JSON. */
function salvageSpeech(raw: string): string | null {
  const text = stripFences(raw).replace(/^\uFEFF/, "");
  const m = text.match(/"speech"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    const s = JSON.parse(`"${m[1]}"`) as unknown;
    if (typeof s !== "string" || !s.trim() || looksLikeJson(s)) return null;
    return s.slice(0, 800);
  } catch {
    return null;
  }
}

function coerceText(v: unknown, max: number): string {
  if (typeof v === "string") return v.slice(0, max);
  if (typeof v === "number" && Number.isFinite(v)) return String(v).slice(0, max);
  if (typeof v === "boolean") return v ? "true" : "false";
  return "";
}

export function parseCharacter(raw: string): CharacterBeat {
  const text = stripFences(raw).replace(/^\uFEFF/, "");
  // Try every top-level object block; prefer ones shaped like a beat so a
  // reasoning preamble or example block cannot shadow the real reply.
  const blocks = balancedBlocks(text);
  const ordered = [...blocks].sort((a, b) => {
    const score = (s: string) => (/"speech"/.test(s) ? 0 : /"action"/.test(s) ? 1 : 2);
    return score(a) - score(b);
  });
  for (const block of ordered) {
    const attempt = tryParse(block);
    if (!attempt.ok) continue;
    let value = attempt.value;
    // A bare array reply: take the first object element.
    if (Array.isArray(value)) {
      const first = value.find(isPlainObject);
      if (!first) continue;
      value = first;
    }
    if (!isPlainObject(value)) continue;
    const beat = buildBeat(value);
    if (beat) return beat;
  }
  // Truncated or mangled JSON: salvage a speech string rather than failing the round.
  const salvaged = salvageSpeech(raw);
  if (salvaged) return { speech: salvaged, deltas: {} };
  // Never copy raw JSON into speech. Raw lives in /debug.
  return { speech: "", deltas: {}, parseError: true };
}

/**
 * Build a beat from a parsed object. Returns null when the shape is
 * unusable (so the caller tries the next block). Partial shapes are
 * accepted: missing deltas default to {}, and a deltas-/move-/call-/task-only
 * beat counts as acted with no bubble.
 */
function buildBeat(parsed: Record<string, unknown>): CharacterBeat | null {
  let speech = coerceText(parsed.speech, 800);
  // A "Name: dialogue" reply broke the output contract — never paint it.
  // Strip the prefix when it is clearly a name tag; a speech that still looks
  // like JSON after that is a parse failure.
  const prefixed = speech.match(/^[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3}\s*:\s*([\s\S]+)$/);
  if (prefixed && !/"speech"\s*:/.test(speech)) speech = prefixed[1]!.trim().slice(0, 800);
  if (speech && looksLikeJson(speech)) return null;
  const actionRaw = coerceText(parsed.action, 200);
  const action = actionRaw.trim() ? actionRaw : undefined;
  const d = isPlainObject(parsed.deltas) ? (parsed.deltas as RoleplayDeltas) : {};
  const deltas: RoleplayDeltas = { ...d };
  delete (deltas as { location?: unknown }).location;
  const out: CharacterBeat = { speech, action, deltas };
  if (isPlainObject(parsed.move)) {
    const m = parsed.move as { buildingId?: unknown; room?: unknown; floor?: unknown };
    const move: { buildingId?: string; room?: string; floor?: number } = {};
    if (typeof m.buildingId === "string" && m.buildingId) move.buildingId = m.buildingId;
    if (typeof m.room === "string" && m.room) move.room = m.room.slice(0, 80);
    if (typeof m.floor === "number" && Number.isFinite(m.floor)) move.floor = Math.round(m.floor);
    if (move.buildingId || move.room) out.move = move;
  }
  if (isPlainObject(parsed.call)) {
    const c = parsed.call as { npcId?: unknown };
    if (typeof c.npcId === "string" && c.npcId) out.call = { npcId: c.npcId };
  }
  if (isPlainObject(parsed.task)) {
    const t = parsed.task as { steps?: unknown };
    if (Array.isArray(t.steps)) {
      const steps = t.steps.slice(0, 8).filter(isPlainObject) as unknown as TaskStep[];
      if (steps.length) out.task = { steps };
    }
  }
  if (isPlainObject(parsed.clothing)) {
    const c = parsed.clothing as { op?: unknown; slot?: unknown; itemId?: unknown; to?: unknown };
    const op = typeof c.op === "string" ? c.op : "";
    if (op === "wear" || op === "remove" || op === "take" || op === "store") {
      const clothing: { op: string; slot?: string; itemId?: string; to?: string } = { op };
      if (typeof c.slot === "string" && c.slot) clothing.slot = c.slot.slice(0, 40);
      if (typeof c.itemId === "string" && c.itemId) clothing.itemId = c.itemId.slice(0, 80);
      if (typeof c.to === "string" && c.to) clothing.to = c.to.slice(0, 12);
      out.clothing = clothing;
    }
  }
  const hasDeltas = Object.keys(deltas).length > 0;
  if (!speech && !action && !hasDeltas && !out.move && !out.call && !out.task && !out.clothing) return null;
  return out;
}
