# Occupancy, Conversation Reliability, Ledger, and First MCP Tools

**Status:** Implemented 2026-09-19. Decisions Q1–Q10 locked 2026-09-19 (shipped as specified, no Q-reopens, no extra features). Addenda (call/add/remove, memory, tasks, chronicle, chips) in §12–16 implemented. Verified: `npm test` 166/166 green (incl. new claimUse / parse-no-raw / witness / retry-resume / "pc" remap / task-tell / MCP tests), `npm run typecheck` green, and HTTP `/mcp` + `/ws` live-checked on dev against one Session (48-soul ward: list_souls 49 with pc, list_places 33, move_soul paths the named soul only). Existing towns keep baked interiors; saves stay v7 with empty defaults for the new blackboard fields.  
**Depends on:** [Architecture Foundations](Architecture_Foundations.md), [Play Layout](Play_Layout_and_Conversation.md), [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md), [Connection Profiles and Agents](Connection_Profiles_and_Agents.md), [Server Authority](Server_Authority_and_Transport.md), [Data-Driven Catalog](Data_Driven_Catalog.md)  
**Saves:** No wipe. Conversation/ledger/MCP are session + protocol. Interiors, kitchens, and chairs live on building-kind rows; **existing towns keep baked interiors** until a new ward is generated. Unique furniture claims still apply to current towns (old diners stop stacking; they stay small).  
**Non-negotiable:** Adults 18+ only. No Grok/xAI branding. No illegal-activity systems. Server remains source of truth. LLM never writes the sim directly — every mutation is a validated tool or delta. Client has zero sim logic.

---

## 1. Problem

Five things that are wrong in play right now, plus the MCP surface Architecture has owed since Phase 1.

### 1.1 A hall full of people, a room with two bodies

Fenwick has **one diner** and ~48 adults. The eat tree (`content/trees/eat.json`) sends anyone without carried food to that diner UUID.

Arrival is `workSpot()` in `src/sim/ai.ts`: **the middle floor spot of ground.** Every hungry soul paths to the same tile. Inside, they stack. `pickNpc` only returns the nearest body within 0.55 tiles, so you can click one or two. The city roof overlay still draws a dot per occupant, which is why the outside looks crowded and the inside does not.

The diner interior itself is 11×7 (`building-kinds.json` layout). After walls, kitchen split, and furniture, dining has on the order of twenty standable tiles. That is not a hall. Parish (12×10) and night market (12×8) have the same class of problem at gather hours.

Furniture exists as tiles (`bed`, `table`, `counter`, `hearth`, `pew`, `anvil`) and as `FurnitureItem` rows (`ownerId`, `allowsTwo` on beds). Nobody **uses** them. Workers do not stand at a station. Diners do not sit. Homes have no chairs and no kitchen. Sleep already targets a bed tile; the body is still drawn standing on it.

`World.occupants` already returns everyone on that floor. The canvas already draws them. The bug is **destination identity**, **unusable furniture**, and **undersized gather interiors** — not a hidden render cap.

### 1.2 JSON in the chat

Character prompts demand `Reply with ONLY JSON`. `parseCharacter` on failure does `speech: raw.slice(0, 800)`. That raw string is appended as an assistant beat and painted in Conversation.

`/debug` already has the raw. The thread must never.

### 1.3 Errors that will not leave

`SessionClient.lastError` is set on `scene.error` and on `{ type: "error" }`. It is cleared only on a full `snapshot`. A later successful round does not clear it. There is no retry. Timeouts are hardcoded `45000` on the orchestrator, not on the profile.

### 1.4 Ledger does not show the beat

`applyDeltas` on the **server** does apply needs, mood, and relationships. `LiveDelta.Pose` is pose + `control` + `goalId`. The client Inspector reads a stale hydrate. Rel key `"pc"` is not the player id.

### 1.5 Ledger has no roster

Click-on-canvas only. Add/Call are unfiltered button lists.

### 1.6 No MCP, and no legal scene move

Character JSON `location` is stripped. `applyDeltas` skips location while `control === "llm"`. Play Layout follow is PC-led only. There is no tool a Character (or an external client) can call to walk somewhere.

---

## 2. Goals

