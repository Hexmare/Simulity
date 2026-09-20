# Scene Time, Prompt Packing, Appearance, Clothing, and Kits

**Status:** [spec_index.md](spec_index.md). Draft for discussion. Numbered questions in §10.  
**Depends on:** [Architecture Foundations](Architecture_Foundations.md), [Simulation Time](Simulation_Time_and_Routines.md), [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md), [Occupancy / MCP](Occupancy_Conversation_Ledger_and_MCP.md), [Data-Driven Catalog](Data_Driven_Catalog.md), [Urban Fantasy](Urban_Fantasy_Default_World.md)  
**Saves:** Scene-clock is session-only. Appearance / secrets / clothing / portraits persist on the town save. New kits persist as kit records (not a wipe). Missing fields default empty.  
**Non-negotiable:** Adults 18+ only. Concealed ancestry must never appear in another soul’s prompt. LLM never writes World directly — clothing changes are tools. Client has zero sim logic.

---

## 1. Problems

### 1.1 A hello lasts three hours

1 tick = 1 sim **minute** (`MINUTES_PER_TICK = 1`, `REAL_SECONDS_PER_TICK = 1`). A five-minute real conversation advances five sim hours. Meals end, shifts flip, people go to bed while you are still saying hello.

### 1.2 Packed history is wrong in two ways

`characterCall` does `buildMessages({ history: hist, message: playerLine })`.

`hist` is already the scene thread, including the player line just appended. `buildMessages` then **appends `playerLine` again** as a trailing user message.

For Character B, chronological `hist` is:

1. `user` — `Player: Hello A, and B`
2. `assistant` — `A: Hello player`

Then the trailer puts the player line **after A**. B’s model sees A greet first. Retry repeats the same pack, so the duplicate is visible there too.

Every NPC beat is `role: "assistant"`. The Chat Completions API treats `assistant` as *this model’s previous output*. B is trained to continue as A. A name prefix in the content is a weak patch on a strong role signal.

`compactCard` also ships `ancestry` for every participant to every Character pack. That is a concealment leak.

### 1.3 Bodies have no body

`narrative` is `{ public, private, voice }`. No physical description, no clothing, no secrets channel. Portraits are seven stock JPGs assigned at gen. You cannot upload or crop.

### 1.4 Generation is one kit, one size

`onCreate(name, seed)` → `new World(seed)` → `DEFAULT_KIT_ID` (Fenwick). No kit picker. Population is the **sum of `kit.roster[].count`** (Fenwick = 48 NPCs + 1 PC), not a single slider. Homes are a separate building count. Start screen has no kit builder.

---

## 2. Goals

1. While a scene is live, sim time runs at **1 tick = 1 sim second**, so talk does not skip hours.
2. Packed history is chronological, not duplicated, and **this soul is the only `assistant`**.
3. Every soul has appearance, worn clothing, and secrets. Other souls see presented appearance only. Non-human ancestry is hidden unless known.
4. Clothing is a real inventory (slots, ownership, room vs worn vs wardrobe). MCP + Character tools can wear / remove / hang / pick up. Prompt includes unworn items in the room.
5. Portrait upload with crop on You and Person.
6. Start screen: pick a kit, set population. Kit builder when no town is loaded.

---

## 3. Non-goals

- Changing 1× wall-clock (still 1 real second per tick). Speed 3 / 8 still scale both.
- Rewriting the Director/Character *philosophy* (JSON out, Director silent).
- Catalog authoring MCP, Summon, client prediction.
- Fashion simulation, dirtying, weather, sewing minigame.
- Generating portraits with an image model.
- Per-NPC agent bindings.

---

## 4. Scene clock

While `scene.ids.length > 0` (Hide included — the scene is still live):

| | Autonomous (no scene) | Scene live |
|---|---|---|
| Calendar per tick | 1 **minute** | 1 **second** |
| Ticks per sim hour | 60 | 3600 |
| Needs decay / tick | `decayPerHour / 60` | `decayPerHour / 3600` |
| Wall-clock at 1× | 1 real s / tick | 1 real s / tick |

`World.step` still runs. Autonomous NPCs keep living; they just experience slow time for the duration of the scene. A 10-minute conversation is 10 sim minutes, not 10 hours.

On End (empty scene): back to 1 minute/tick on the next step.

