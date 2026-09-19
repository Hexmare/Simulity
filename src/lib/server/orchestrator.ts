import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { snapshotNpc, applyDeltas, describeLoc } from "@/sim/ai";
import { chatCompletions, type ChatResult } from "@/lib/llm/chat";
import { compileBook } from "@/lib/llm/prompts";
import { buildMessages, type ChatMessage } from "@/lib/llm/packer";
import { defaultBundle, readBundle, resolveEffective, type LlmBundle } from "@/lib/server/profiles";
import type { Session } from "@/lib/server/session";
import { parseActs, parseCharacter } from "@/lib/llm/scene-parse";
import type { ChatTurn, DirectorAct, Presence } from "@/lib/protocol";
import type { ChatConnection } from "@/lib/llm/chat";

export { parseActs, parseCharacter };

const Scene = Annotation.Root({
  playerLine: Annotation<string>,
  acts: Annotation<{ id: string; guidance: string }[]>,
  alreadyActed: Annotation<string[]>,
  pass: Annotation<1 | 2>,
});

export type Completer = (
  conn: ChatConnection,
  messages: ChatMessage[],
  opts?: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatResult>;

export type RoundDeps = {
  complete?: Completer;
  bundle?: LlmBundle;
};

export function compactCard(session: Session, id: string): string {
  const w = session.world!;
  const n = id === "pc" ? w.player : w.npc(id);
  if (!n) return "";
  const presence: Presence | "here" = id === "pc" ? "here" : (session.scene.presence[id] ?? "here");
  const job = w.defs.jobs[n.bb.jobId]?.label ?? "";
  const home = w.building(n.bb.homeId)?.name ?? "";
  const goal = w.defs.goals.find((g) => g.id === n.bb.goalId)?.label ?? "";
  const rel = n.relationships.pc ?? n.relationships[w.player.id];
  const last = [...session.scene.history].reverse().find((h) => h.speaker === n.name);
  return JSON.stringify({
    id: n.id,
    name: n.name,
    presence,
    job,
    home,
    age: n.age,
    ancestry: w.defs.ancestries[n.ancestryId]?.label,
    mood: Math.round(n.bb.mood),
    goal,
    loc: describeLoc(w, n),
    public: n.narrative.public.slice(0, 240),
    relToPc: rel
      ? {
          friendship: rel.friendship,
          romance: rel.romance,
          trust: rel.trust,
          grudge: rel.grudge,
          familiarity: rel.familiarity,
        }
      : null,
    lastBeat: last ? { content: last.content, action: last.action } : null,
  });
}

async function directorNode(session: Session, state: typeof Scene.State, deps: RoundDeps, signal: AbortSignal) {
  const w = session.world!;
  const bundle = deps.bundle ?? (await readBundle());
  const complete = deps.complete ?? chatCompletions;
  const eff = resolveEffective(bundle, "director");
  const legal = new Set(session.scene.ids);
  const remaining = session.scene.ids.filter((id) => !state.alreadyActed.includes(id));
  session.scene.status = { phase: "director", pass: state.pass };
  session.broadcast({ type: "scene", status: session.scene.status });
  const roster = session.scene.ids.map((id) => compactCard(session, id)).join("\n");
  const compiled = compileBook(eff.prompts, {
    setting: w.settingBible,
    pcCard: compactCard(session, "pc"),
    roster,
    alreadyActed: state.alreadyActed.join(", ") || "(none)",
    pass: String(state.pass),
    snapshot: session.scene.history.map((h) => `${h.speaker ?? h.role}: ${h.content}`).join("\n"),
    name: "Director",
    ancestry: "",
    job: "",
    narrative: { public: "", private: "", voice: "" },
  });
  const packed = buildMessages({
    book: eff.prompts,
    name: "Director",
    setting: w.settingBible,
    narrative: { public: compiled.character, private: "", voice: "" },
    ancestry: "",
    job: "",
    liveJson: compiled.live,
    history: [],
    message: state.playerLine,
    budget: eff,
  });
  packed.messages[0] = { role: "system", content: compiled.system };
  const res = await complete(eff, packed.messages, { maxTokens: eff.maxOutputTokens, timeoutMs: 45000, signal });
  if (!res.ok) {
    session.scene.debug = { pass: state.pass, acts: [] };
    session.broadcast({ type: "scene", status: session.scene.status, error: res.error, debug: session.scene.debug });
    return { acts: [] as { id: string; guidance: string }[] };
  }
  const pool = state.pass === 2 ? new Set(remaining) : legal;
  const acts: DirectorAct[] = parseActs(res.text, pool).filter((a) => !state.alreadyActed.includes(a.id));
  session.scene.debug = { pass: state.pass, acts };
  session.broadcast({ type: "scene", status: session.scene.status, debug: session.scene.debug });
  return { acts };
}

async function characterLoop(session: Session, state: typeof Scene.State, signal: AbortSignal, deps: RoundDeps) {
  const w = session.world!;
  const bundle = deps.bundle ?? (await readBundle());
  const complete = deps.complete ?? chatCompletions;
  const eff = resolveEffective(bundle, "character");
  const acted = [...state.alreadyActed];
  for (const act of state.acts) {
    if (signal.aborted) break;
    if (acted.includes(act.id)) continue;
    const npc = w.npc(act.id);
    if (!npc) continue;
    session.scene.status = { phase: "character", id: npc.id, name: npc.name };
    session.broadcast({ type: "scene", status: session.scene.status });
    const snap = snapshotNpc(w, npc);
    const presence = session.scene.presence[act.id] ?? "here";
    const compiled = compileBook(eff.prompts, {
      name: npc.name,
      setting: w.settingBible,
      narrative: npc.narrative,
      ancestry: w.defs.ancestries[npc.ancestryId]?.label ?? "",
      job: w.defs.jobs[npc.bb.jobId]?.label ?? "",
      snapshot: JSON.stringify(snap),
      guidance: act.guidance,
      presence,
      pcCard: compactCard(session, "pc"),
      roster: session.scene.ids.filter((id) => id !== act.id).map((id) => compactCard(session, id)).join("\n"),
    });
    const hist = session.scene.history.map((h) => ({
      role: h.role,
      content: `${h.speaker ?? ""}: ${h.content}`,
    }));
    const packed = buildMessages({
      book: eff.prompts,
      name: npc.name,
      setting: w.settingBible,
      narrative: npc.narrative,
      ancestry: w.defs.ancestries[npc.ancestryId]?.label ?? "",
      job: w.defs.jobs[npc.bb.jobId]?.label ?? "",
      liveJson: JSON.stringify({ ...snap, guidance: act.guidance, presence }),
      history: hist,
      message: state.playerLine,
      budget: eff,
    });
    packed.messages[0] = { role: "system", content: compiled.system };
    if (packed.messages[1]) packed.messages[1] = { role: "user", content: compiled.character };
    if (packed.messages[2]) packed.messages[2] = { role: "user", content: compiled.live };
    const res = await complete(eff, packed.messages, { maxTokens: eff.maxOutputTokens, timeoutMs: 45000, signal });
    acted.push(act.id);
    if (!res.ok) {
      session.broadcast({ type: "scene", status: session.scene.status, error: res.error });
      continue;
    }
    const beat = parseCharacter(res.text);
    applyDeltas(w, npc, beat.deltas);
    const summary = (beat.speech || beat.action || `${npc.name} is present.`).slice(0, 240);
    w.log({
      type: "talk",
      actorId: npc.id,
      targetId: "pc",
      buildingId: npc.loc.buildingId,
      summary,
      source: "llm",
    });
    const turn: ChatTurn = {
      role: "assistant",
      speaker: npc.name,
      content: beat.speech,
      action: beat.action,
      presence,
    };
    session.scene.history.push(turn);
    session.broadcast({ type: "scene", status: session.scene.status, beat: turn });
  }
  return { alreadyActed: acted, acts: [] as { id: string; guidance: string }[] };
}

export async function runSceneRound(session: Session, playerLine: string, signal: AbortSignal, deps: RoundDeps = {}) {
  if (!session.world) return;
  const bundle = deps.bundle ?? (await readBundle().catch(() => defaultBundle()));
  const local: RoundDeps = { ...deps, bundle };
  const graph = new StateGraph(Scene)
    .addNode("director1", async (s) => directorNode(session, { ...s, pass: 1 }, local, signal))
    .addNode("chars1", async (s) => characterLoop(session, s, signal, local))
    .addNode("maybe2", async (s) => {
      const remaining = session.scene.ids.filter((id) => !s.alreadyActed.includes(id));
      if (remaining.length === 0 || signal.aborted) return { acts: [], pass: 2 as const };
      return directorNode(session, { ...s, pass: 2 }, local, signal);
    })
    .addNode("chars2", async (s) => characterLoop(session, s, signal, local))
    .addEdge(START, "director1")
    .addEdge("director1", "chars1")
    .addEdge("chars1", "maybe2")
    .addEdge("maybe2", "chars2")
    .addEdge("chars2", END)
    .compile();

  try {
    await graph.invoke({ playerLine, acts: [], alreadyActed: [], pass: 1 }, { signal });
  } catch (err) {
    if (signal.aborted) return;
    throw err;
  }
}
