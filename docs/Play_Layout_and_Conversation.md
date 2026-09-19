# Play Layout and Conversation

**Status:** Implemented. Decisions §10 Q1–Q7 locked 2026-09-19. Q6 = no warn, no cap.  
**Depends on:** Architecture Foundations §2.6, [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md), [Server Authority and Transport](Server_Authority_and_Transport.md), [Occupancy, Conversation, Ledger, and MCP](Occupancy_Conversation_Ledger_and_MCP.md)  
**Saves:** No world-save change. Layout sizes live in the browser, not the town. Conversation is ephemeral (same as today).  
**Non-negotiable:** Adults 18+ only. No Grok/xAI branding. No illegal-activity systems. Server remains source of truth; LLM never writes the sim directly.

---

## 1. Problem

The play shell was one right-hand **Ledger**. Too many jobs shared that column, and none of them fit it.

Observed on `main` before this spec landed (`work/2026-09-19` = `27cffde`):

1. **Ward and PC are the same form.** Selecting the player (or selecting nobody) on the Person tab renders `FoundingPane`: town rename, PC orientation/ancestry/public/voice, add villager, raise a house. The Town tab renders the same pane again. There is no dedicated Player surface. The PC's given name is hardcoded `"You"` at generation; `patchVillager` already accepts a PC name, but the UI never exposes it. Age, sex, private history, traits, and portrait are not editable for the PC at all.

2. **Chat hijacks the Ledger.** `talkId` replaces the entire Inspector with `Roleplay`. You cannot read the chronicle, inspect another soul, or keep the map context while talking. The thread is a 380px sidebar, not a conversation window.

3. **Nothing is resizable.** Desktop Ledger is a fixed `md:w-[380px]`. Mobile Ledger is a fixed `h-[62%]` bottom sheet. Canvas / Ledger / (future You / Chat) cannot share space by dragging.

4. **Conversation is 1:1.** `talkId: string | null`, `startRoleplay(npcId: string)`, one snapshot, one `speech` string. Architecture already says the PC may engage **one or more** NPCs. The sim can pause several souls (`bb.control = "llm"`). The UI and the roleplay JSON contract cannot.

The player experience this produces: click yourself to fiddle with the ward; click Speak and lose the Ledger; never talk to two people at a table.

---

## 2. Goals

1. **You** (the PC) is a first-class, always-available editor on the **left**. Name, history, voice, body, ancestry, job, home — not mixed with town founding. Job and home are **passive facts** the rest of the ward (and the LLM) can know; they do not put the PC on the autonomous work/sleep loop.
2. **Conversation** is a first-class, full-width **bottom** window. It never lives in the Ledger. It supports one NPC or several. **Add** is same-place only. **Call** is the explicit exception that pulls a soul who is not here (button now, MCP later).
3. **Ledger** (right) stays the world inspector / authoring surface: selected soul, building, tree, chronicle, town, settings.
4. **Every region is user-sizable.** Open, close, drag to expand or contract. Canvas keeps the leftover space.
5. **The PC can move during a scene.** Present participants follow room-to-room. Called (remote) participants do not.

---

## 3. Non-goals

- Redesign the Behavior Tree editor, Plan editor, or Kinds/Jobs authoring internals.
- Persist conversation history across town loads (still out of scope; chronicle events remain the long-term record).
- Voice, video, or generated portraits.
- Spatial voice / “everyone in the room auto-joins” as an autonomous sim feature. Joining a scene is a player action (Speak, Add, or Call).
- **Summon** as body relocation (teleport / path-to-PC, then they are Here). Named so it is not confused with Call. Not this pass. Call does not move the body.
- Changing the Blackboard reconciliation protocol except to apply **per-NPC** deltas in a multi-party scene.
- Multiplayer / multiple human PCs.

---

## 4. Shell: four regions

Desktop play (after this change):

