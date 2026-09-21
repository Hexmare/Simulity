# Roleplay Agent Runtime

**Status:** [spec_index.md](spec_index.md). A–D locked 2026-09-19. Witness/retry/add-remove: Occupancy spec.  
**Depends on:** Architecture Foundations §2.6 / §3.5, [Play Layout and Conversation](Play_Layout_and_Conversation.md), [Connection Profiles and Agents](Connection_Profiles_and_Agents.md), [Server Authority and Transport](Server_Authority_and_Transport.md), [Occupancy, Conversation, Ledger, and MCP](Occupancy_Conversation_Ledger_and_MCP.md)  
**Saves:** Prompt books on agent bindings. Per-soul `bb.memory` and `bb.tasks` persist on the town save (Occupancy §13 / §16). Scene thread is ephemeral.  
**Non-negotiable:** Adults 18+ only. No Grok/xAI branding. No illegal-activity systems. Server is the source of truth. Client has zero sim and zero interaction logic. LLM never writes the sim directly — every mutation is a validated delta or tool. Director may add (Here) / Call / remove; must not Summon, End, move bodies, or assign tasks. Agent overrides are per **agent type**, never per NPC.

---

## 1. Why this is its own spec

[Play Layout](Play_Layout_and_Conversation.md) is chrome: You / Ledger / Conversation, Here vs Call, hide vs End, follow. It assumed **one LLM completion per player line** that returned a `beats[]` array.

That is the wrong runtime.

The roleplay layer is **agentic**: a Director agent decides who acts and in what order; a Character agent then runs **once per directed soul**, in that order, each seeing the thread including beats that already happened this turn; the Director runs **again** to catch people who should now react; those leftover Character agents run; then it is the player's turn.

That loop is the LLM Roleplay Layer. It replaces today's single `roleplayTurn` + `{speech, deltas}` for a scene, and it replaces the `beats[]` one-shot in the layout spec. Layout still owns the window. This spec owns the round.

It also changes the "soft cap" question. The expensive thing is no longer stuffing N full snapshots into one prompt. Each Character call is ~one soul. The Director call sees a **roster of compact cards**. Latency is N sequential completions, not one fat one.

---

## 2. Current `main` (what we replaced)

`Roleplay.tsx` on Speak, before this spec landed:

1. `snapshotNpc` for the single `talkId`
2. `buildMessages` (system + character + live + history + player line)
3. One server `roleplayTurn` → `{ speech, action, deltas }`
4. `applyDeltas` on that NPC

There is no Director. There is no second soul. The prompt book is one `DEFAULT_BOOK` in `src/lib/llm/prompts.ts`.

Architecture already says "one or more NPCs" and "deltas reconciled by the autonomous layer." It does not say one completion. This spec fills that in.

---

## 3. Round protocol

One **round** = one player Speak until the player may Speak again.

```
Player Speak
    │
    ▼
Director pass 1
    │  acts: ordered [{ id, guidance }]
    │  (subset of current participants; may be empty → round ends)
    ▼
Character agent for acts[0]     → apply deltas, append beat
Character agent for acts[1]     → apply deltas, append beat
… in Director order, skip unknown / already-acted / not-in-scene
    │
    ▼
Director pass 2          # SKIP if alreadyActed covers all participants
    │  same shape, only ids that have NOT acted this round
    │  empty → round ends
    ▼
Character agents for those leftovers (if any)
    │
    ▼
Player's turn
```

Exactly **two Director passes maximum** per round to start. Pass 2 is skipped when every current participant has already acted after pass 1 (no one left to catch). Pass 2 may only name ids that have **not** acted this round. Characters never run twice in one round.

Empty Director list = silence. The thread shows the player line and nothing else. Player may Speak again.

1:1 is not a special case. One participant still goes through Director → Character → (skip pass 2, they already acted) → player. Do not skip the Director when N=1; keep one protocol.

---

## 4. Who the agents are

Two roles. Same **Default connection profile** unless a binding says otherwise ([Connection Profiles and Agents](Connection_Profiles_and_Agents.md)). Two prompt books, stored on the agent bindings, not on the profile.