1. **People occupy furniture.** Workers at stations, diners in seats, bodies in beds, someone in a parlour chair. Overflow waits at the street door — never stacked on one tile.
2. **Several ways to eat.** Diner, bakery, night market, **home kitchen**. Affinity picks among them. Guests in a home with a kitchen can eat there.
3. **The thread is speech and action.** Raw JSON lives in `/debug`.
4. **A failed LLM call stops the graph.** Auto-retry that call (default 2). Then the banner and a manual Retry. Success **resumes** the remaining acts — it does not restart the round.
5. **Timeouts and retries are profile knobs** (agent bindings may override).
6. **The Ledger is live** and has a typeahead roster.
7. **MCP `/mcp` on this process.** Tools: look-up, `move_soul`, `call_soul`. A Character may trigger `move_soul` for **themselves**. Other scene souls see it and decide whether to follow.

---

## 3. Non-goals

- Rebuilding interiors of **existing** towns automatically.
- Sit/stand/sleep **animation frames**. Pose is a draw state (seated lower, asleep on the bed tile).
- Spatial voice / auto-join the room.
- Summon (relocate then Here).
- Per-NPC agent bindings.
- Catalog authoring MCP this pass.
- Client-side prediction.
- Auto-follow on **NPC-led** moves (that is a Character decision). PC-led follow from Play Layout §7.7 stays as-is.

---

## 4. Occupancy, furniture, and interiors

### 4.1 Furniture is a place to be

New engine verb family: **claim a furniture item**, not a floor tile.

```
claimUse(world, npc, building, prefer: "seat" | "work" | "sleep" | "cook") → FurnitureItem | null
```

| prefer | Legal items | Pose while claimed |
|---|---|---|
| `seat` | `chair`, `pew` (and `stool` if present) | `sit` |
| `work` | `counter`, `hearth`, `anvil` | `stand` |
| `sleep` | `bed` (existing `allowsTwo` / owner / partner rules) | `sleep` |
| `cook` | `hearth` or `counter` in a `kitchen` room | `stand` |

Rules:

- Occupied = another soul’s `bb.usingId` is that item (beds still allow two when `allowsTwo` and partner/owner).
- In-flight dest that already claimed the item counts as occupied.
- Deterministic among free items (hash of npcId).
- On claim: `bb.usingId = item.id`, loc snaps to that tile, `bb.pose = sit|stand|sleep`.
- On leave / new path / scene End returning to autonomous: release `usingId`, pose back to `stand`.
- If nothing free in the building: **overflow at the street entrance** (city layer, `b.entrance`). Not inside. Clickable. Roof overlay still shows who made it in.

`workSpot()` and “middle of `spots[]`” go away. Eat / gather uses `seat`. Job `sys:work` uses `work`. Home night uses `sleep` (existing `bedOfWithBonds`). Home evening idle uses `seat` in the parlour if a chair exists. Home meal uses `cook` for the person making food, `seat` for everyone eating.

### 4.2 New furniture: chairs

`TileKind` gains `"chair"`. `FURNITURE_CATALOG` row tagged `seat`, legal in `taproom`, `parlour`, `snug`, `hall`, `kitchen`.

Furnish counts scale with room area (existing `/ 7` rule) so a 20×12 diner dining room actually has a row of chairs, not three tables and a crate.

Pews stay the parish seat. Beds stay beds. Tables are **not** seats — they are the thing chairs sit at.

Canvas: `sit` draws the body lower on the chair tile; `sleep` draws on the bed; `stand` is today’s sprite. No new art this pass.

`Pose` on the wire includes `pose` and `usingId` so the client draws what the server claimed.

### 4.3 Gather interiors (new towns)

| Kind | Today interior | This pass |
|---|---|---|
| diner | 11×7 | **20×12** |
| night-market | 12×8 | **18×12** |
| parish | 12×10 | **16×14** |

Do not reintroduce `synthesizeLayout` clamps on explicit `layouts`.

### 4.4 Home kitchens (new towns)

Homes cook. Walk-ups and tenements get a **kitchen** room.

| Kind | Ground change | Interior size |
|---|---|---|
| walk-up | parlour + **kitchen** + bedroom (kitchen may sit on ground with the parlour; bedroom can stay upper) | **12×8** |
| tenement | hallway + **kitchen** + bedrooms | **16×9** |

Kitchen furniture: `hearth`, `counter`, chairs. `stockDefaults` already has dry-goods on homes — that is pantry. Eat-at-home consumes pantry the same way `buyFood` consumes shop stock (small, clamped).

