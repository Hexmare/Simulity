import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { snapshotNpc, applyDeltas, describeLoc, appendWitnessMemory, queueTask } from "@/sim/ai";
import { describeWorn } from "@/sim/clothing";
import { chatCompletions, type ChatResult } from "@/lib/llm/chat";
import { compileBook } from "@/lib/llm/prompts";
import { buildMessages, type ChatMessage } from "@/lib/llm/packer";
import { defaultBundle, readBundle, resolveEffective, type LlmBundle } from "@/lib/server/profiles";
import type { Session } from "@/lib/server/session";
import { parseDirector, parseCharacter } from "@/lib/llm/scene-parse";
import type { ChatTurn, DirectorAct, Presence } from "@/lib/protocol";
import type { ChatConnection } from "@/lib/llm/chat";
import { recordLlmTrace } from "@/lib/server/llm-trace";

export { parseDirector, parseCharacter };
export const parseActs = (raw: string, legal: Set<string>) => parseDirector(raw, legal).acts;

const Scene = Annotation.Root({
  playerLine: Annotation<string>,
  acts: Annotation<{ id: string; guidance: string }[]>,
  alreadyActed: Annotation<string[]>,
  pass: Annotation<1 | 2>,
  stop: Annotation<boolean>,
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
  // Presented to other souls: appearance + one wearing line. A concealed soul's
  // ancestry (and secrets / private narrative) never leaks into another pack.
  const card: Record<string, unknown> = {
    id: n.id,
    name: n.name,
    presence,
    job,
    home,
    age: n.age,
    mood: Math.round(n.bb.mood),
    goal,
    loc: describeLoc(w, n),
    public: n.narrative.public.slice(0, 240),
    appearance: (n.appearance ?? "").slice(0, 240),
    wearing: describeWorn(w.defs, w.clothing, n),
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
  };
  if (!n.concealed) card.ancestry = w.defs.ancestries[n.ancestryId]?.label;
  return JSON.stringify(card);
}

function failRound(session: Session, agent: "director" | "character", error: string, attempts: number, id?: string) {
  const failed = { agent, id, error, attempts };
  session.scene.failed = failed;
  if (session.round) session.round.failed = failed;
  session.scene.status = { phase: "failed", error };
  session.scene.running = false;
  session.broadcast({ type: "scene", status: session.scene.status, error, failed });
}

function clearFailure(session: Session) {
  session.scene.failed = null;
  if (session.round) session.round.failed = null;
}

async function completeWithRetry(
  complete: Completer,
  conn: ChatConnection,
  messages: ChatMessage[],
  eff: { maxOutputTokens: number; timeoutMs: number; maxRetries: number },
  signal: AbortSignal,
): Promise<{ res: ChatResult; attempts: number }> {
  const maxRetries = typeof eff.maxRetries === "number" ? eff.maxRetries : 2;
  const timeoutMs = typeof eff.timeoutMs === "number" ? eff.timeoutMs : 45000;
  let attempts = 0;
  let last: ChatResult = { ok: false, error: "No attempt." };
  for (let i = 0; i <= maxRetries; i++) {
    if (signal.aborted) break;
    attempts++;
    last = await complete(conn, messages, { maxTokens: eff.maxOutputTokens, timeoutMs, signal });
    if (last.ok) return { res: last, attempts };
  }
  return { res: last, attempts };
}

/**
 * Witness-filtered scene slice with the role split (Scene spec §5.3):
 * this soul is the only `assistant`; the PC and every other soul are `user`
 * beats prefixed `Name:`. Chronological; the latest player line stays the last
 * user beat — never appended again.
 */
function witnessedHistory(session: Session, soulId: string): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  const soulName = session.world?.npc(soulId)?.name;
  for (const h of session.scene.history) {
    const w = h.witnesses;
    // Beats without a witness list predate the cursor: include (back-compat).
    if (w && w.length > 0 && !w.includes(soulId)) continue;
    const line = `${h.speaker ?? ""}: ${h.content}${h.action ? ` (${h.action})` : ""}`;
    // This soul's own beats are the only `assistant` turns. Pre-cursor beats
    // without a speakerId fall back to a name match.
    const mine = h.speakerId ? h.speakerId === soulId : soulName != null && h.speaker === soulName;
    if (mine) out.push({ role: "assistant", content: line });
    else out.push({ role: "user", content: line });
  }
  return out;
}