Movement stays tick-based (same tiles/tick). Walking a room during a scene takes the same real seconds as today; the **clock** no longer jumps a minute per step.

BT `waitTicks` / `durationMinutes`: interpret against the **current** tick length so a 30-minute wait is 30 ticks out of scene and 1800 ticks in scene. Do not leave someone frozen for a sim hour of wall-clock after End because the wait was queued in seconds.

Pause still pauses. Speed still multiplies the accumulator.

**Ask Q1** if the whole town should crawl, or only the clock display / scene participants.

---

## 5. Prompt packing

### 5.1 Diagnosis (code)

[src/lib/llm/packer.ts](../src/lib/llm/packer.ts) always ends with `current = playerLine`.  
[src/lib/server/orchestrator.ts](../src/lib/server/orchestrator.ts) `witnessedHistory` copies `h.role` (`user` / `assistant`) and prefixes `speaker:`. Then `characterCall` passes that plus `message: playerLine` again.

### 5.2 What other systems do

**Talemate** ([vegu-ai/talemate](https://github.com/vegu-ai/talemate)) does **not** map each speaker onto Chat Completions roles. Conversation templates (`dialogue.jinja2`, `dialogue-chat.jinja2`):

- Character sheets in a `CHARACTERS` section.
- Scene history as a **transcript of lines** (`scene.context_history(...)`) in a `SCENE` section.
- Task: *ONLY ACT AS {{ talking_character.name }}*.
- Response scaffold: `{{ talking_character.name }}:`.
- Director notes as acting instructions at the end, not as fake assistant turns.

**SillyTavern / group Chat Completions** (the pattern that fits our API):

- `system` = you are **this** soul.
- `assistant` = **only this soul’s** previous beats.
- Everyone else (PC and other NPCs) = `user`, content prefixed `Name: …`.
- Optional OpenAI `name` field on messages (many local servers ignore it; do not rely on it).

We stay on Chat Completions. Adopt the SillyTavern role split, Talemate’s *only act as X* + `Name:` line discipline, and a single transcript order.

### 5.3 Pack for a Character (this pass)

```
system     Character book (you are {{name}}; only speak as {{name}})
user       Card + live snapshot + presented others (no leaked secrets)
user       SCENE (optional, if we keep a block transcript — ask Q2)
…history   chronological, witness-filtered:
             PC beat     → role user,      content "{{pc}}: …"
             other NPC   → role user,      content "{{npc}}: …"
             this soul   → role assistant, content "{{name}}: …"   // or speech only; prefix still in content
user       (nothing extra — the latest player line is already the last user beat)
```

Rules:

- **Do not** pass `message: playerLine` into `buildMessages` if that line is already in `history`. Retry uses the same history; it must not append a second copy.
- Never emit `assistant` for another soul.
- Empty speech + action: still a beat, prefixed, counts as acted.
- Memory tail stays `[memory] Name: …` as **user** lines before the live scene slice (not assistant).
- Director pack: whole thread as a transcript in the snapshot (already is). No `assistant` impersonation. Do not duplicate the player line there either.

Prompt book, one added line: *You are {{name}}. Other people’s lines are context. Never continue as them.*

### 5.4 Tests

- After player Speak, Character A pack: last user message is the player line, once.
- Character B pack: order is player, then A, then (no trailing player). A is `user`, not `assistant`.
- Retry of B: identical messages to the failed B call; still one player line.
- Compact cards for others: no `ancestry`, no `secrets`, no unworn-at-home wardrobe.

---

## 6. Appearance, secrets, concealment

Add to `Npc` / PC (not the blackboard — identity, not a need):

```
appearance: string     // body: height, build, face, hair, distinguishing marks
secrets: string        // hidden truth. Non-human ancestry lives here, not in public.
concealed: boolean     // default true if ancestry is not the setting’s mundane human; else false
```

`narrative.private` stays backstage personality. `secrets` is facts others must not know (blood, nature, a second name). Do not merge the two.

**Self pack:** appearance, worn clothing, secrets, true ancestry.

**Other pack / compactCard:** presented appearance = `appearance` + worn clothing labels. If `concealed`, **omit ancestry** (today it is included — that is a bug relative to this spec). Do not send `secrets` or `narrative.private`.

Person / You: fields for appearance, secrets, concealed toggle. Secrets are labeled hidden and never shown on another person’s ledger.

Gen: short appearance from sex/age/ancestry tables (data). `concealed = ancestry is non-mundane`. Secrets one line if concealed (“They pass as human; they are not.”) — editable after.

---

## 7. Clothing

### 7.1 Data

Catalog: `content/catalog/garments.json` (UUID rows). Each row: `id`, `slug`, `label`, `slot`, `layer` (under / inner / mid / outer), `tags`.

Slots (closed engine union this pass):

`feet, socks, legs, underwear, underwearTop, undershirt, shirt, sweater, jacket, coat, overcoat, belt, hat, glasses, hosiery`

Layer order for “what you see”: overcoat → coat → jacket → sweater → shirt → undershirt, etc. A worn overcoat hides the jacket in **presented** appearance; the soul still has the jacket on unless they removed it.

World item:

```
ClothingItem {
  id, defId, ownerId, label?
  wornBy?: soulId        // currently on a body, slot from def
  loc?: Loc              // in a room (hook, chair, floor) — mutually exclusive with wornBy
  stored?: { buildingId, container?: "wardrobe" }
}
```

Ownership (`ownerId`) does not move when they hang a coat. Picking up someone else’s coat is allowed by the tool; the prompt can object in character. Do not auto-steal.

Each soul: `worn: Record<slot, itemId | null>`, plus a wardrobe list at home (items with `stored` at `homeId`).

Gen: a default outfit per sex from a small kit table (data). Wardrobe: 1–2 extra pieces at home. Adults 18+ only; underwear exists as items because removal is a scene tool, not because we author minors.

### 7.2 Presented dress

`presentedClothing(soul)` → short phrase from visible layers (“overcoat, boots, glasses”).  
`roomUnworn(loc)` → items in this room not worn: `{ label, ownerName }` (“Mara’s overcoat on the peg”).

Character live snapshot includes both for **this** room. Prompt line: *Items here that are not worn: … Do not forget them when leaving.*

### 7.3 Tools

MCP + Character JSON (same functions as Occupancy tools):

| Tool | Does |
|---|---|
| `wear_item` | `{ npcId, itemId }` — must own or be holding; slot must be free or we swap to hands/room |
| `remove_item` | `{ npcId, slot \| itemId, to: "hands" \| "here" \| "hook" }` — here/hook = `loc` in current room |
| `take_item` | `{ npcId, itemId }` — item in this room → hands / wear if slot empty |
| `store_item` | `{ npcId, itemId }` — only at home, into wardrobe |

Character beat: `"clothing": { "op": "remove", "slot": "overcoat", "to": "hook" }` after speech. Invalid ops drop and trace.

Leaving a building does **not** auto-wear. The prompt reminder is the nudge; the soul (or player via MCP) must `take`/`wear`. If they walk out in shirtsleeves, that is the fiction.

### 7.4 Player

PC has the same slots and wardrobe. You pane edits appearance/secrets and can wear/remove. WASD does not magically dress them.

---

## 8. Portrait upload + crop

You and Person: click portrait → file picker (image/*) → crop UI (square, pan/zoom) → confirm.

Client crops to a square JPEG/WebP (max ~512px) and sends `patchNpc` / `patchPc` with a `data:image/...;base64,...` (or a small upload intent). Server stores on the soul’s `portrait` field in the town save. No public CDN. No Grok image API.

Stock portraits remain the gen default. Clearing a custom portrait reverts to stock.

---

## 9. Kits, population, kit builder

### 9.1 What exists today (answer to “is it in the kit?”)

Yes. Population is **not** one number. Fenwick (`content/kits/fenwick-ward.json`):

- `buildings[]` — kind UUID + count (20 walk-ups, 4 tenements, 2 diners, …)
- `homes[]` — which kinds receive residents
- `roster[]` — job UUID + **count** + age band

Fenwick roster sums to **48 NPCs**. PC is extra (`pcAge`, `defaultPcJobId`). Homes must exist or gen stops placing people.

Start screen create: name + seed. Kit is hardcoded `DEFAULT_KIT_ID`. `allKits()` exists but is unused in the UI. `Session.create` does not take a kit id.

### 9.2 Generation screen (this pass)

When no town is loaded:

- **Kit** picker: `allKits()` plus any saved custom kits (label).
- **People** number: default = sum of that kit’s roster counts. Slider/field. Implementation: **scale roster counts** proportionally to the requested total (round, min 1 per row that had count ≥ 1). Do not invent jobs. If the number is smaller than the number of roster rows, drop remainder from the largest rows last. Homes: if beds < people, gen already overflows households; do not silently add buildings this pass (ask Q5).
- Seed, ward name, Create.

`Session.create(name, seed, kitId, population)` .

### 9.3 Kit builder (start screen, no save loaded)

A data editor, not a map painter.

- List kits (shipped Fenwick read-only duplicate-to-edit).
- Fields: label, setting, building kind counts, home kinds, roster rows (job + count + ages), default PC job, PC age, unnamed-home pattern.
- Save as a **custom kit** in the server store (PGLite), not by rewriting `content/kits/*.json` (shipped files stay shipped). Shipped Fenwick remains the default.
- Delete custom only.
- “Use this kit” fills the generation picker.

Visual BT editor is unchanged. Kit builder does not author trees or catalog rows.

First cut is counts and labels. Names lists, ancestry mix, garment defaults: later if needed.

---

## 10. Questions

Number your answers.

**Q1. Scene clock scope.** Proposed: **whole live session** runs at 1 tick = 1 sim second while any scene is open (Hide counts). Autonomous NPCs crawl. Alternative A: freeze `World.step` except movement/animate during a scene (town clock frozen). Alternative B: dual rate — scene participants on seconds, everyone else still on minutes (one clock display would lie).

**Q2. History shape.** Proposed: Chat Completions role split (this soul = `assistant`, everyone else = `user` + `Name:`). Talemate-style single SCENE transcript as one user block is the fallback if a provider mishandles mixed names. Alternative: transcript-only (all history in one user message, no per-beat roles).

**Q3. Clothing this pass.** Proposed: all slots listed in §7.1, default outfits, wardrobe at home, four tools. Alternative: worn string only (no items, no hang-the-coat) and delay the item model.

**Q4. Concealment default.** Proposed: any ancestry that is not the kit’s mundane human starts `concealed: true`, secrets one generated line, compact cards omit ancestry. Player can unconceal on Person. Alternative: concealed only when a catalog flag on the ancestry row is set.

**Q5. Population vs buildings.** Proposed: scale **roster only**; do not add walk-ups if you ask for 80 people. Overflow shares beds. Alternative: scale home-kind counts too so beds roughly match.

**Q6. Custom kits persist where.** Proposed: PGLite kit table (survives restart, not in git). Alternative: download/upload JSON only, no server list.

**Q7. Portrait storage.** Proposed: cropped data-URL on the soul in the town save (simple, save files get larger). Alternative: blob table keyed by soul id.

---

## 11. Files (when we implement)

| Change | Where |
|---|---|
| Scene tick length | `session.ts` tick, `world.time()`, duration helpers |
| Pack roles + no duplicate | `packer.ts`, `orchestrator.ts`, tests |
| compactCard concealment | `orchestrator.ts` |
| appearance / secrets / concealed | `types.ts`, persist, You/Person |
| garments catalog + items | `content/catalog/garments.json`, `world.ts`, MCP |
| Portrait crop | YouPane, Inspector, patch intent |
| Kit picker + population | StartScreen, `Session.create`, `gen.ts` |
| Kit builder | new start-screen pane, store |

---

## 12. Acceptance (after lock)

1. Open a scene, wait 60 real seconds at 1×: clock advanced ~1 sim minute, not 1 hour. End: back to minute ticks.
2. Two-person Speak “Hello A and B”: A’s pack ends with that line once; B’s pack is player then A; A is not `assistant` in B’s pack; retry does not duplicate the player line.
3. Concealed vampire in a scene with the PC: PC’s Character pack for a mundane neighbor does not contain the word of that ancestry or the secret text.
4. Remove overcoat to hook via Character `clothing` / MCP: presented dress loses the overcoat; room snapshot lists it; compact card for others matches.
5. Crop-upload a portrait on You; reload town; it is still there.
6. Start screen: pick Fenwick, set 24 people, create; roster is ~24 adults 18+. Kit builder can duplicate Fenwick, change a job count, save, and generate from it.