### 4.5 Existing towns

`claimUse` runs everywhere. Old 11×7 diners stop stacking; extra souls wait at the door. No kitchen in old walk-ups until a new ward. No wipe.

---

## 5. Eating: many places, affinity, guests

### 5.1 Eat destinations

Stop hardcoding the diner UUID in `content/trees/eat.json`. New `sys:eat` token. The eat tree becomes:

1. Eat carried food if any (unchanged).
2. Else `moveTo sys:eat`, then eat (and buy/cook as needed).

`resolveWhere(sys:eat)` scores candidates and returns one `claimUse` dest:

| Candidate | When |
|---|---|
| Current building’s kitchen, if the soul is already inside and pantry > 0 | guests / already home |
| Own home kitchen, pantry > 0 | cook at home |
| Any building whose kind is tagged `eat` **or** whose stock includes a food commodity | public meal |

Shipped `eat` tags: diner, bakery, night-market. Parish is worship, not an eatery.

Kit: **two diners** (`count: 2`). Bakery and night-market already exist. Combined with home kitchens, meal-time is not one tile in Neon Mercy.

### 5.2 Food affinity

Per NPC, generated once, stored on the blackboard:

```
bb.eatAffinity: { home: number, kinds: Record<kindId, number> }
```

Weights are 0–1, sum does not need to be 1. Gen draws a preferred public kind (often diner, sometimes bakery / market) and a home-cook weight (householders/pensioners higher, runners lower). Not per-NPC LLM config — this is sim data.

Score for a candidate = `affinity[kind] or affinity.home` − `k * distanceInMinutes`. Highest wins. Overflow of that building falls through to the next score, then to the door of the last try.

Editable on **Person** and **You** this pass (Q8): sliders for home-cook vs each `eat`-tagged kind. Writes `bb.eatAffinity` via `patchNpc` / `patchPc`.

### 5.3 Guests

If soul B is **already inside** soul A’s home at meal time and that kitchen has pantry, `sys:eat` picks that kitchen for B (guest). No formal invite action this pass. A Character `move` to someone’s home, then a meal hour, is how guests happen in roleplay.

---

## 6. Conversation reliability

### 6.1 Never paint JSON as speech

`parseCharacter`:

1. Extract JSON object (existing).
2. On success: `speech` / `action` fields. If `speech` itself looks like JSON, treat as parse failure.
3. On failure: `{ speech: "", deltas: {}, parseError: true }`. **Do not** copy `raw` into `speech`.
4. Raw + parseError on the LLM trace. One line on `scene.debug`, not in `history`.

Empty speech + action → show `(action)`. Empty both → no bubble.

### 6.2 Graph stops on failure

A round is a cursor, not a fire-and-forget.

```
Session.round = {
  playerLine,
  pass: 1 | 2,
  acts: DirectorAct[],          // remaining, in order
  alreadyActed: string[],
  failed: null | { agent: "director" | "character", id?: string, error: string, attempts: number }
}
```

On a Director or Character **call** failure (timeout, HTTP, parseError, empty unusable payload):

1. Auto-retry **that same call** up to `effective.maxRetries` (default **2**). Same messages. Trace each attempt.
2. If still failing: set `round.failed`, `running = false`, `status.phase = "failed"`, banner with the error, **stop**. Do not run the next act. Do not start Director pass 2. Beats already applied stay.
3. Manual **Retry** (`{ type: "sceneRetry" }`): legal when `phase === "failed"` and `round.failed` is set. Re-runs **only the failed call**. On success, clear `failed`, continue the remaining `acts`, then Director pass 2 if it has not run and people still have not acted.
4. A new player Speak while failed: discards the paused cursor, starts a new round (same as today). Banner clears.
5. Cancel: abort in-flight auto-retries; if a failure was already recorded, keep the banner so Retry still works.

Characters still never run twice **successfully** in one round. Retry of a failed call is the same act, not a second beat.

### 6.3 Profile knobs

On **ConnectionProfile** (and allowed in agent-type overrides):

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `45000` | Per completion |
| `maxRetries` | `2` | Auto-retries after the first failure (so 1 try + 2 retries = 3 attempts) |

Effective resolution is the existing profile + override merge. Character and Director can differ (Director might want a longer timeout). Settings Profiles / Agents tabs expose both.