async function directorCall(
  session: Session,
  playerLine: string,
  pass: 1 | 2,
  alreadyActed: string[],
  signal: AbortSignal,
  deps: RoundDeps,
): Promise<{ acts: DirectorAct[]; failed: boolean }> {
  const w = session.world!;
  const bundle = deps.bundle ?? (await readBundle());
  const complete = deps.complete ?? chatCompletions;
  const eff = resolveEffective(bundle, "director");
  const legal = new Set(session.scene.ids);
  const remaining = session.scene.ids.filter((id) => !alreadyActed.includes(id));
  session.scene.status = { phase: "director", pass };
  session.broadcast({ type: "scene", status: session.scene.status });
  const roster = session.scene.ids.map((id) => compactCard(session, id)).join("\n");
  const thread = session.scene.history.map((h) => `${h.speaker ?? h.role}: ${h.content}`).join("\n");
  const compiled = compileBook(eff.prompts, {
    setting: w.settingBible,
    pcCard: compactCard(session, "pc"),
    roster,
    alreadyActed: alreadyActed.join(", ") || "(none)",
    pass: String(pass),
    snapshot: thread,
    name: "Director",
    ancestry: "",
    job: "",
    narrative: { public: "", private: "", voice: "" },
  });
  // The thread snapshot already ends with the player line on the Speak path;
  // do not duplicate it as a trailer. Retry / direct rounds without the line
  // in the thread still carry it.
  const lastThread = session.scene.history.at(-1);
  const threadEndsWithLine = !!lastThread && lastThread.speakerId === "pc" && lastThread.content === playerLine;
  const packed = buildMessages({
    book: eff.prompts,
    name: "Director",
    setting: w.settingBible,
    narrative: { public: compiled.character, private: "", voice: "" },
    ancestry: "",
    job: "",
    liveJson: compiled.live,
    history: [],
    message: threadEndsWithLine ? "" : playerLine,
    budget: eff,
  });
  packed.messages[0] = { role: "system", content: compiled.system };
  packed.messages[1] = { role: "user", content: compiled.character };
  packed.messages[2] = { role: "user", content: compiled.live };
  const started = Date.now();
  const { res, attempts } = await completeWithRetry(complete, eff, packed.messages, eff, signal);
  // A reply that already arrived is processed even when aborted; the abort
  // only stops *further* calls (checked between acts in runSceneRound).
  // A transport failure concurrent with cancel is not a new round failure.
  if (signal.aborted && !res.ok) return { acts: [], failed: true };
  if (!res.ok) {
    recordLlmTrace({
      agent: "director",
      label: `Director pass ${pass}`,
      model: eff.model,
      temperature: eff.temperature,
      maxTokens: eff.maxOutputTokens,
      messages: packed.messages,
      response: null,
      ok: false,
      error: res.error,
      latencyMs: Date.now() - started,
      parsed: { acts: [] },
    });
    session.scene.debug = { pass, acts: [], error: res.error };
    failRound(session, "director", res.error, attempts);
    return { acts: [], failed: true };
  }
  const pool = pass === 2 ? new Set(remaining) : legal;
  const parsed = parseDirector(res.text, pool);
  if (signal.aborted) return { acts: [], failed: true };
  if (parsed.parseError) {
    recordLlmTrace({
      agent: "director",
      label: `Director pass ${pass}`,
      model: eff.model,
      temperature: eff.temperature,
      maxTokens: eff.maxOutputTokens,
      messages: packed.messages,
      response: res.text,
      ok: false,
      error: "Director returned unparseable JSON.",
      latencyMs: res.latencyMs,
      parsed: { acts: [] },
    });
    session.scene.debug = { pass, acts: [], error: "Director returned unparseable JSON." };
    failRound(session, "director", "Director returned unparseable JSON.", attempts);
    return { acts: [], failed: true };
  }
  // Apply remove/add before the Character loop of this pass.
  const { addToScene } = await import("@/lib/server/intents");
  for (const id of parsed.remove) {
    if (!session.scene.ids.includes(id)) continue;
    w.endRoleplay(id);
    session.scene.ids = session.scene.ids.filter((x) => x !== id);
    delete session.scene.presence[id];
  }
  for (const a of parsed.add) {
    if (session.scene.ids.includes(a.id)) continue;
    const target = w.npc(a.id);
    if (!target || target.kind === "pc") continue;
    if (a.how === "here") {
      if (!w.isHere(a.id)) continue;
      addToScene(session, a.id, "here");
    } else {
      if (w.isHere(a.id)) continue;
      addToScene(session, a.id, "called");
    }
  }
  const legalNow = new Set(session.scene.ids);
  const acts: DirectorAct[] = parsed.acts.filter((a) => legalNow.has(a.id) && !alreadyActed.includes(a.id));
  recordLlmTrace({
    agent: "director",
    label: `Director pass ${pass}`,
    model: eff.model,
    temperature: eff.temperature,
    maxTokens: eff.maxOutputTokens,
    messages: packed.messages,
    response: res.text,
    ok: true,
    error: acts.length === 0 ? "No legal acts parsed (treated as silence)." : null,
    latencyMs: res.latencyMs,
    parsed: { acts },
  });
  session.scene.debug = {
    pass,
    acts,
    raw: res.text.slice(0, 2000),
    error: acts.length === 0 ? `Director returned no legal acts. Raw: ${res.text.slice(0, 240)}` : undefined,
  };
  session.broadcast({ type: "scene", status: session.scene.status, debug: session.scene.debug });
  return { acts, failed: false };
}

