import type { RoleplayDeltas } from "../../sim/types.ts";

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

export function parseActs(raw: string, legal: Set<string>): { id: string; guidance: string; why?: string }[] {
  const candidate = extractJsonObject(raw) ?? raw.trim();
  try {
    const parsed = JSON.parse(candidate) as { acts?: { id?: string; guidance?: string; why?: string }[] };
    const acts = Array.isArray(parsed.acts) ? parsed.acts : [];
    const seen = new Set<string>();
    const out: { id: string; guidance: string; why?: string }[] = [];
    for (const a of acts) {
      const id = String(a.id ?? "");
      if (!legal.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, guidance: String(a.guidance ?? "").slice(0, 400), why: a.why ? String(a.why).slice(0, 200) : undefined });
    }
    return out;
  } catch {
    return [];
  }
}

export function parseCharacter(raw: string): { speech: string; action?: string; deltas: RoleplayDeltas } {
  const text = extractJsonObject(raw) ?? raw.trim();
  try {
    const parsed = JSON.parse(text) as { speech?: unknown; action?: unknown; deltas?: RoleplayDeltas };
    const speech = String(parsed.speech ?? "").slice(0, 800);
    const action = typeof parsed.action === "string" ? parsed.action.slice(0, 200) : undefined;
    const d = parsed.deltas ?? {};
    const deltas: RoleplayDeltas = { ...d };
    delete (deltas as { location?: unknown }).location;
    return { speech, action, deltas };
  } catch {
    return { speech: raw.slice(0, 800), deltas: {} };
  }
}