Director and Character are **agent types**. The Character agent is one agent. Running it for Ava and then for Tom does not pick a different profile, override, or book. There is no per-NPC LLM config.

### 4.1 Director

A router, not a character. Never speaks in the thread. Never emits deltas.

**May:** pick an ordered subset of **current scene participants**, attach short guidance per id, return nobody. **Add** (Here only) or **Call** souls into the scene. **Remove** souls who are leaving. Spec: [Occupancy §14](Occupancy_Conversation_Ledger_and_MCP.md).

**Must not:** invent ids, Summon (relocate the body), End the scene, move anyone, assign tasks, narrate as GM in the thread, write `speech` into the chat.

**Input (packed):**

- Setting bible (short)
- PC card: name, age, ancestry, job, home, public, voice, presence `here`
- Roster: one **compact card** per participant — id, name, presence (`here` | `called`), location line, mood, goal label, job, 3-line public, relationship-to-PC numbers, last beat this scene if any
- Scene thread (player + character beats, not town chronicle)
- This round's player line
- Pass 2 only: `alreadyActed: id[]` and the beats produced this round

**Output:**

```
{ "acts": [ { "id": "<npc id>", "guidance": "answer the question about the stew; keep it short", "why": "addressed by name" } ] }
```

- `acts` missing/empty → silence
- Unknown id → drop
- Duplicate id → keep first
- `guidance` is director-to-character notes, never shown in the thread
- `why` is debug-only (Conversation Debug)

### 4.2 Character

In-character, one soul. Today's role, narrowed.

**Input (packed):**