```
┌─────────────────────────────────────────────────────────────┐
│ Header (town, clock, location, save, Wards, pause, speed,    │
│         You toggle, Ledger toggle, Conversation toggle)      │
├──────────┬────────────────────────────────────┬──────────────┤
│ YOU      │ CANVAS                             │ LEDGER       │
│ PC ident │ map, follow, walk, door prompt     │ person/tree/ │
│          │                                    │ chronicle/   │
│          │                                    │ town/settings│
├──────────┴────────────────────────────────────┴──────────────┤
│ CONVERSATION  participants · thread · compose                │
└─────────────────────────────────────────────────────────────┘
```

| Region | Edge | Default | Closed means |
|---|---|---|---|
| You | left | 320px, **closed** until opened | Canvas expands left |
| Ledger | right | 380px, **open** (same as today) | Canvas expands right |
| Conversation | bottom | 280px, **closed** until Speak | Canvas expands down |
| Canvas | center | leftover | never fully gone |

Header stays a fixed 56px chrome. It is not a resizable region.

### 4.1 Slide vs dock

Panels **dock**. They take space; they do not overlay the map. Opening is a short slide (the region grows from 0 to its saved size). That matches “slide out” and “drag to expand/contract” at once: the map always remains fully visible in whatever rectangle is left.

Overlay-on-map is rejected for desktop. Overlay is how the current mobile 62% sheet works, and it hides the thing you are talking about.

### 4.2 Drag handles

- Vertical splitter between You and Canvas.
- Vertical splitter between Canvas and Ledger.
- Horizontal splitter between the three-column row and Conversation.

Constraints:

| Region | Min | Max |
|---|---|---|
| You | 260px | 480px |
| Ledger | 280px | 560px |
| Conversation | 160px | 50% of viewport height |
| Canvas | 320×240px | leftover |

Dragging below min **closes** that region (size snaps to 0, toggle goes inactive). Re-opening restores the last open size, not the min.

Double-click a splitter: restore that region's default size.

Sizes persist in `localStorage` key `simulity.layout` (`{ you, ledger, conversation, youOpen, ledgerOpen, conversationOpen }`). Not written to the town save. Layout is chrome, not world state.

### 4.3 Header toggles

Replace the single `PanelRight` button with three:

- **You** — open/close left drawer. Opening does **not** change Ledger or Conversation.
- **Ledger** — open/close right drawer. Current `PanelRight` behavior, minus chat.
- **Speak / Conversation** — open/close the bottom window. Closing the window does **not** by itself end the scene (see §7.5). A distinct **End** control inside the conversation does.

While a scene is active, the Conversation toggle shows a mark (dot / count of participants) so a closed thread is not lost.

### 4.4 Mobile / narrow

Below the current `md` breakpoint:

- Only **one** side region is open at a time: You, Ledger, or Conversation.
- Each is a bottom sheet whose height is the saved Conversation height (drag the top edge).
- Header toggles are mutually exclusive.
- Canvas remains the top remainder.
- Door prompt / joystick stay on the canvas, not inside a sheet.

This is a constraint, not a third layout invention. Same regions, one-at-a-time.

---

## 5. You (left) — Player Character only

Dedicated editor for `world.player`. Opening it does not select an NPC in the Ledger. Clicking the PC on the canvas **opens You** and does **not** dump Founding into the Person tab.

### 5.1 Fields

All adults 18+. `patchVillager("pc", …)` is the write path (already exists; extend the allowed patch keys as needed).

| Field | Today | After |
|---|---|---|
| Name | generated `"You"`, not in UI | editable; empty restores `"You"` |
| Age | kit `pcAge`, not in UI | number, clamped 18–110 |
| Sex | generated, not in UI | Female / Male |
| Orientation | in FoundingPane | here |
| Ancestry | in FoundingPane | here |
| Portrait | shipped `/portraits/player.jpg` | preview; keep shipped image this pass (no upload pipeline) |
| Known about town (`narrative.public`) | in FoundingPane | here |
| Backstage (`narrative.private`) | generated, not in UI | here. Editor + roleplay packer only, same rule as NPCs |
| Voice | in FoundingPane | here |
| Traits | generated, not in UI | same chip picker as `NpcEditor`, max 4 |
| Job | kit default, not in UI | picker, same list as `NpcEditor`. **Passive:** writes `bb.jobId` and runs `assignWorkplace` so snapshots can say “baker at the kiln.” The PC does not take work goals, collect wages, or get locked to a shift. |
| Home | kit first house, not in UI | picker of home-tagged buildings. **Passive:** writes `bb.homeId`. No bed assignment this pass. NPCs and the LLM may know you live there. |
| Coin | displayed on Town tab only | read-only here |

