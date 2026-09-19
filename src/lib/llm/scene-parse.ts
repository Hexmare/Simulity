import type { RoleplayDeltas } from "../../sim/types.ts";

export function parseActs(raw: string, legal: Set<string>): { id: string; guidance: string; why?: string }[] {
  try {
    const text = raw.trim().replace(/^```json\s*|\s*```$/g, "");
    const parsed = JSON.parse(text) as { acts?: { id?: string; guidance?: string; why?: string }[] };
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
  const text = raw.trim().replace(/^```json\s*|\s*```$/g, "");
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
