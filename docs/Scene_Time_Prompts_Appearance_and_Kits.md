# Scene Time, Prompt Packing, Appearance, Clothing, and Kits

**Status:** [spec_index.md](spec_index.md). Draft. Q1–Q7 locked 2026-09-20. Catalog editors / business types: child spec.  
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

**Locked Q1:** the **whole live session** uses 1 tick = 1 sim second while any scene is open (Hide counts). Not dual-rate. Not freeze-except-movement.

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

We stay on Chat Completions. **Locked Q2:** SillyTavern role split first (this soul = `assistant`, everyone else = `user` + `Name:`). Talemate *ONLY ACT AS X* + `Name:` in the content. Transcript-only is a follow-on if a provider mishandles mixed roles.

### 5.3 Pack for a Character (this pass)

```
system     Character book (you are {{name}}; only speak as {{name}})
user       Card + live snapshot + presented others (no leaked secrets)
…history   chronological, witness-filtered:
             PC beat     → role user,      content "{{pc}}: …"
             other NPC   → role user,      content "{{npc}}: …"
             this soul   → role assistant, content "{{name}}: …"
           latest player line is the last user beat in this list — do not append it again
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

**Self pack:** appearance, worn clothing as **one line** (§7.2), secrets, true ancestry.

**Other pack / compactCard:** presented appearance + one wearing line. If `concealed`, **omit ancestry**. Do not send `secrets` or `narrative.private`. If the ward is allowed to know they are not mundane, that is `concealed: false` **or** a sentence in `narrative.public` / open lore — never a leaked ancestry field on a concealed soul. The “Hi mr. demon” case is a bug; this spec exists to kill it.

Person / You: fields for appearance, secrets, concealed toggle. Secrets are labeled hidden and never shown on another person’s ledger. Unchecking concealed is how someone is publicly known; you can also write it in public lore without exposing `secrets`.

Gen: short appearance from sex/age/ancestry tables (data). `concealed = ancestry is non-mundane`. Secrets one line if concealed (“They pass as human; they are not.”) — editable after.

**Locked Q4:** non-mundane starts concealed. Compact cards omit ancestry. Public knowledge is open lore / unconceal, not a system leak.

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

### 7.2 What the LLM sees (one line)

Backend keeps the full item model. Prompts get **one descriptive line**, not a slot dump.

```
Wearing: a charcoal overcoat over a white shirt, dark trousers, and scuffed boots; wire glasses.
```

Built from visible layers only (overcoat hides jacket). Underwear/hosiery omitted unless they are the outermost visible piece (they are not, in normal dress).

If this room has unworn items:

```
Here, not worn: Mara's overcoat on the peg.
```

That is the reminder to pick it up. No JSON wardrobe in the Character pack.

**Locked Q3:** full item model on the server; condensed wearing line in the prompt.

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

## 8. Portraits

You and Person, click portrait:

1. **Pick an existing file** — stock set under `/portraits/` plus any portraits already referenced in this town.
2. **Upload** — file picker → square crop (pan/zoom) → confirm.

Upload path: client crops to square JPEG/WebP (max ~512px), stores as a `data:image/...;base64,...` on `soul.portrait` in the town save. Stock pick stores the path (`/portraits/mara.jpg`). No public CDN. No Grok image API.

Clear custom → back to the gen stock portrait.

**Locked Q7:** existing-file picker **or** upload+crop; custom result is a data-URL on the save.

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
- **People** number: default = sum of that kit’s roster counts. Slider/field. Scale **roster and home-kind building counts** proportionally (round, min 1 per row that had count ≥ 1). Do not invent jobs or home kinds. Work/gather buildings (diners, parish, …) stay at the kit’s authored counts unless the kit builder changed them. PC home is not scaled (§9.4).

`Session.create(name, seed, kitId, population)` .

### 9.3 Kit builder (start screen, no save loaded)

Kits are **JSON** in the same shape as `content/kits/fenwick-ward.json`.

- Shipped kits live in `content/kits/` and are **read-only** in the UI (duplicate to edit).
- Custom kits live as JSON files in a writable server directory (not git), e.g. next to PGLite data. The editor lists, opens, saves, deletes those files.
- **Download** a kit as `.json`. **Upload / import** a `.json` into the custom directory (validate UUID kit shape; reject illegal ages < 18).
- Fields: label, setting, building kind counts, home kinds, roster rows (job + count + ages), default PC job, PC age, unnamed-home pattern, **pcHomeKindId**.
- “Use this kit” fills the generation picker.

This is not “JSON download only.” The UI is the editor. Files are the source of truth. Import/export is how you share.

**Locked Q6:** JSON kit files + in-app editor + download/upload. Do not rewrite shipped Fenwick in git from the UI.

Visual BT editor is unchanged. Kit builder does not author trees or catalog rows (that is [Catalog Editors and Business Types](Catalog_Editors_and_Business_Types.md)).

### 9.4 Player home

Today the PC is stuffed into `homes[0]` — the first generated walk-up, which NPCs also fill. There is no PC-only building.

**This pass:**

- New building kind, tagged `home` + `pc-home` (or kit field `pcHomeKindId`). Shipped Fenwick gets a **Player’s rooms** kind: parlor, kitchen, bedroom, own wardrobe. Not a tenement.
- Kit always spawns **exactly one**. The People slider never scales it. NPCs are never assigned this building as `homeId`.
- `player.bb.homeId` is that building. You pane already shows home; it now points at a real unique place.
- Gen still drops the PC on the street at a gather door (current spawn). Their bed is in the player home.

Kit JSON:

```
pcHomeKindId: "<uuid of Player’s rooms>"
```

Omit / unknown → first `homes[]` kind (old behavior) so custom kits without a PC house still generate.

---

## 10. Decisions

| # | Locked 2026-09-20 |
|---|---|
| Q1 | Whole session at 1 tick = 1 sim second while a scene is live (Hide counts). |
| Q2 | Role-split history. This soul = `assistant`. Everyone else = `user` + `Name:`. Deepen later if needed. |
| Q3 | Full clothing model on the backend. Prompts get one `Wearing: …` line (+ unworn-in-room line). |
| Q4 | Non-mundane starts concealed. Compact cards omit ancestry. Public knowledge = open lore / unconceal. No “Hi mr. demon.” |
| Q5 | Scale **homes** with the People slider, not only roster. Work/gather counts stay as the kit authored them. PC home is always 1. |
| Q6 | Kits are JSON. In-app editor + download/upload. Custom files on the server, shipped Fenwick read-only. |
| Q7 | Pick an existing portrait **or** upload+crop. Custom = data-URL on the save. |

Q5 is locked. Catalog editors, ancestries through traits, and business types are **not this file** — [Catalog_Editors_and_Business_Types.md](Catalog_Editors_and_Business_Types.md).

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
| Kit picker + population + home scale | StartScreen, `Session.create`, `gen.ts` |
| Player home kind | `content/catalog/building-kinds.json`, kit `pcHomeKindId` |
| Kit builder | new start-screen pane, custom JSON dir |

---

## 12. Acceptance (after lock)

1. Open a scene, wait 60 real seconds at 1×: clock advanced ~1 sim minute, not 1 hour. End: back to minute ticks.
2. Two-person Speak “Hello A and B”: A’s pack ends with that line once; B’s pack is player then A; A is not `assistant` in B’s pack; retry does not duplicate the player line.
3. Concealed vampire in a scene with the PC: PC’s Character pack for a mundane neighbor does not contain the word of that ancestry or the secret text.
4. Remove overcoat to hook via Character `clothing` / MCP: presented dress loses the overcoat; room snapshot lists it; compact card for others matches.
5. Crop-upload a portrait on You; reload town; it is still there.
6. Start screen: pick Fenwick, set 24 people, create; roster is ~24 adults 18+, home buildings scaled down, **exactly one** Player’s rooms, no NPC `homeId` on it. Kit builder can duplicate Fenwick, change a job count, save, and generate from it.