`patchVillager("pc", …)` today only applies name / orientation / ancestry / narrative. This pass also applies age, sex, traits, `jobId`, `homeId` on the PC branch. Age still clamped 18–110.

**Not in You:** town name, setting bible, add villager, raise house, kinds/jobs catalog, LLM provider, bed, family/spouse. Those stay in Ledger Town / Settings (or later).

### 5.2 Intentionally omitted this pass

- PC bed assignment. Home building is enough for “they live at the cottage.”
- PC family / spouse editors.
- Live needs / mood meters for the PC. The PC is not on the autonomous need tick the way NPCs are. Do not fake bars.
- PC workplace *overrides* beyond what `assignWorkplace` already does for the chosen job.

### 5.3 Click-PC behavior

| Input | Today | After |
|---|---|---|
| Click PC | Ledger Person → FoundingPane | Open **You**. Ledger selection clears to “no soul” (Person tab shows the empty hint, not Founding). |
| Double-click PC | camera follow | unchanged |
| Click NPC | Ledger Person for that soul | unchanged (Ledger) |
| Click building | Ledger building pane | unchanged (Ledger) |

---

## 6. Ledger (right) — world, not chat, not You

Keep the existing tabs: **person / tree / chronicle / town / settings**.

Changes:

1. **Person, empty or PC selected:** stop rendering `FoundingPane`. Hint only: “Select a townsperson, or click a building.” PC identity lives in You. If a building is selected, Building pane is unchanged.
2. **Town tab:** keep census, purse, setting line, places, job counts, **Founding stripped of the “You” block**. Town rename, add soul, raise house, Kinds/Jobs stay here. That is ward configuration, reachable without clicking the PC.
3. **Settings:** unchanged (setting bible + roleplay provider).
4. **Speak** remains on the NPC Person pane. If that soul is **Here** (see §7.3), it opens or joins Conversation. If they are not Here, Speak is disabled (or hidden) — use **Call**. It does **not** replace the Ledger.
5. Roleplay no longer mounts inside the Ledger column.

Selecting a participant who is currently in the open scene does not end or steal the scene. Ledger is observation; Conversation is the scene.

---

## 7. Conversation (bottom) — full-width scene

A chat window. Full width of the play shell (under You + Canvas + Ledger). Not a column.

### 7.1 Anatomy

```
[ Ava Chen  × ] [ Tom Ward  × ] [ + Add ] [ Call ]            [ End ]
────────────────────────────────────────────────────────────────────
You    I thought I might find you both here.
Ava    The stew's honest today. Sit if you're staying.
Tom    (nods at the empty stool)
────────────────────────────────────────────────────────────────────
[ Say something…                                          ] [ Speak ]
```

- Header: participant chips, **Add** (Here only), **Call** (not-Here), **End**. Hide is the shell Conversation toggle, not this header. Chip **body** (portrait/name) opens that soul in the Ledger Person tab. Chip **×** removes them from the scene. Spec: [Occupancy §11](Occupancy_Conversation_Ledger_and_MCP.md).
- Thread: full-width messages, labeled by speaker. Auto-scrolls to the bottom on new beats unless the player has scrolled up.
- Thread: full-width messages, labeled by speaker. Player lines muted; NPC lines body color. Optional short `(action)` on its own line under that speaker, as today. Called participants get a small “called” mark on their chip and on their beats so it is obvious they are not in the room.
- Compose: one input, one Speak. `maxLength` 800 stays. WASD / click-to-walk / joystick work whenever compose (or any other field) is **not** focused. Opening a scene does **not** globally eat movement.
- Offline / debug / usage line stay, collapsed under a “Debug” control so they do not eat the thread.