The orchestrator stops hardcoding `45000`.

### 6.4 Error banner

| Event | Banner |
|---|---|
| call failed after auto-retries | show, with Retry |
| Retry / auto-retry succeeds, graph continues | clear |
| `roundEnd` clean | clear |
| new player Speak | clear |
| snapshot / End | clear |

---

## 7. Ledger is live, and has a roster

### 7.1 Soul patches on the wire

Extend `Pose`:

```
needs, mood, relationships
pose: "stand" | "sit" | "sleep"
usingId?: string
```

`SessionClient.applyDelta` copies them. Inspector Person is live. After each Character `applyDeltas`, broadcast a delta (already per-tick; a beat should flush one immediately).

### 7.2 Resolve `"pc"`

`applyRelDelta` maps `"pc"` / `"PC"` / `"you"` to `world.player.id`.

### 7.3 People picker

One `PeoplePicker`: type filter on name, arrow + enter, capped scroll.

| Mount | Items | On pick |
|---|---|---|
| Ledger header | every NPC (not PC), hint = job · location | `select`, Person tab |
| Conversation Add | Here, not in scene | `sceneAdd` |
| Conversation Call | not Here, not in scene | `sceneCall` |

---

## 8. First MCP server

### 8.1 Shape

HTTP/SSE on the running app, path **`/mcp`**, same process as `/ws`, same `Session`. Tools wrap existing server functions. No second World. No auth on localhost. Stdio later. Catalog tools later.

### 8.2 Tools this pass

| Tool | What |
|---|---|
| `list_souls` | id, name, job, loc, pose, here-ness vs PC |
| `list_places` | buildings + rooms (id, name, kind, floor, room names, furniture counts) |
| `move_soul` | path named soul to a place, `claimUse` on arrival |
| `call_soul` | existing Call — join scene, body stays |

### 8.3 `move_soul`

```
{ npcId: string, to: { buildingId?: string, room?: string, floor?: number } | "sys:home" | "sys:work" | "sys:eat" }
```

- Path, not teleport. `commandNpcTo` / `commandPlayerTo`.
- Legal during a scene even when `control === "llm"`. This is the channel. `deltas.location` stays stripped.
- **Only the named soul walks.** Here participants do **not** auto-follow an NPC-led move (Q5). Called souls never move.
- On arrival, `claimUse` with a sensible prefer (`seat` in dining, `work` at `sys:work`, `sleep` at `sys:bed`, `cook` in a kitchen if they are the one making food).
- Returns destination label.

PC-led follow (player walks to another room, present scene mates follow) is unchanged from Play Layout §7.7.

### 8.4 Character may trigger their own move

Character JSON:

```
{"speech":"...","action":"...","deltas":{...},"move":{"buildingId":"...","room":"Dining"}}
```

After `applyDeltas`, if `move` is present, orchestrator calls `move_soul` for **that** id. Invalid `move` is ignored and traced.

Prompt: *If you are going to another room or building, set `move`. Speech first, then you walk. You do not move anyone else.*

Director still does not move bodies. Director **may** put “consider following Mara to the bakery” in someone else’s guidance on pass 2, or on the next round.

### 8.5 Others decide to follow

When a Here participant’s `move` actually starts:

1. Append the action to the thread (`(walks toward the bakery)` is enough).
2. Remaining **unacted** Here souls this round see it in their snapshot. They may emit their own `move` to the same place, or not.
3. Souls who **already acted** are done this round (Q10). They follow on a **later** round if the Director names them and they `move`.
4. Compact cards / snapshots include `loc` and last action, so “Mara is walking to Graveyard Shift” is knowable **to witnesses of that beat only** (§13).

---

## 9. Protocol and files

