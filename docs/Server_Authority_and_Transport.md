# Server Authority and Transport

**Status:** Implemented. S1 locked 2026-09-19 (one live town, N browsers). Tick, intents, and the roleplay graph live on the server.  
**Depends on:** Architecture Foundations §2.5 / §3.6, [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md), [Play Layout and Conversation](Play_Layout_and_Conversation.md)  
**Saves:** Town save shape unchanged. Live World is in server memory while a session is open; still snapshotted to PGLite.  
**Non-negotiable:** Adults 18+ only. No Grok/xAI branding. **The client contains zero simulation logic and zero interaction logic.** No Grok/xAI tools in the project.

---

## 1. Honest current state

This was the diagnosis when the spec was written. It is no longer the running system.

| | Landed |
|---|---|
| `World` lives | Server (`Session` in `src/lib/server/session.ts`) |
| Tick | Server interval: `movePlayer` / `world.step()` / `world.animate()` |
| Roleplay | Server LangGraph; client sends `speak` and paints `scene` events |
| Persistence | Server snapshots the World every 8s and on disconnect |
| Client | Hydrates a **view** World from `snapshot` + applies `delta` poses. Canvas does not tick. |

The browser is a view. The server is the sim.

---

## 2. Rule

**Server:** owns `World`, the tick, navigation, needs, BT, utility, economy, roleplay orchestrator, delta apply, catalog overlays, persistence.

**Client:** a view. Renders the last snapshot. Converts input to **intents**. Holds chrome only (camera, follow flag, layout sizes in `localStorage`, which Ledger tab is open).

If a function mutates a soul, a building, the clock, or a scene, it does not import in a `src/components/**` file.

`window.__sim` / `__controlsTest` become thin intent senders + snapshot readers for tests, not in-process World handles.

---

## 3. Session

- The server hosts **exactly one live town** at a time. One `World` in memory. Not one World per town id in parallel. N browsers does not mean N towns.
- Loading a ward starts that session (hydrate, tick). Loading a *different* ward persists and unloads the current one, then hydrates the new. Every connected browser follows the new snapshot.
- **N browsers** may attach to that one session. They are all views of the same World, the same PC, the same scene. Intents from any attached client apply to that one body. This pass does not split controller vs spectator.
- A browser that connects while a session is live **joins it**. It does not get a private World, and it cannot load a second town beside the first.
- Start screen while live: “this ward is running” + Join, or pick another ward (unload/reload).
- Last socket disconnect: persist, stop the tick, drop the World after a short grace (30s) so a refresh does not regen. First browser back during grace resumes the same session.
- Pause / speed are session fields, not client-side `world.paused`. Intent `setPaused`, `setSpeed`.

Tick stays `REAL_SECONDS_PER_TICK` at 1×, multipliers 3× / 8×, **on the server clock**. Not on rAF.

---

## 4. Transport: WebSocket

Replace “client ticks, occasional POST save” with one socket per session.

Suggested path: `wss?://<host>/ws` on the existing Vite/Nitro server (one session, so no town id in the URL). Not SSE. Not polling. Town id is the session's, sent in the hello/snapshot.

### 4.1 Client → server (intents)

Named, validated, small. Examples — not a closed list, but this is the bar:

| Intent | Today’s local call |
|---|---|
| `move` `{dx,dy}` / `keys` `{codes[]}` | `movePlayer` |
| `walkTo` `{layer,x,y,…}` | `commandPlayerTo` |
| `interact` | `interact` |
| `select` `{npcId? , buildingId?}` | inspector select |
| `speak` `{text}` | Roleplay Speak |
| `sceneAdd` `{npcId}` / `sceneCall` `{npcId}` / `sceneEnd` / `sceneCancel` | layout scene verbs |
| `patchPc` `{…}` | You pane |
| `patchNpc` / `addVillager` / `addHouse` / … | Ledger authoring |
| `setPaused` / `setSpeed` | header |

Unknown intents drop. Invalid ids drop. The server never trusts a client-supplied World blob as live state (saves still import as files on the start screen).

### 4.2 Server → client (events)

| Event | When |
|---|---|
| `snapshot` | On join, on large mutations (enter building, overlay change). Full view model. |
| `delta` | Per tick / per intent: clock, poses, needs of visible souls, flags. |
| `scene` | Round status: `director`, `character:{id}`, `beat`, `roundEnd`, `error`. |
| `log` | Chronicle line. |
| `saved` | Persist ack. |

The view model is **not** the full `World` class. It is JSON the canvas and Ledger can paint: tiles already known from the snapshot, soul poses, selected soul public fields, scene thread. Private narrative of NPCs you are not editing does not need to stream every tick.

### 4.3 Presentation vs sim

Architecture already: arrival is tick-authoritative; presentation may interpolate.

The canvas rAF loop **paints** and may lerp poses between the last two server deltas. It does not call `World.step`. It does not decide doors. Camera follow is chrome: it tracks the last known player pose.

WASD: client sends key state (on change, or a light heartbeat). Server runs `movePlayer`. Do not keep a ghost World in the browser to predict collisions this pass. If it feels laggy on localhost it is a later prediction spec.

---

## 5. Roleplay on this transport

See [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md). Short version:

- `speak` intent starts a LangGraph round **on the server**.
- Graph nodes resolve [connection bindings](Connection_Profiles_and_Agents.md), pack, complete, `applyDeltas` on the live World, emit `scene` events as they go.
- Client appends beats when `scene.beat` arrives. Compose unlocks on `roundEnd`.
- Hide-window is chrome (stop showing the panel). Scene stays live on the server.
- End is an intent. Cancel is an intent (abort the graph, keep applied beats).

The client does not pack prompts. The client does not call `applyDeltas`. The client does not hold `talkIds` as sim state — it holds what the server last sent.

---

## 6. Persistence

- Server ticks persist on the same ~8s cadence the client uses today, plus on disconnect, plus on scene end.
- Start screen still lists/loads/imports via HTTP (or the same socket after connect). No change to town JSON shape.
- LLM keys stay server-side. Profiles API returns masked keys.

---

## 7. Cut (this is the expensive one)

Honest order, because almost every other spec hangs on §2:

1. **Host `World` on the server.** Tick loop, persist, pause/speed. Client still a local World temporarily is **not** acceptable once this cut starts — do not dual-sim.
2. **WebSocket snapshot/delta + intents** for movement, interact, select, pause. Canvas becomes a renderer. `window.__sim` talks to the socket.
3. **Authoring intents** (You, Ledger, Founding) over the same socket.
4. **Scene intents + LangGraph round**, streaming `scene` events.

Play Layout chrome (splitters, You pane, bottom Conversation) can paint against the view model in parallel with (2)–(4) but must not grow a second World.

---

## 8. Decisions and leftovers

**S1. How many towns / browsers.** Locked 2026-09-19. One live town at a time, no matter how many browsers are connected. All sockets share that session. Not reject-second-client; not a second World.

**S2. Key-state rate.** Default: send on change, plus a 500ms heartbeat of currently held keys so a dropped keyup cannot run-on. Revisit if it chatters.

**S3. Snapshot size.** Full map on join. Per-tick: poses + clock, not the tile array.

**S4. Tests.** Unit tests keep constructing `World` in-process (they are not a client). Add a session test that steps the server host with a fake socket.