async function characterCall(
  session: Session,
  act: { id: string; guidance: string },
  playerLine: string,
  signal: AbortSignal,
  deps: RoundDeps,
): Promise<{ ok: boolean; aborted: boolean }> {
  const w = session.world!;
  const bundle = deps.bundle ?? (await readBundle());
  const complete = deps.complete ?? chatCompletions;
  const eff = resolveEffective(bundle, "character");
  const npc = w.npc(act.id);
  if (!npc) return { ok: true, aborted: false };
  session.scene.status = { phase: "character", id: npc.id, name: npc.name };
  session.broadcast({ type: "scene", status: session.scene.status });
  const snapFull = snapshotNpc(w, npc) as Record<string, unknown>;
  const presence = session.scene.presence[act.id] ?? "here";
  // Witness-filtered scene slice + this soul's memory only. Memory travels as
  // `[memory] Name: …` user lines ahead of the live slice, so it stays out of
  // the JSON snapshot (no duplication, never another soul's memory).
  const { recent: _recent, ...snapMem } = snapFull;
  void _recent;
  const hist = witnessedHistory(session, act.id);
  const memTail = (npc.bb.memory ?? []).slice(-8).map((m) => ({ role: "user" as const, content: `[memory] ${m.speakerName}: ${m.content}` }));
  const history = [...memTail, ...hist];
  const compiled = compileBook(eff.prompts, {
    name: npc.name,
    setting: w.settingBible,
    narrative: npc.narrative,
    ancestry: w.defs.ancestries[npc.ancestryId]?.label ?? "",
    job: w.defs.jobs[npc.bb.jobId]?.label ?? "",
    snapshot: JSON.stringify(snapMem),
    guidance: act.guidance,
    presence,
    pcCard: compactCard(session, "pc"),
    roster: session.scene.ids.filter((id) => id !== act.id).map((id) => compactCard(session, id)).join("\n"),
  });
  const packed = buildMessages({
    book: eff.prompts,
    name: npc.name,
    setting: w.settingBible,
    narrative: npc.narrative,
    ancestry: w.defs.ancestries[npc.ancestryId]?.label ?? "",
    job: w.defs.jobs[npc.bb.jobId]?.label ?? "",
    liveJson: JSON.stringify({ ...snapMem, guidance: act.guidance, presence }),
    // The latest player line already sits in this history on the Speak path
    // (pushed to the scene thread first) — for every soul, including souls who
    // act after an earlier beat. The packer never appends it twice, so retry
    // rebuilds the identical pack.
    history,
    message: playerLine.trim() && history.some((h) => h.role === "user" && h.content.endsWith(playerLine)) ? "" : playerLine,
    budget: eff,
  });
  packed.messages[0] = { role: "system", content: compiled.system };
  if (packed.messages[1]) packed.messages[1] = { role: "user", content: compiled.character };
  if (packed.messages[2]) packed.messages[2] = { role: "user", content: compiled.live };
  const started = Date.now();
  const { res, attempts } = await completeWithRetry(complete, eff, packed.messages, eff, signal);
  // A reply that already arrived is processed even when aborted; the abort
  // only stops *further* calls (checked between acts in runSceneRound).
  // A transport failure concurrent with cancel is not a new round failure.
  if (signal.aborted && !res.ok) return { ok: false, aborted: true };
  if (!res.ok) {
    recordLlmTrace({
      agent: "character",
      label: `${npc.name} (${npc.id})`,
      model: eff.model,
      temperature: eff.temperature,
      maxTokens: eff.maxOutputTokens,
      messages: packed.messages,
      response: null,
      ok: false,
      error: res.error,
      latencyMs: Date.now() - started,
      parsed: null,
    });
    failRound(session, "character", res.error, attempts, npc.id);
    return { ok: false, aborted: false };
  }
  const beat = parseCharacter(res.text);
  if (signal.aborted && beat.parseError) return { ok: false, aborted: true };
  if (beat.parseError) {
    recordLlmTrace({
      agent: "character",
      label: `${npc.name} (${npc.id})`,
      model: eff.model,
      temperature: eff.temperature,
      maxTokens: eff.maxOutputTokens,
      messages: packed.messages,
      response: res.text,
      ok: false,
      error: "Character returned unparseable JSON.",
      latencyMs: res.latencyMs,
      parsed: null,
    });
    failRound(session, "character", "Character returned unparseable JSON.", attempts, npc.id);
    return { ok: false, aborted: false };
  }
  recordLlmTrace({
    agent: "character",
    label: `${npc.name} (${npc.id})`,
    model: eff.model,
    temperature: eff.temperature,
    maxTokens: eff.maxOutputTokens,
    messages: packed.messages,
    response: res.text,
    ok: true,
    error: null,
    latencyMs: res.latencyMs,
    parsed: beat,
  });
  applyDeltas(w, npc, beat.deltas);
  // Character clothing: same ops as MCP. Invalid ops drop and trace.
  if (beat.clothing) {
    const clothingError = w.applyClothingOp(npc.id, beat.clothing);
    if (clothingError) {
      w.log({
        type: "note",
        actorId: npc.id,
        buildingId: npc.loc.buildingId,
        summary: `${npc.name} fumbles with their garments (${clothingError}).`,
        source: "llm",
      });
    }
  }
  const summary = (beat.speech || beat.action || `${npc.name} is present.`).slice(0, 240);
  w.log({
    type: "talk",
    actorId: npc.id,
    targetId: "pc",
    buildingId: npc.loc.buildingId,
    summary,
    source: "llm",
  });
  const witnesses = session.currentWitnesses();
  const turn: ChatTurn = {
    role: "assistant",
    speaker: npc.name,
    speakerId: npc.id,
    content: beat.speech,
    action: beat.action,
    presence,
    witnesses,
  };
  // Empty speech + action → show (action). Empty both → no bubble (but still acted).
  if (turn.content || turn.action) {
    session.scene.history.push(turn);
    session.broadcast({ type: "scene", status: session.scene.status, beat: turn });
  } else {
    session.scene.history.push(turn);
    session.broadcast({ type: "scene", status: session.scene.status, beat: turn });
  }
  appendWitnessMemory(w, witnesses, { speakerId: npc.id, speakerName: npc.name, content: summary, action: beat.action, presence });
  // Character move: only self, same functions as MCP.
  if (beat.move) {
    const r = session.moveSoul(npc.id, { buildingId: beat.move.buildingId, room: beat.move.room, floor: beat.move.floor });
    w.log({
      type: r.ok ? "move" : "note",
      actorId: npc.id,
      buildingId: npc.loc.buildingId,
      summary: r.ok ? `${npc.name} heads toward ${r.label}.` : `${npc.name} stays put.`,
      source: "llm",
    });
  }
  // Character call: same rules as the Call button.
  if (beat.call) {
    const target = w.npc(beat.call.npcId);
    if (target && target.kind !== "pc" && !session.scene.ids.includes(target.id) && !w.isHere(target.id)) {
      session.callSoul(target.id);
      w.log({ type: "call", actorId: npc.id, targetId: target.id, summary: `${npc.name} calls ${target.name}.`, source: "llm" });
    }
  }
  // Character task: assigned to self only.
  if (beat.task) {
    queueTask(w, npc.id, beat.task.steps as never);
  }
  clearFailure(session);
  if (session.round) session.round.failed = null;
  session.broadcastDelta();
  return { ok: true, aborted: false };
}

