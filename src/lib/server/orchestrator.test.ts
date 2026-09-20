import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultBundle } from "../llm/bundle.ts";
import type { Completer } from "./orchestrator.ts";
import { compactCard, runSceneRound } from "./orchestrator.ts";
import { Session } from "./session.ts";
import { World } from "../../sim/world.ts";

function liveSession(n = 2) {
  const session = new Session();
  const world = new World(1742);
  session.world = world;
  const ids = world.npcs.slice(0, n).map((npc) => npc.id);
  for (const id of ids) world.startRoleplay(id);
  session.scene.ids = ids;
  session.scene.presence = Object.fromEntries(ids.map((id) => [id, "here" as const]));
  return { session, world, ids };
}

function queued(replies: string[]): Completer {
  let i = 0;
  return async (_conn, _messages) => {
    const text = replies[i++] ?? `{"acts":[]}`;
    return { ok: true, text, latencyMs: 1 };
  };
}

test("compact cards carry goal, location, rel-to-PC, and last beat", () => {
  const { session, world, ids } = liveSession(1);
  const npc = world.npc(ids[0]!)!;
  npc.bb.mood = 12;
  npc.relationships.pc = { friendship: 8, romance: 0, trust: 4, grudge: 1, familiarity: 3 };
  session.scene.history.push({ role: "assistant", speaker: npc.name, content: "the stew's honest", action: "nods" });
  const card = JSON.parse(compactCard(session, npc.id)) as {
    goal: string;
    loc: string;
    relToPc: { friendship: number };
    lastBeat: { content: string };
    mood: number;
  };
  assert.equal(typeof card.loc, "string");
  assert.ok(card.loc.length > 0);
  assert.equal(card.relToPc.friendship, 8);
  assert.equal(card.lastBeat.content, "the stew's honest");
  assert.equal(card.mood, 12);
  assert.equal(typeof card.goal, "string");
});

test("one participant: Director then Character, skip pass 2", async () => {
  const { session, world, ids } = liveSession(1);
  const npc = world.npc(ids[0]!)!;
  let calls = 0;
  const kinds: string[] = [];
  const complete: Completer = async (_conn, messages) => {
    calls++;
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      kinds.push("director");
      return {
        ok: true,
        text: JSON.stringify({ acts: [{ id: npc.id, guidance: "answer", why: "addressed" }] }),
        latencyMs: 1,
      };
    }
    kinds.push("character");
    return { ok: true, text: JSON.stringify({ speech: "Aye.", deltas: { mood: 2 } }), latencyMs: 1 };
  };
  const bundle = defaultBundle();
  await runSceneRound(session, "How is the stew?", new AbortController().signal, { complete, bundle });
  assert.deepEqual(kinds, ["director", "character"]);
  assert.equal(calls, 2);
  assert.equal(session.scene.history.filter((h) => h.role === "assistant").length, 1);
  assert.equal(session.scene.debug?.acts[0]?.id, npc.id);
  assert.equal(session.scene.debug?.acts[0]?.why, "addressed");
  assert.ok(world.events.some((e) => e.source === "llm" && e.actorId === npc.id));
  assert.equal(npc.bb.control, "llm");
});

test("Character 1's mood delta is visible to Character 2 this round", async () => {
  const { session, world, ids } = liveSession(2);
  const a = world.npc(ids[0]!)!;
  const b = world.npc(ids[1]!)!;
  a.bb.mood = 0;
  let characters = 0;
  let secondPack = "";
  const complete: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return {
        ok: true,
        text: JSON.stringify({
          acts: [
            { id: a.id, guidance: "greet" },
            { id: b.id, guidance: "react" },
          ],
        }),
        latencyMs: 1,
      };
    }
    characters++;
    if (characters === 2) secondPack = messages.map((m) => m.content).join("\n");
    return {
      ok: true,
      text: JSON.stringify({ speech: characters === 1 ? "Hello." : "I noticed.", deltas: characters === 1 ? { mood: 7 } : {} }),
      latencyMs: 1,
    };
  };
  await runSceneRound(session, "You two.", new AbortController().signal, { complete, bundle: defaultBundle() });
  assert.equal(a.bb.mood, 7);
  assert.equal(characters, 2);
  assert.ok(secondPack.includes(`"mood":7`), "second character pack includes the first beat's mood");
});