- Setting bible
- **Self:** full `snapshotNpc` (needs, mood, private, knowledge, family, recent events, …) + presence
- **Others:** compact cards only (no one else's `narrative.private`)
- PC card (job/home/public/voice — they know who they are talking to)
- Director `guidance` for this soul
- Thread, including **this round's already-produced beats in order**, **witness-filtered** to this id ([Occupancy §13](Occupancy_Conversation_Ledger_and_MCP.md)). A Called-in soul does not see earlier beats. Pack remaining budget from **this soul’s** `bb.memory` only.

**Output:** today's shape, one speaker:

```
{ "speech": "in-character dialogue or empty", "action": "optional physical beat", "deltas": { … } }
```

Rules:

- Speak only as self. If the model writes another name's dialogue, the runtime still attributes the beat to this id (do not split).
- Empty `speech` + optional `action` is legal (a look, a nod). That **counts as acted**.
- `deltas` run through existing `applyDeltas` for this id only. Location deltas are **ignored while the scene is live** (Play Layout §7.7 — player movement / follow own the bodies).
- Called presence: the character book must say they are not in the room. No handing objects, no walking the floor.
- Here presence: they are in the PC's current location (or following).

After a Character call returns, **before** the next agent:

1. Validate and `applyDeltas`
2. Append the beat to the scene thread
3. Log a chronicle event (`source: "llm"`) as today
4. Next Character pack uses a **fresh** `snapshotNpc` so they see updated mood/relationships/knowledge

That is live reconciliation, not "wait until End." End only flips `control` back to autonomous. This matches current 1:1 (deltas apply per Speak) extended per beat.

---

## 5. Packing and why the old "soft cap" changes

Each Character completion is budgeted like today's 1:1 call: one full snapshot, history trimmed newest-first (`buildMessages`). Other people are cards of a few hundred characters, not second snapshots.

Director completion is roster-sized: N cards + thread. That is the call that degrades first as the table grows.

Wall-clock is sequential. A pass-1 list of 3 plus a pass-2 add is **1 + 3 + 1 + 1 = 6** provider round-trips per player line. Timeouts stay per completion. The round is cancellable (see §7).

Participant-count policy therefore splits:

| Pressure | What actually hurts |
|---|---|
| Director context | N compact cards + thread |
| Character context | Almost independent of N |
| Player wait | Sum of sequential completions |

Play Layout Q6 is **closed**: no warn, no cap. Bigger scene, longer round. The player knows.

---

## 6. Orchestrator (server, LangGraph)

The calling loop is a **server-side LangGraph** graph (`@langchain/langgraph`). It is the place future agent types plug in (Summon, Memory, …). The client never sequences completions.

Why LangGraph: explicit graph (Director → Character queue → conditional Director-2 → Character queue → END), cancellable, streaming node updates we can forward on the WebSocket, one registry of nodes that matches agent types.

The graph is **server-only**. It must not land in the Vite client bundle.

### 6.1 Effective connection

Each node starts by resolving its agent binding ([Connection Profiles](Connection_Profiles_and_Agents.md)):

```
effective = profile (Default or named) + agent-type overrides + that agent's prompt book
```

Director node uses the `director` binding (e.g. Default + `maxOutputTokens: 10000`). Character node uses the `character` binding for **every** NPC it runs. Completions go through the existing OpenAI-compatible chat path (`baseUrl` / `path`), not a locked OpenAI SDK account.

### 6.2 Graph (this pass)

State (sketch): `townId`, `sceneId`, `playerLine`, `participants`, `acts[]`, `alreadyActed[]`, `beats[]`, `directorPass`.

```
START
  → director          # pass 1; write acts
  → character_loop    # sequential; skip unknown / alreadyActed / not in scene
                      # after each: applyDeltas, append beat, emit WS scene.beat
  → maybe_director2   # SKIP if alreadyActed covers all participants
                      # else director pass 2, acts := only not-alreadyActed
  → character_loop    # leftovers only
  → END               # emit roundEnd
```

`character_loop` is sequential on purpose (later beats must see earlier ones). Do not `Send` in parallel.

Cancel: abort the graph run. Beats and deltas already applied stay. Emit `roundEnd` with `cancelled: true`.

Engine still owns: who is in the scene, Here vs Called, `applyDeltas` validation, skip-already-acted, the max-2 rule. The model does not get to change those.

### 6.3 Prompt books

On the agent binding, same placeholder style as the shipped Character book. Shipped defaults live in `content/prompts/` and load through `src/lib/llm/prompt-catalog.ts` ([Prompt Templates and Agents](Prompt_Templates_and_Agents.md)). Settings **Agents** tab edits them. Changing a book affects the next round, not an in-flight graph. Registered agent types (narrator, summarizer, …) ship as books this pass; they do not run in the round graph yet.

MCP tools this pass: `list_souls`, `list_places`, `move_soul`, `call_soul`, `assign_task`. HTTP `/mcp` on the Session process. Spec: [Occupancy §8 / §15 / §16](Occupancy_Conversation_Ledger_and_MCP.md). Call is both a button and a Character/MCP tool. It is not a LangGraph node.

---

## 7. UI during a round

Conversation window is a **view** of server scene events ([Server Authority](Server_Authority_and_Transport.md) §5).

- `speak` intent disables compose until `roundEnd` (or `cancelled`).
- Thread appends a bubble on each `scene.beat`. Order = server order.
- Status line from `scene.status`: `Director…` / `Ava Chen…` / `Director (again)…`.
- **Cancel** sends `sceneCancel`. **End** sends `sceneEnd` (cancel + release). Hide is chrome and does not send cancel.
- Debug shows last Director `acts` / `why` as the server last sent them.

The browser does not pack prompts, does not call the provider, does not `applyDeltas`.

---

## 8. Scene / sim invariants (unchanged, restated)

- Only current participants are legal Character ids. Director cannot grow the scene.
- Add / Speak = Here only. Call = not-Here, body stays. Summon is not this pass. (Play Layout)
- Non-participants keep ticking on the **server**. Participants stay `bb.control = "llm"` for the whole scene, including between rounds and during Hide.
- Player movement during a scene is allowed (intents). Present participants follow. Called do not. Snapshots for the next Character node are taken at node-run time so a follow that completed while we waited on the provider is visible.
- No extra sim ticks *because* an agent ran. Wall-clock waiting is not sim time. Speed still applies to everyone not in the scene.
- Adults 18+. No illegal-activity systems. No Grok branding.

---

## 9. Failure

Superseded in part by [Occupancy, Conversation, Ledger, and MCP](Occupancy_Conversation_Ledger_and_MCP.md) §6. Locked 2026-09-19:

| Failure | Behavior |
|---|---|
| Director parse fail / timeout / HTTP | Auto-retry **that Director call** up to `effective.maxRetries` (default 2). Still failing → **stop the graph**, `phase = failed`, banner + Retry. Do not skip to characters. |
| Character fail (timeout / HTTP / parseError / unusable payload) | Auto-retry **that Character call**. Still failing → **stop**. Do not mark them acted. Do not run the next act. |
| Manual Retry | Re-runs **only the failed call**. On success the remaining acts continue, then Director pass 2 if it has not run and people remain. |
| Empty legal acts after a successful Director parse | Silence, end round (not a failure). |
| Provider offline / agent profile disabled | Do not start a round. Offline banner. |
| Player Speak with 0 participants | Server rejects. |

A new player Speak while `failed` discards the paused cursor and starts a new round.

Timeouts: `ConnectionProfile.timeoutMs` (default 45000), overridable per agent type. The orchestrator does not hardcode 45000.

Do **not** skip a failed soul and keep going. The table waits.

---

## 10. Acceptance

1. One participant, player Speaks. Director returns that id. Character produces a beat. Director pass 2 is **skipped** (everyone has acted). Compose re-enables. Deltas applied on the server World. `control` still `llm` until End.
2. Three Here participants. Player addresses only Ava. Director pass 1 lists Ava. Character Ava beats. Director pass 2 lists Tom. Character Tom beats. Mara never runs. Thread order Ava then Tom.
3. Called participant in the scene. Director may pick them. Their beat is labeled called. Their body tile does not change. Location delta from the model is ignored.
4. Director invents an id or the PC. Runtime drops it.
5. Character 1's delta (mood/relationship) is visible in Character 2's packed snapshot this same round.
6. Cancel after the first Character: second Character does not run, pass 2 does not run, first beat remains, compose re-enables, scene still live on the server.
7. Hide during a round: round finishes on the server, beats appear when the panel reopens. End during a round: cancel + release.
8. Empty Director: player line only, no fake GM narration.
9. Default profile `maxOutputTokens = 4000`, Director override `10000`, Character no override. Director call uses 10000; both Ava and Tom Character calls use 4000.
10. Prompt books editable per agent type. Changing them affects the next round, not in-flight.
11. A 6-person scene is legal. No warning UI.
12. `npm test` / `npm run typecheck` green. Graph tests mock the chat layer. 1:1 is the two-pass (or skip-pass-2) loop, not a one-shot `roleplayTurn`.

---

## 11. Decisions (locked 2026-09-19) and leftovers

**A. Director passes.** Max 2 to start. Skip pass 2 when every participant has already acted. Not an infinite loop-until-quiet.

**B. Connections.** Default profile for everyone. Multiple profiles later (and now, structurally). Per **agent type**: pick a profile and/or override knobs. Character override is global to the Character agent, not per NPC. Spec: [Connection Profiles and Agents](Connection_Profiles_and_Agents.md).

**C. Participant count.** No warn, no cap. Latency is accepted.

**D. Where the loop lives.** Server. LangGraph orchestrator. Client is a view over WebSocket. Spec: [Server Authority and Transport](Server_Authority_and_Transport.md).

Still open on sibling specs: none that block the round protocol. P1/P2 and S1 locked 2026-09-19.

---

## 12. Cut

Depends on Server Authority cut 1–2 (live World + socket). Then:

1. Connection Default profile + two agent bindings (lift current settings). Resolve-effective helper. Tests for override merge.
2. LangGraph graph with mocked chat: skip-pass-2, skip-already-acted, sequential deltas.
3. Wire `speak` / `sceneCancel` / `sceneEnd` intents and `scene.*` events. Real completions through effective connections.
4. Settings UI: Profiles tab + Agents tab (Director override example).

Play Layout chrome can paint the thread from `scene.beat` without knowing the graph.