| Change | Where |
|---|---|
| `chair` tile, `claimUse`, `bb.usingId`, `bb.pose`, `bb.eatAffinity` | `types.ts`, `interiors.ts`, `ai.ts`, tests |
| Larger gather + home kitchens + second diner | `building-kinds.json`, `fenwick-ward.json` |
| `sys:eat`, eat tree, affinity sliders | `types.ts`, `eat.json`, `ai.ts`, YouPane, Person |
| Parse never dumps raw | `scene-parse.ts` |
| Round cursor, stop-on-fail, `sceneRetry` | `session.ts`, `orchestrator.ts`, `protocol.ts` |
| `timeoutMs`, `maxRetries` | `bundle.ts`, Profiles UI |
| Pose / needs / mood / rels / **events** on the delta | `protocol.ts`, `session.view`, `session-client` |
| `"pc"` → player.id | `applyDeltas` |
| `PeoplePicker` | Ledger + Conversation |
| Chip click vs ×, autoscroll | `Roleplay.tsx` |
| Witness-filtered history + `bb.memory` | ChatTurn, packer, persist |
| Director `add` / `remove` | Director parse + session |
| MCP `/mcp` | `list_souls`, `list_places`, `move_soul`, `call_soul`, `assign_task` |
| Character `move` / `call` / `task` | parseCharacter + orchestrator |
| `bb.tasks` interpreter | `ai.ts` / `world.step` |

Client still does not import `World.step`, `applyDeltas`, or nav.

---

## 10. Locked answers (2026-09-19)

| # | Decision |
|---|---|
| Q1 | Overflow waits at the door. Furniture is usable (stations, seats, beds, chairs). |
| Q2 | Multiple eat places + food affinity. Homes have kitchens. Guests can eat there. |
| Q3 | Retry **only the failed call**. Graph **stops** on failure. Success **resumes** remaining acts. |
| Q4 | Configurable auto-retries, default **2**. Configurable **timeout per profile**. |
| Q5 | Named soul moves. Others **know** and **decide** whether to follow. No engine auto-follow on NPC-led moves. |
| Q6 | HTTP `/mcp` on this process. |
| Q7 | look-up / move / call to start; **`assign_task` added this pass** (§16). Catalog authoring still later. |
| Q8 | Affinity **sliders now** on Person and You. |
| Q9 | Existing saves keep baked interiors. Generate a new ward for kitchens / big diner. |
| Q10 | Already-acted souls are **done this round**. No silent follow. |

---

## 11. Chat chrome

Today the whole participant chip is a remove button (`sceneRemove` on click). × is decorative.

- **Chip body** (portrait, name): `select` that soul and **open the Ledger** on Person. Does not remove them.
- **×** only: `sceneRemove`. Hit target is the ×, not the chip.
- Thread scroller **auto-scrolls to the bottom** when a beat arrives, when the player sends, and when the panel opens, unless the user has scrolled up (sticky-bottom; if they pull up, stay put until they return to bottom).

---

## 12. Chronicle is live, and includes the scene

Two bugs:

1. `w.log` on the server never reaches the client. `LiveDelta` has no `events`. ChroniclePane reads `world.events` from the hydrate, so it freezes at load.
2. Player lines are not logged. Character beats are (`orchestrator` `w.log` type `talk`), but the client still never sees them.

Fix:

- `LiveDelta.events`: last **80** `ChronicleEvent`s (the pane shows 60). `applyDelta` replaces `world.events`.
- Log **player Speak** (`actorId: pc`, summary = the line, `source: "llm"`).
- Log Character beats as today, plus `move` / `call` / leave as short summaries.
- Chronicle is the **ward public record**. It is not a Character’s ears. Packing must not feed this list to a soul as if they heard it (§13).

---

## 13. Knowledge isolation (imperative)

Today every Character pack gets `session.scene.history` in full. A soul Called in at 11pm hears the 8pm argument. That is a leak.

### 13.1 Witnesses on every beat

```
ChatTurn {
  role, speaker, speakerId, content, action, presence
  witnesses: string[]   // npc ids + "pc" who were in the scene when this beat landed
}
```

Witnesses = `scene.ids` ∪ `{pc}` at emit time. Called counts as present **for the wire** (they are on the call). Removed souls are not on later beats; they stay on the beats they already heard.

Player Speak stamps witnesses the same way.

### 13.2 Packing

Character pack history = current-scene turns where `witnesses` includes this id, in order, budget-trimmed newest-first as today.

Director pack may see the **current scene** thread in full (it is directing this table, not a soul). It does **not** get anyone’s `bb.memory`.

### 13.3 Durable per-soul memory

```
bb.memory: MemoryTurn[]   // cap 200; drop oldest
MemoryTurn { tick, speakerId, speakerName, content, action?, presence? }
```

After each witnessed beat, append that turn onto **each witness** (including the speaker). Autonomous sim events that happen *to* this soul (work, eat, a `tell` task) also append as system-like memory (`speakerId: "sim"`).