Default height 280px. Drag the top edge. Close via the header Conversation toggle (hides the window, **scene continues** — NPCs stay `control = "llm"`). End via **End** only.

### 7.2 Starting a scene

| Action | Result |
|---|---|
| Person pane **Speak** on NPC A who is Here | Open Conversation if closed. Participants = `{A}`. `startRoleplay(A)`. |
| Speak on NPC B who is Here, scene already open | **Add** B to the current scene (do not replace A). |
| Speak on someone who is not Here | No-op. Use **Call**. |
| Conversation **+ Add** | Picker of Here-only souls (see §7.3). |
| Conversation **Call** | Picker of not-Here souls (see §7.3.1). |
| Conversation toggle (hide) | Window closes. Scene stays live. |
| End | `endRoleplay` every participant. Clear thread. Close the window. |

There is no 1:1 special-case component. One NPC is a scene with one participant.

`window.__sim.talk(id)` keeps working as a test/MCP backdoor: it adds `id` even if they are not Here (same as Call). It must **not** `setPanel(true)` as a chat host.

### 7.3 Who can be added (Here)

**Add** and **Speak** only list / only succeed for NPCs who are **Here**:

- Same interior building **and** floor as the PC, or
- Both on the city layer, within **3 tiles**.

Exclude: the PC, current participants, anyone already in this scene.

This is the diegetic rule: you sit down with the people in the room. Walking into the next room updates Here (see §7.7). People you pass on the street do **not** auto-join.

Removing a chip is **× only**. That NPC `endRoleplay`s immediately (returns to autonomous with no extra delta) and is gone from the thread header. Prior messages stay in the thread as history. Clicking the chip body does not remove them; it selects them in the Ledger.

An empty participant list after removals is an empty scene: compose is disabled until someone is Added or Called, or End clears it.

### 7.3.1 Call (not Here)

**Call** is the explicit exception to Here-only. Button on the Conversation header. Same action as MCP `call_soul` and as Character JSON `"call"`. Spec: [Occupancy §15](Occupancy_Conversation_Ledger_and_MCP.md).

| | Add / Speak | Call |
|---|---|---|
| Who | Here | Anyone not Here (and not already in the scene) |
| Body | already present | **does not move** |
| Chip | plain name | name + “called” |
| LLM | they are in the room | they are attending at a distance (sending, wire, whatever the setting bible makes of it). They must not hand you objects or walk across the floor. |
| Pause | `startRoleplay` | `startRoleplay` |

Call may **start** a scene (phone from the street) or join an existing one.

Call is not **Summon**. Summon would relocate the body to the PC and then they would be Here. Summon is out of this pass (see §3). If we want both later, they are two tools, not two labels for one thing.

MCP: `call_soul`, same semantics as the button. Character agents may invoke it. No extra sim rules.

### 7.4 Group turn contract

**Superseded.** One-shot `beats[]` from a single completion is not the runtime.

Each player Speak runs the **Roleplay Agent Runtime**: Director pass 1 → Character agents in order → Director pass 2 (only souls who have not acted) → leftover Character agents → player's turn. Each Character call returns today's `{ speech, action, deltas }` for that one id. Deltas apply before the next agent runs.

Full protocol, packing, failure, and cancel: [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md).

Layout still owns: who is in the scene, Here vs Call, hide vs End, follow, thread rendering. The runtime owns: who speaks this round and how.

Paused set = current participants. Adding or Calling mid-scene includes them on the **next player Speak**, not the in-flight round.

### 7.5 Close vs End

Two different controls. Confirmed.