/** Sequential Character loop shared by both passes. Stops the graph on failure. */
async function characterLoop(
  session: Session,
  state: typeof Scene.State,
  signal: AbortSignal,
  local: RoundDeps,
): Promise<Partial<typeof Scene.State>> {
  const round = session.round!;
  const acted = [...state.alreadyActed];
  let acts = [...state.acts];
  for (const act of [...acts]) {
    if (signal.aborted || state.stop) break;
    if (acted.includes(act.id)) continue;
    if (!session.scene.ids.includes(act.id)) continue;
    const r = await characterCall(session, act, state.playerLine, signal, local);
    if (!r.ok || r.aborted) break; // failed → stop the graph; do not run the next act
    acted.push(act.id);
    acts = acts.filter((a) => a.id !== act.id);
    round.alreadyActed = [...acted];
    round.acts = [...acts];
  }
  const stopped = signal.aborted || !!session.scene.failed;
  return { alreadyActed: acted, acts, stop: stopped };
}

export async function runSceneRound(session: Session, playerLine: string, signal: AbortSignal, deps: RoundDeps = {}, isRetry = false) {
  if (!session.world) return;
  const bundle = deps.bundle ?? (await readBundle().catch(() => defaultBundle()));
  const local: RoundDeps = { ...deps, bundle };
  if (!isRetry) {
    session.round = { playerLine, pass: 1, acts: [], alreadyActed: [], failed: null };
  }
  const round = session.round!;
  round.playerLine = isRetry ? round.playerLine : playerLine;

  // Retry pre-step: re-run ONLY the failed call. Success resumes the graph below.
  if (isRetry && round.failed) {
    const f = round.failed;
    if (f.agent === "director") {
      const d = await directorCall(session, round.playerLine, round.pass, round.alreadyActed, signal, local);
      if (d.failed) return;
      round.acts = d.acts;
      round.failed = null;
      session.scene.failed = null;
    } else if (f.agent === "character" && f.id) {
      const act = round.acts.find((a) => a.id === f.id);
      if (act) {
        const r = await characterCall(session, act, round.playerLine, signal, local);
        if (!r.ok) return;
        round.alreadyActed.push(act.id);
        round.acts = round.acts.filter((a) => a.id !== act.id);
        round.failed = null;
        session.scene.failed = null;
      } else {
        round.failed = null;
        session.scene.failed = null;
      }
    } else {
      round.failed = null;
      session.scene.failed = null;
    }
  }

  // Server-side round graph: Director → Character queue → conditional
  // Director-2 (skipped when everyone acted) → Character queue → END.
  // Sequential on purpose: later beats see earlier ones. The client never
  // sequences completions.
  const graph = new StateGraph(Scene)
    .addNode("director1", async (s) => {
      if (s.stop) return {};
      const d = await directorCall(session, s.playerLine, 1, s.alreadyActed, signal, local);
      if (d.failed) return { stop: true };
      round.pass = 1;
      round.acts = d.acts;
      return { acts: d.acts, pass: 1 as const };
    })
    .addNode("chars1", async (s) => characterLoop(session, s, signal, local))
    .addNode("maybe2", async (s) => {
      if (s.stop) return {};
      const remaining = session.scene.ids.filter((id) => !s.alreadyActed.includes(id));
      if (remaining.length === 0 || signal.aborted) {
        round.pass = 2;
        return { pass: 2 as const, acts: [] as { id: string; guidance: string }[] };
      }
      if (round.pass === 2) return { acts: [...round.acts] }; // retry after a pass-2 failure: keep leftovers
      const d = await directorCall(session, s.playerLine, 2, s.alreadyActed, signal, local);
      if (d.failed) return { stop: true };
      round.pass = 2;
      round.acts = d.acts.filter((a) => !s.alreadyActed.includes(a.id));
      return { acts: round.acts, pass: 2 as const };
    })
    .addNode("chars2", async (s) => characterLoop(session, s, signal, local))
    .addConditionalEdges(START, () => (isRetry ? "chars1" : "director1"))
    .addEdge("director1", "chars1")
    .addEdge("chars1", "maybe2")
    .addEdge("maybe2", "chars2")
    .addEdge("chars2", END)
    .compile();

  try {
    await graph.invoke(
      { playerLine: round.playerLine, acts: [...round.acts], alreadyActed: [...round.alreadyActed], pass: round.pass, stop: false },
      { signal },
    );
  } catch (err) {
    if (signal.aborted) return;
    throw err;
  }
}