On Character pack, after the live scene slice, fill remaining history budget from **this soul’s** `bb.memory` that is not already in the scene slice. Never from another soul’s memory. Never from the global chronicle.

`snapshotNpc.recent` for LLM use: this soul’s memory tail, **not** `world.events` filtered by actor/target (that was leaking).

Persist `bb.memory` on the town save. Missing on old saves = `[]`.

The Ledger does not dump another NPC’s private memory. A count is enough.

---

## 14. Director may add and remove

Roleplay runtime §4.1 “Must not: add/Call” is **revoked**.

Director output:

```
{
  "acts": [{ "id": "...", "guidance": "...", "why": "..." }],
  "add":  [{ "id": "...", "how": "here" | "call" }],
  "remove": ["id"]
}
```

Order of apply, **before** the Character loop of that pass:

1. `remove` — `endRoleplay` those ids, drop chips. They are gone. Their memory keeps what they already heard. They do **not** witness later beats.
2. `add` — `here` only if `world.isHere`; else drop that add (do not silently Call). `call` = existing Call (body stays, chip + “called”). Invented ids drop.
3. `acts` — unknown / just-removed ids drop. Just-added ids are legal this same pass.

A Character who says they are leaving is flavor this beat. Director **pass 2 or the next round** is expected to `remove` them. Do not auto-remove from the speech.

Player Add/Call/× still work. Director is the LLM-side equivalent.

---

## 15. Characters may Call

Yes. `call_soul` is legal for a Character (MCP and beat JSON).

```
{"speech":"...","call":{"npcId":"..."}}
```

Same rules as the Call button: target not Here, not already in the scene, not the PC. Body does not move. Target joins **immediately** (chip, `control = llm`, witnesses from this beat on). They do not hear earlier beats (§13).

If this is still pass 1, Director pass 2 may put them in `acts`. If the round is already past that, they wait for the next player line.

A Character cannot `add` someone who is Here — that is the Add button or Director `add.how = here`.

---

## 16. Tasks on the blackboard (`assign_task`)

New MCP tool + Character JSON. This is how “go tell Mara what we said” becomes sim, not a hope.

```
assign_task {
  npcId: string
  steps: [
    { "op": "move", "to": { buildingId, room } | "sys:home" | "sys:work" | { "npcId": "..." } },
    { "op": "tell", "targetId": "...", "content": "..." }
  ]
}
```

Character beat: `"task": { "steps": [...] }` assigned to **self** only.

Stored as `bb.tasks: { id, steps, stepI }[]` (queue). Persist on the save.

**When they run:** only while `control === "autonomous"`. Queued during a scene; they start on End or Director/player remove. Utility goal selection yields to an in-flight task.

**Interpreter** (in `World.step`, not the LLM):

| op | Do |
|---|---|
| `move` | `commandNpcTo` / `claimUse` on arrival. `to.npcId` = path to that soul’s current loc (repath if they moved). Next step when arrived. |
| `tell` | If not colocated (same interior floor, or city within 3), keep waiting on this step (they should have `move`d first). If colocated: append `content` to **target** `bb.memory` (`speakerId` = the teller), log chronicle, bump familiarity a tick, `stepI++`. Target does not need to be in a scene. |

Empty queue → back to utility. Failed path: skip that step after a short lock so they do not wedge forever (log it).

Director does not assign tasks. Character (or MCP) does, and only for the named soul. Ava cannot queue work onto Tom except by `call`ing Tom and Tom agreeing on *his* beat.

---

## 17. Acceptance (additions)

9. Affinity sliders on You and Person write `eatAffinity` and change `sys:eat` picks on a fresh ward.
10. Chip name opens Ledger Person; × removes. Thread sticks to bottom on new beats.
11. After a scene beat, Chronicle tab shows it without reload.
12. Call Tom in at minute 20 of a scene: Tom’s Character pack has no beats from minute 0–19. Ava’s pack still does.
13. Director `remove` on a soul who said they were leaving: chip gone, they return to autonomous, queued `task` starts.
14. `assign_task` go-to-Mara + tell: after End, the soul paths to Mara; Mara’s `bb.memory` gains the message; a third soul who was not there does not.
15. MCP `call_soul` / `assign_task` / `move_soul` hit the live Session.

---

## 18. Open

None. Ready to implement.