| Control | Where | Window | Scene | History |
|---|---|---|---|---|
| Conversation toggle | play header | closed | **still active**, NPCs stay paused | kept |
| **End** | Conversation header | closed | all participants `endRoleplay` | discarded (chronicle already has talk / talk-end) |
| Last chip removed | Conversation | stays open, empty | no one paused | kept until End |

End is a real button, labeled **End**, always visible in the Conversation header while the window is open. Hiding the window is how you look at the map or the Ledger without releasing the souls. Speed / pause still apply to everyone not in the scene.

If the window is hidden and the scene is live, the header Conversation toggle shows a mark (participant count). Clicking it reopens the same thread. There is no second End in the play header — End lives with the thread.

### 7.6 Thread rendering for groups

Each beat is one bubble:

```
Ava · The stew's honest today.
     (sets a bowl down)
```

Called beats:

```
Mara (called) · I can hear the kettle from here. Don't wait on me.
```

Player Speaks are one bubble labeled with the **PC name** (not the literal `"You"` if they renamed). Order = model beat order, then we do not reorder.

### 7.7 Movement during a scene

The PC must be able to walk a scene from room to room (and street to door, stairs, etc.). Today `talkId` globally swallows WASD. That goes away.

**Player**

- WASD, click-to-walk, joystick, interact (E / door prompt) work during a live scene whenever a text field is not focused.
- Compose focused → keys go to the input, same as any other field (`data-roleplay-input`).
- Follow-camera and walk-mode unchanged.

**Present participants (not Called)**

- They **follow the PC**. BT stays paused (`control = "llm"`). Bodies still animate on a path.
- Trigger: PC's location (building, floor, or city tile) changed and the follower is not already in range (same interior floor, or city within ~2 tiles).
- **NPC-led moves** (Character `move` / MCP `move_soul`) do **not** auto-follow. Only the named soul walks. Other Here souls see the action in the thread and may `move` themselves. Spec: [Occupancy, Conversation, Ledger, and MCP](Occupancy_Conversation_Ledger_and_MCP.md) §8.
- Pathing uses existing staged nav (room → stairs → door → street). No new nav system.
- If the path fails they stay put. The next snapshot will disagree with the PC's location; the LLM can remark on it. No teleport-to-follow.
- Beat `location` deltas for present participants are **ignored** while the scene is live. Player movement is the body authority for people who are Here. Needs/mood/relationships/knowledge/events still apply.

**Called participants**

- Body stays where it was. They do not follow. Their autonomous BT stays paused.
- Beat `location` deltas for Called participants are also ignored this pass (a phone call should not warp the baker). Revisit if we want “they hang up and start walking over.”

**Here updates as you walk.** Walk into the parlor, **+ Add** lists the people in the parlor, not the kitchen you left. Participants you already have stay in the scene even if you outpace them for a moment.

Walking past someone does not add them. Speak / Add / Call are still the only join verbs.

---

## 8. Sim / contract changes (minimal)

Frontend-first, but group chat is not UI-only.

| Surface | Change |
|---|---|
| `World.startRoleplay` | Accept one id or many. No-op on PC / missing. Already-paused NPCs stay paused. Log one event listing names. Optional presence (`here` \| `called`). |
| `World.endRoleplay` | Accept one id or many. |
| `World.patchVillager("pc")` | Also apply age, sex, traits, `jobId`, `homeId` (job runs `assignWorkplace`). |
| `roleplayTurn` parse | Prefer `beats[]`; fall back to 1:1 `speech`. |
| Prompt book | Scene system text: several named people, PC identity including job/home, presence `here`/`called`, “only these ids speak.” |
| Scene follow | Present (not Called) participants path toward the PC when the PC changes room / floor / building. Ignore location deltas on participants while the scene is live. |
| `Roleplay.tsx` | Unmount from Ledger; mount as the bottom region; participant set + Call in app state. |
| `SimulityApp` | `talkId: string \| null` → `talkIds: string[]` plus per-id presence. Layout state. Three toggles. Splitters. Stop swallowing WASD merely because a scene is live. |
| `FoundingPane` | Delete the “You” block. Keep town / new soul / new house. |
| `PersonPane` | PC / empty no longer renders Founding. Speak disabled when the soul is not Here. |
| New `YouPane` | Left region, including job + home. |
| Tests | Parser tests for `beats` + 1:1 shim. `startRoleplay` with two ids pauses both. PC patch of job/home. Follow: PC changes floor, present NPC gets a path, Called NPC does not. Speak on a not-Here soul does not join. |

