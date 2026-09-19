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