test("Director invented ids are dropped; location deltas do not move bodies", async () => {
  const { session, world, ids } = liveSession(1);
  const npc = world.npc(ids[0]!)!;
  const x = npc.loc.x;
  const y = npc.loc.y;
  const complete = queued([
    JSON.stringify({ acts: [{ id: "nope" }, { id: npc.id, guidance: "stay" }] }),
    JSON.stringify({
      speech: "Still here.",
      deltas: { location: { layer: "city", x: 1, y: 1 } },
    }),
  ]);
  await runSceneRound(session, "Stay put.", new AbortController().signal, { complete, bundle: defaultBundle() });
  assert.equal(session.scene.history.at(-1)?.content, "Still here.");
  assert.equal(npc.loc.x, x);
  assert.equal(npc.loc.y, y);
});

test("abort after the first Character skips the rest", async () => {
  const { session, world, ids } = liveSession(2);
  const a = world.npc(ids[0]!)!;
  const b = world.npc(ids[1]!)!;
  const abort = new AbortController();
  let characters = 0;
  const complete: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return {
        ok: true,
        text: JSON.stringify({
          acts: [
            { id: a.id, guidance: "first" },
            { id: b.id, guidance: "second" },
          ],
        }),
        latencyMs: 1,
      };
    }
    characters++;
    if (characters === 1) abort.abort();
    return { ok: true, text: JSON.stringify({ speech: `line-${characters}`, deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, "Both of you.", abort.signal, { complete, bundle: defaultBundle() });
  const spoken = session.scene.history.filter((h) => h.role === "assistant");
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0]?.content, "line-1");
});

test("a Called-in soul's pack has no beats from before they joined", async () => {
  const { session, world, ids } = liveSession(1);
  const a = world.npc(ids[0]!)!;
  const b = world.npcs.find((n) => !ids.includes(n.id))!;
  session.scene.history.push({
    role: "assistant",
    speaker: a.name,
    speakerId: a.id,
    content: "early words nobody new should hear",
    witnesses: [a.id, "pc"],
  });
  world.startRoleplay(b.id);
  session.scene.ids.push(b.id);
  session.scene.presence[b.id] = "called";
  let bPack = "";
  let directors = 0;
  const complete: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      directors++;
      if (directors === 1) {
        return { ok: true, text: JSON.stringify({ acts: [{ id: a.id, guidance: "witness-alpha" }] }), latencyMs: 1 };
      }
      return { ok: true, text: JSON.stringify({ acts: [{ id: b.id, guidance: "witness-beta" }] }), latencyMs: 1 };
    }
    const all = messages.map((m) => String(m.content ?? "")).join("\n");
    if (all.includes("witness-beta")) {
      bPack = all;
      return { ok: true, text: JSON.stringify({ speech: "I just arrived.", deltas: {} }), latencyMs: 1 };
    }
    return { ok: true, text: JSON.stringify({ speech: "As I was saying.", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, "You two.", new AbortController().signal, { complete, bundle: defaultBundle() });
  assert.ok(!bPack.includes("early words nobody new should hear"), "Tom hears no beats from minute 0–19");
  assert.ok(bPack.includes("As I was saying."), "beats witnessed after joining are visible");
});

test("a failed Character call stops the graph; retry resumes the remaining acts", async () => {
  const { session, ids } = liveSession(2);
  const [a, b] = ids as [string, string];
  let aAttempts = 0;
  let bAttempts = 0;
  const flaky: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return {
        ok: true,
        text: JSON.stringify({
          acts: [
            { id: a, guidance: "flaky-alpha" },
            { id: b, guidance: "flaky-beta" },
          ],
        }),
        latencyMs: 1,
      };
    }
    const all = messages.map((m) => String(m.content ?? "")).join("\n");
    if (all.includes("flaky-alpha")) {
      aAttempts++;
      if (aAttempts === 1) return { ok: false, error: "Connection failed: timed out" };
      return { ok: true, text: JSON.stringify({ speech: "A here.", deltas: {} }), latencyMs: 1 };
    }
    bAttempts++;
    return { ok: true, text: JSON.stringify({ speech: "B here.", deltas: {} }), latencyMs: 1 };
  };
  const bundle = defaultBundle();
  await runSceneRound(session, "Both.", new AbortController().signal, { complete: flaky, bundle });
  assert.equal(aAttempts, 2, "that call alone auto-retries");
  assert.equal(bAttempts, 1);
  assert.equal(session.scene.failed, null);
  const spoken = session.scene.history.filter((h) => h.role === "assistant").map((h) => h.content);
  assert.deepEqual(spoken, ["A here.", "B here."]);
});