No catalog / kit / UUID changes. No tick-rate changes.

---

## 9. Acceptance

1. Rename the ward and add a villager from Ledger → Town without selecting the PC.
2. Open You from the header (and from clicking the PC). Set name, age (≥18), sex, ancestry, job, home, public, private, voice, traits. Those values appear in the next roleplay pack for any scene. The PC does not start autonomously working the chosen job.
3. Speak with one NPC who is Here: Conversation opens at the bottom, Ledger stays, canvas shrinks vertically. Thread is full width.
4. Add a second NPC who is Here via **+ Add**. Both show chips. Both `bb.control === "llm"`. Everyone else still ticks. **+ Add** does not list someone on another floor.
5. **Call** a third NPC who is across town. Their chip is marked called. Their body does not move. Their beats are labeled called. They stay paused.
6. One player Speak runs the agent round ([Roleplay Agent Runtime](Roleplay_Agent_Runtime.md)). Beats appear as each Character returns. Deltas apply to that NPC only. Location deltas on participants are ignored while the scene is live.
7. Hide Conversation: souls stay paused. **End** (Conversation header, not the hide toggle): they resume. Remove one chip: that soul resumes, the others stay.
8. During a live scene, unfocus compose, walk the PC into the next room. Present participants receive a follow path. The Called participant does not. WASD works. Typing in compose does not walk.
9. Drag You / Ledger / Conversation sizes. Reload the page: sizes and open/closed flags restore. Town save does not contain them.
10. Below `md`, only one of You / Ledger / Conversation is open. Height still drags.
11. `npm test` and `npm run typecheck` stay green. Roleplay tests follow the agent runtime, not a one-shot `beats[]` shim.

---

## 10. Decisions and remaining questions

### Locked 2026-09-19

**Q1. Who can join.** Add / Speak = **Here only**. **Call** is the explicit not-Here join: button now, MCP later, body does not move. Summon (relocate then Here) is a different tool, not this pass.

**Q2. Hide vs End.** Hide keeps the scene. **End** is a separate button on the Conversation header.

**Q3. PC job / home.** In You this pass. Passive facts for NPC/LLM knowledge. No autonomous PC work loop. No bed editor.

**Q4. Default You.** Still **closed** (not discussed; leaving the draft default). Revisit if first-run discoverability is a problem.

**Q5. Movement during a scene.** Yes. Keys work when compose is not focused. Present participants follow room-to-room. Called participants stay put. See §7.7.

**Q6. Participant count.** No warn, no cap. Bigger scene, longer round. Player accepts the latency.

**Q7. Speak while a scene is live.** Add if they are Here. Do not replace. Not-Here → use Call.

Chrome (splitters, You, Conversation) is a view. Intents and World live on the server ([Server Authority](Server_Authority_and_Transport.md)). This spec does not put `talkIds` or `applyDeltas` in React.

---

## 11. Suggested cut (if we implement as written)

1. Shell splitters + You / Ledger / Conversation regions + local layout persistence. Founding “You” block moves to YouPane (including job + home). Ledger no longer hosts Roleplay. Canvas is a renderer against the server view model ([Server Authority](Server_Authority_and_Transport.md)).
2. Participant set as **intents** (Here-only Add, Call, hide vs End, follow on the server).
3. Conversation Speak is a `speak` intent. Thread paints `scene.beat` events from the [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md). Call’s MCP twin is a follow-on after the button exists.

Step 1 is already a better game if we never ship group chat. Steps 2–3 are the group-chat slice Architecture already promised. Call’s MCP twin is a follow-on after the button exists.