test("a hard failure stops before the next act; sceneRetry re-runs only that call", async () => {
  const { session, world, ids } = liveSession(2);
  const [a, b] = ids as [string, string];
  let bAttempts = 0;
  const dead: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return {
        ok: true,
        text: JSON.stringify({
          acts: [
            { id: a, guidance: "hard-alpha" },
            { id: b, guidance: "hard-beta" },
          ],
        }),
        latencyMs: 1,
      };
    }
    const all = messages.map((m) => String(m.content ?? "")).join("\n");
    if (all.includes("hard-beta")) {
      bAttempts++;
      return { ok: true, text: JSON.stringify({ speech: "B here.", deltas: {} }), latencyMs: 1 };
    }
    return { ok: false, error: "Provider HTTP 500" };
  };
  const bundle = defaultBundle();
  await runSceneRound(session, "Both.", new AbortController().signal, { complete: dead, bundle });
  assert.equal(session.scene.status.phase, "failed");
  assert.equal(session.scene.failed?.agent, "character");
  assert.equal(session.scene.failed?.id, a);
  assert.equal(session.scene.failed?.attempts, 3, "1 try + 2 retries");
  assert.equal(bAttempts, 0, "the next act never runs");
  // Retry: only the failed call re-runs, then the graph resumes.
  const good: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return { ok: true, text: JSON.stringify({ acts: [] }), latencyMs: 1 };
    }
    const all = messages.map((m) => String(m.content ?? "")).join("\n");
    if (all.includes("hard-beta")) {
      bAttempts++;
      return { ok: true, text: JSON.stringify({ speech: "B here.", deltas: {} }), latencyMs: 1 };
    }
    return { ok: true, text: JSON.stringify({ speech: "A recovered.", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, "Both.", new AbortController().signal, { complete: good, bundle }, true);
  assert.equal(session.scene.failed, null, "success clears the failure");
  assert.equal(bAttempts, 1, "the remaining act resumes");
  const spoken = session.scene.history.filter((h) => h.role === "assistant").map((h) => h.content);
  assert.deepEqual(spoken, ["A recovered.", "B here."]);
  void world;
});

test("Director add joins a Here soul this pass; remove drops a leaver", async () => {
  const { session, world, ids } = liveSession(1);
  const a = world.npc(ids[0]!)!;
  const c = world.npcs.find((n) => !ids.includes(n.id))!;
  c.loc = { ...world.player.loc, x: Math.floor(world.player.px), y: Math.floor(world.player.py) };
  if (world.player.loc.layer === "interior") {
    c.loc = { ...world.player.loc };
    c.px = world.player.px;
    c.py = world.player.py;
  } else {
    c.loc = { layer: "city", x: Math.floor(world.player.px), y: Math.floor(world.player.py) };
    c.px = world.player.px;
    c.py = world.player.py;
  }
  assert.ok(world.isHere(c.id), "setup: C is Here");
  let directors = 0;
  const complete: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      directors++;
      if (directors === 1) {
        return {
          ok: true,
          text: JSON.stringify({ acts: [{ id: a.id, guidance: "add-alpha" }], add: [{ id: c.id, how: "here" }] }),
          latencyMs: 1,
        };
      }
      const remaining = session.scene.ids.filter((id) => !session.round!.alreadyActed.includes(id));
      return { ok: true, text: JSON.stringify({ acts: remaining.map((id) => ({ id, guidance: "add-beta" })) }), latencyMs: 1 };
    }
    const all = messages.map((m) => String(m.content ?? "")).join("\n");
    if (all.includes("add-beta")) return { ok: true, text: JSON.stringify({ speech: "C joins.", deltas: {} }), latencyMs: 1 };
    return { ok: true, text: JSON.stringify({ speech: "A speaks.", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, "Hello.", new AbortController().signal, { complete, bundle: defaultBundle() });
  assert.ok(session.scene.ids.includes(c.id), "added soul joins the scene");
  assert.ok(session.scene.history.some((h) => h.content === "C joins."), "added soul acts this round");
  // Remove: director drops A next round.
  const remove: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return { ok: true, text: JSON.stringify({ acts: [], remove: [a.id] }), latencyMs: 1 };
    }
    return { ok: true, text: JSON.stringify({ speech: "?", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, "Bye.", new AbortController().signal, { complete: remove, bundle: defaultBundle() });
  assert.ok(!session.scene.ids.includes(a.id), "removed soul leaves the chips");
  assert.equal(world.npc(a.id)!.bb.control, "autonomous", "removed soul returns to the sim");
});

test("director prompt carries the roster (not an empty card)", async () => {
  const { session, ids } = liveSession(2);
  let directorUser = "";
  const complete: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      directorUser = messages.map((m) => String(m.content ?? "")).join("\n");
      return { ok: true, text: `{"acts":[]}`, latencyMs: 1 };
    }
    return { ok: true, text: JSON.stringify({ speech: "?", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, "Hello?", new AbortController().signal, { complete, bundle: defaultBundle() });
  for (const id of ids) assert.ok(directorUser.includes(id), `director pack should list participant ${id}`);
});

// Scene spec §12 — pack order, role split, no duplicate player line, concealment.

function speakSession() {
  const { session, world, ids } = liveSession(2);
  const line = "Hello A and B";
  session.scene.history.push({
    role: "user",
    speaker: world.player.name,
    speakerId: "pc",
    content: line,
    witnesses: session.currentWitnesses(),
  });
  return { session, world, ids, line };
}

test("two-person Speak: chronological, one player line, this soul is the only assistant", async () => {
  const { session, world, ids, line } = speakSession();
  const [a, b] = ids as [string, string];
  const aName = world.npc(a!)!.name;
  const packs = new Map<string, { role: string; content: string }[]>();
  const complete: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return {
        ok: true,
        text: JSON.stringify({
          acts: [
            { id: a, guidance: "pack-alpha" },
            { id: b, guidance: "pack-beta" },
          ],
        }),
        latencyMs: 1,
      };
    }
    const all = messages.map((m) => String(m.content ?? "")).join("\n");
    const key = all.includes("pack-alpha") ? a! : b!;
    packs.set(
      key,
      messages.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
    );
    return { ok: true, text: JSON.stringify({ speech: "Aye.", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, line, new AbortController().signal, { complete, bundle: defaultBundle() });
  const aPack = packs.get(a!)!;
  const bPack = packs.get(b!)!;
  assert.ok(aPack && bPack, "both souls packed");
  // History slice only: the first three messages are the fixed book/snapshot
  // (compact cards may echo the line as lastBeat metadata — not a beat).
  const tailOf = (p: { role: string; content: string }[]) => p.slice(3);
  const playerBeats = (p: { role: string; content: string }[]) =>
    tailOf(p).filter((m) => m.role === "user" && m.content.includes(line));
  // A pack ends with the player line, once.
  const aTail = tailOf(aPack);
  assert.equal(playerBeats(aPack).length, 1, "A sees the player line once");
  assert.equal(aTail[aTail.length - 1]!.content.includes(line), true, "A pack ends with that line");
  // B pack is player, then A — and A is user, never assistant. (The memory tail
  // may echo A first; the live scene slice is what must order player, then A.)
  const bTail = tailOf(bPack);
  const bPlayer = bTail.findIndex((m) => m.role === "user" && m.content.includes(line));
  const bAIndexes = bTail.map((m, i) => (m.content.includes(`${aName}:`) ? i : -1)).filter((i) => i >= 0);
  const bA = bAIndexes[bAIndexes.length - 1] ?? -1;
  assert.ok(bPlayer >= 0 && bA > bPlayer, "B pack order is player, then A");
  assert.equal(playerBeats(bPack).length, 1, "no trailing duplicate player line in B pack");
  assert.equal(
    bTail.some((m) => m.role === "assistant" && m.content.includes(`${aName}:`)),
    false,
    "A is not assistant in B's pack",
  );
  assert.ok(bTail.some((m) => m.role === "user" && m.content.includes(`${aName}:`)), "A arrives as a user beat");
});

test("retry of B rebuilds the identical pack", async () => {
  const { session, ids, line } = speakSession();
  const [a, b] = ids as [string, string];
  let bFirst: { role: string; content: string }[] | null = null;
  const dead: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return {
        ok: true,
        text: JSON.stringify({
          acts: [
            { id: a, guidance: "retry-alpha" },
            { id: b, guidance: "retry-beta" },
          ],
        }),
        latencyMs: 1,
      };
    }
    const all = messages.map((m) => String(m.content ?? "")).join("\n");
    if (all.includes("retry-beta")) {
      bFirst = messages.map((m) => ({ role: m.role, content: String(m.content ?? "") }));
      return { ok: false, error: "Provider HTTP 500" };
    }
    return { ok: true, text: JSON.stringify({ speech: "A here.", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, line, new AbortController().signal, { complete: dead, bundle: defaultBundle() });
  assert.equal(session.scene.failed?.id, b, "B is the failed call");
  assert.ok(bFirst, "captured the failed B pack");
  let bSecond: { role: string; content: string }[] | null = null;
  const good: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return { ok: true, text: JSON.stringify({ acts: [] }), latencyMs: 1 };
    }
    bSecond = messages.map((m) => ({ role: m.role, content: String(m.content ?? "") }));
    return { ok: true, text: JSON.stringify({ speech: "B recovered.", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, line, new AbortController().signal, { complete: good, bundle: defaultBundle() }, true);
  assert.ok(bSecond, "retry re-ran B");
  assert.deepEqual(bSecond, bFirst, "retry uses the same pack, still one player line");
});

test("a concealed ancestry never appears in another soul's pack", async () => {
  const { session, world, ids } = liveSession(2);
  const [vamp, neighbor] = ids as [string, string];
  const vampire = world.npc(vamp!)!;
  const vampireAnc = Object.values(world.defs.ancestries).find((a) => a.label === "Vampire")!;
  vampire.ancestryId = vampireAnc.id;
  vampire.concealed = true;
  vampire.secrets = "CONCEALED-SECRET-XYZ midnight thirst";
  const neighborName = world.npc(neighbor!)!.name;
  void neighborName;
  let neighborPack = "";
  const complete: Completer = async (_conn, messages) => {
    const sys = String(messages[0]?.content ?? "");
    if (sys.includes("never speak in the thread")) {
      return { ok: true, text: JSON.stringify({ acts: [{ id: neighbor, guidance: "conceal-alpha" }] }), latencyMs: 1 };
    }
    neighborPack = messages.map((m) => String(m.content ?? "")).join("\n");
    return { ok: true, text: JSON.stringify({ speech: "Morning.", deltas: {} }), latencyMs: 1 };
  };
  await runSceneRound(session, "Morning all.", new AbortController().signal, { complete, bundle: defaultBundle() });
  assert.ok(!neighborPack.includes("Vampire"), "no ancestry leak into the neighbor pack");
  assert.ok(!neighborPack.includes("CONCEALED-SECRET-XYZ"), "no secret text in the neighbor pack");
  assert.ok(!neighborPack.includes("midnight thirst"), "no secret detail in the neighbor pack");
  // The concealed card omits ancestry; an unconcealed card keeps it.
  const hidden = JSON.parse(compactCard(session, vamp!)) as { ancestry?: string };
  assert.equal(hidden.ancestry, undefined, "compactCard omits ancestry when concealed");
  vampire.concealed = false;
  const open = JSON.parse(compactCard(session, vamp!)) as { ancestry?: string };
  assert.equal(open.ancestry, "Vampire", "unconcealing restores the card");
});
