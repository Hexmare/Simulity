# Simulity — next work (spec / todo)

Living list. Check items as they ship. Each wave is playable on its own; later waves depend on earlier ones only where noted.

**How to read this.** *Now* is what the borough already does. *Want* is the change. *Done when* is the acceptance bar. Do not gold-plate past the bar.

**Non-goals for this whole list.** Cloud/auth. 3D. 500+ agents. LLM writing sim state directly.

Romance that **is** in: orientation, named bonds (friend / sweetheart / partner / spouse), the existing `flirt` dice, shared beds as a sleep assignment for partners. All of that stays PG — courtship and household, never sex.

This lock applies to sim defs, editors, generation, chronicle text, and the LLM roleplay prompt. If a later ask conflicts with it, keep the lock.

---

## Snapshot — now vs next

| Area | Now | Next |
|---|---|---|
| Camera | Locked follow, fixed zoom, no pan | Wheel zoom, drag pan, follow is optional |
| Click | Any mouse button on ground/building issues a walk | Left = select soul or roof. Middle = walk. Right does not walk |
| Re-click while walking | New path is planned from the last snapped tile (`loc`), so the PC often walks **back to the original start** then out | Replan from current `px/py`. Keep walking toward the new point. No rewind |
| Floorplans | Generated rooms, 1–2 stories, furniture as tiles. No editor | Paint walls/rooms, add/remove floors, basements |
| Furniture / beds | Tiles exist. Beds are a pool. No owner | Place/remove furniture. Assign owner to a bed / bedroom |
| Building types / jobs | Fixed enums in defs. Editor can pick from the list | Author new kinds and jobs on the borough, persist them |
| Age | Everyone ≥ 18. No generated children | — |
| Kin | Parents, siblings, spouse. Adult children only | — |
| Orientation | Orientation on the soul. Romance actions respect it | — |
| Bonds | Named status: friend, sweetheart, partner, spouse | — |
| Economy | Work is a schedule + need delta. `buyFood` conjures a meal | Coin, stocks, jobs produce/consume, wages, real meals |
| Setting | Generic living township. No ancestries, no magic | **Urban fantasy.** Humans, demons, angels, vampires (+ overlay). Magic is real and data-driven |
| Narrative | Snapshot is numbers (needs, job, traits) | Each soul has a written bio/voice used in roleplay |
| LLM | Hardcoded xAI Chat Completions. No settings | OpenAI-compatible endpoint, prompt book, context budget, turn protocol |

---

## Wave 1 — Camera, click, walk — SHIPPED

Play-feel. Do this first. Nothing else in this doc depends on it except “select then edit.”

### 1.1 Zoom and pan

- [x] **Wheel zooms** toward the cursor, city and interior.
- [x] **Drag pans.** Left-drag on empty ground pans (a click with no drag still selects / deselects). Pinch-zoom on touch.
- [x] Zoom range roughly **8–48** px/tile (today the city camera sits at 16).
- [x] **Follow is optional.** Camera starts following the PC. The moment the player pans or zooms, follow drops. A small control (or double-click the PC) re-attaches.
- [x] Interior view uses the same camera math (no more “fit the floor and freeze”).
- [x] WASD / stick still walk. They do not fight a free camera.

**Done when.** Wheel in, wheel out, drag the map, walk, the borough does not rubber-band the camera back unless follow is on.

### 1.2 Click meaning

Today `onPointerDown` ignores `button`, so left / middle / right all run the same path: hit soul → select, hit roof → select **and** walk to the door, empty tile → walk.

- [x] **Left click**
  - Soul → select that soul (open their page in the ledger). Do **not** walk.
  - Roof / interior wall of a building → select that building. Do **not** walk, do **not** auto-enter.
  - Empty ground → deselect. Do **not** walk.
  - Left-click door / stairs still *can* enter / climb if the PC is already in range (same as E). Out of range, just select the building.
- [x] **Middle click** (or middle-down) → walk order to that tile. If it is a building footprint, walk to that building’s street door (same as today’s `approachBuilding`) but **do not select** unless nothing is selected.
- [x] **Right click** does not walk. Reserved for a context menu later. `preventDefault` the browser menu on the canvas.
- [x] Interior: middle-click a walkable tile issues an interior walk. Middle-click the street door exits. Middle-click stairs climbs.

**Done when.** Left click a baker: ledger opens, they do not start walking. Middle click a plaza tile: PC walks there. Right click: nothing moves.

### 1.3 Replan from here, not from the start

`commandPlayerTo` plans from `player.loc` (last waypoint snapped) and resets `pathI` to 0. While the body is interpolated on `px/py` toward the next tile, `loc` is often still the **original** click. New order → path starts at that old tile → the PC walks backward first.

- [x] Plan from **current** `px/py` (floor those), not stale `loc`.
- [x] If already on a path, **replace** the remaining waypoints. Do not replay the prefix.
- [x] First waypoint of a new path must not be behind the PC. Skip / splice so they turn toward the new dest immediately.
- [ ] Same rule for NPCs if a player-issued interrupt ever repaths them (not required this wave).
- [x] Arrival / enter-building (`pendingEnter`) still works if the new dest is a door.

**Done when.** Start walking north, middle-click east mid-stride: they turn east. They do not go home to the first click.

---

## Wave 2 — Age, kin, orientation, named bonds — SHIPPED

Social layer. Romance already rolls (`flirt` and a `romance` vector). This wave names it and stops generating children.

### 2.1 Minimum age 18

- [x] Generator: **no `child` roster**. No ages under 18. Elders stay (62–84).
- [x] `addVillager` / editor: clamp age to **18–110**. Drop or hide the Child job in the picker.
- [x] Speed: drop the child branch (or keep the number unused). Elders still walk slower.
- [x] Utility: drop the `jobId === "child"` work/worship penalties.
- [x] Existing saved boroughs: on load, bump anyone under 18 to 18 and reassign `child` → `laborer` (or apprentice, once that job exists). Chronicle a quiet note, do not crash.

**Done when.** A new borough has zero souls under 18. The census has no Child row. Old saves still open.

### 2.2 Orientation

- [x] Every soul (and the PC) has `orientation`: `hetero` | `homo` | `bi` | `ace`.
- [x] Default mix at founding (tune later): mostly hetero, some bi, some homo, a few ace.
- [x] Editor + inspector show it. Roleplay snapshot includes it.
- [x] Romance-tagged social actions (`flirt` now; later court / propose) **only** pick targets allowed by both people’s orientation + sex. Ace people do not start those actions; they still friend.
- [x] Changing it in the editor does not break existing named bonds; it only affects new romance rolls.

**Done when.** A gay man does not autonomously flirt with women. An ace person still chats. The ledger shows the field.

### 2.3 Named bonds

Numeric `Rel` stays the physics. Status is a label on top of a pair.

- [x] Pair status: `none` | `friend` | `sweetheart` | `partner` | `spouse`.
- [x] Stored once per pair (canonical id order) plus a pointer on each blackboard or a town `bonds[]`. Persist it.
- [x] Promotion is dice + thresholds, not a cutscene:
  - friend ← high friendship, low romance needed
  - sweetheart ← romance + friendship, both not ace-blocked, not kin
  - partner ← higher romance, some duration / repeated success
  - spouse ← explicit social action (ceremony at temple or home) once partnered
- [x] Breakup / divorce are social actions + chronicle events. Status falls back; vectors are not zeroed, just damaged.
- [x] Inspector lists “with Mara — partner” not only `romance: 41`.
- [x] At most **one** sweetheart/partner/spouse at a time (Phase 1). Friends are many.
- [x] Blood kin cannot become sweetheart+.

**Done when.** Two people can be listed as partners, sleep as a pair if they share a house, and the chronicle records the change. Flirt still moves the vector underneath.

### 2.4 Families

Today a household is “everyone whose `homeId` is this cottage.” That stays (who lives here). Family is **kin**.

- [x] Kin links on each soul: `parentIds: string[]` (0–2, in-town or absent), `spouseId`, inferred siblings = share a parent.
- [x] Founding: seed **adult** families — partnered/spouse pairs, 0–2 adult offspring (18+) who may share the cottage or have moved next door, sibling groups, elders as parents of in-town adults. No minors, no off-screen babies.
- [x] Editor: add/remove a kin link, set spouse, move someone into a household (already have home picker — keep it separate from kin).
- [x] Blood kin get high familiarity / trust at spawn, romance 0, and are blocked from romance statuses.
- [x] Ledger: a Family section (parents, siblings, spouse/partner, household-mates).
- [x] Removing a soul severs links; does not delete the other people.

**Done when.** A cottage can hold a spouse pair and their 22-year-old. The ledger shows “daughter of …”. They do not flirt.

---

## Wave 3 — Floorplans, floors, furniture, owners — SHIPPED

### 3.1 Floorplan editor

Enter a building → ledger **Plan** (or a toggle on the canvas). Time may keep running; the PC is not required to stand still.

- [x] Paint: wall, floor, door, window, stairs, erase-to-floor.
- [x] Rooms: draw a rect, name it, set kind (`bedroom`, `kitchen`, `taproom`, …). Split / merge later if cheap; rects are enough.
- [x] Door on the street wall stays the street door. Moving it updates `doorSide` + `entrance` so people still enter from the road.
- [x] Validate: every floor has a walkable path from the stairs/door to each room; stairs land on a walkable tile of the other floor. Refuse (or auto-fix) closed-off rooms.
- [x] Persist in the town save (floors already snapshot). Occupants on a deleted tile are nudged to the nearest walkable.

**Done when.** You can knock a wall out of a cottage, save, leave the borough, come back — the wall is still gone, and people still path through.

### 3.2 Add / remove floors, basements

- [x] **Add floor above** (loft / storey). Copies width/height, blank rooms, stairs from the floor below.
- [x] **Add basement** (`index: -1`, name Cellar). Stairs down from ground. Ground stays `0`. Do not assume `floors[0]` is ground — look up by `index`.
- [x] **Remove** a floor only if it is empty of required stairs (or you agree to delete the paired stair). Occupants on that floor are moved to ground.
- [x] Nav, enter/exit, canvas, and work spots all understand negative floor indices.
- [x] Two-storey generation already exists; basements should be a generation option for taverns / farmhouses later (not required to ship the editor).

**Done when.** A tavern can have cellar + ground + loft. Stairs down, stairs up. People work the cellar. Save/load keeps the cellar.

### 3.3 Furniture and owners

Furniture is already a `TileKind` (`bed`, `table`, `hearth`, `counter`, …). Make it an object so it can have an owner.

- [x] Catalog in data (not a hardcoded paint list): id, label, tile, size (1×1 first), room kinds it belongs in, tags (`sleep`, `work`, `seat`, `storage`).
- [x] Place / remove in plan mode. Removing a bed reassigns whoever owned it.
- [x] **Owner** on furniture and on bedrooms (`ownerId` or `ownerIds`). Empty = unclaimed.
- [x] Sleep: an NPC with a claimed bed goes **there**, not “any bed in the house.” Shared bed only if partner/spouse (Wave 2) and the bed allows two.
- [x] Editor: assign this bed / this bedroom to a resident. Founding still auto-assigns one bed per resident.
- [x] Work spots can be owned later (a baker’s counter). Not required this wave — beds and bedrooms are the bar.

**Done when.** You place a bed in the loft, assign it to Ivor, night comes, Ivor sleeps in that bed. Demolish the bed, Ivor is unassigned, not stuck in a wall.

---

## Wave 4 — New building types, new jobs — SHIPPED

Defs are data. The borough save already holds world state; it must also hold **overlay defs** so custom kinds survive reload.

### 4.1 Building types

- [x] `BuildingKind` is a string, not a closed TypeScript union, **or** the union is the shipped set and overlays add more at runtime via `defs.buildings`.
- [x] Authoring form: id, label, default name list, footprint (w×h), roof tint, floor template (rooms + furniture kit), street-door rule, tags (`home`, `work`, `shop`, `gather`, `worship`).
- [x] Place on the map with the existing “raise a house” flow, now picking **any** known kind.
- [x] Nav / interiors / generation use the template. Unknown old saves fall back to cottage.
- [x] Shipped kinds stay first-class (cottage, tavern, bakery, …). New ones are overlay data in the town save.

**Done when.** You add “Apothecary,” raise one on the street, it has a shop room, a soul can have it as workplace, save/load keeps the kind.

### 4.2 Jobs

- [x] Authoring form: id, label, workplace (kind or `home` / `plaza`), shift hours, palette, **and** (once Wave 5 exists) produce / consume / wage.
- [x] Changing a soul’s job **reassigns `workId`** to a matching workplace (today it only changes the label/hours). If none exists, workplace is plaza/home and the ledger warns.
- [x] New jobs appear in the picker, census, utility schedule, roleplay snapshot.
- [x] Overlay jobs persist on the town. Deleting a job remaps holders to laborer.

**Done when.** You add “Apothecary,” hire Pia into it, she walks to the new shop during her shift, and she still does after a reload.

---

## Wave 5 — Economy, and jobs that use it — SHIPPED

Work today: walk to `workId`, drain energy, bump status. `buyFood` is `food += 1`. This wave makes work **output**.

### 5.1 Ledger of value

- [x] **Coin** on every soul (and a building coffer, and a town purse).
- [x] **Goods** as data: `food`, `grain`, `flour`, `bread`, `ale`, `wood`, `goods` (generic wares). Enough to make the loop visible, not a full DF workshop graph.
- [x] Stocks on buildings. Personal inventory is tiny: coin + carried `food` meals (already `bb.food`).
- [x] Prices: static table first. Supply-adjusted prices are a follow-up, not the bar.
- [x] Inspector shows coin and, for a shop, its stock.

### 5.2 Jobs produce and consume

Each job (data) during the `work` action:

| Job | Inputs (building stock) | Output | Wage |
|---|---|---|---|
| Farmer | — | grain | town / farm coffer |
| Miller | grain | flour | mill coffer |
| Baker | flour | bread + meals | bakery coffer |
| Innkeeper | bread / grain | ale + meals | tavern coffer |
| Carpenter | wood | (repairs later; wood wares) | workshop |
| Merchant | wares | coin via sales | market |
| Laborer | — | small coin, odd jobs | town purse |
| Priest / guard / homemaker / elder | — | no goods; still paid a stipend | temple / town / household |

- [x] `work` spends ticks **and** moves goods if stock allows. If starved of input, they idle (low status, chronicle “the mill ran dry”).
- [x] Wages pay into the worker’s coin each shift-end (or per work tick, throttled).
- [x] `buyFood` / eat: if the building has meals, decrement stock and take coin from the buyer. If not, fail — go to another shop or go hungry.
- [x] Homemakers can convert household food → meals (keep people fed without a shop).
- [x] Founding seeds each workplace with a little stock so day 1 is not a famine.

**Done when.** Farmers fill a farmhouse with grain. A miller turns it to flour. A baker turns that to bread. A hungry soul spends coin at the bakery and the stock drops. Pause a miller and the bakery eventually runs out.

### 5.3 Player and the loop

- [x] PC has coin. Middle-click a counter / talk to a merchant to buy a meal if stock and coin allow.
- [x] Chronicle: “Pia baked bread,” “the mill ran dry,” “you bought a meal at Honeywell.”
- [x] Roleplay snapshot includes coin + job output so dialogue can mention a short till.

---

## Wave 6 — Urban fantasy: setting, ancestry, magic, narrative — SHIPPED

Fenwick is a **borough where the veil is thin**. Ordinary trades sit next to wards, saints, and vampires who ask before they drink. This wave is flavor + data, not a battle system — combat comes later.

### 6.1 Setting bible

- [x] A short **setting document** (a few hundred words) lives in data: what Fenwick is, what is public knowledge, what “magic in the street” looks like.
- [x] Shipped default: mixed ancestries in one town, magic is uncommon but not secret, the temple and the night market both have a job to do.
- [x] The bible is injected into LLM system prompts (Wave 7). Editable in Settings.
- [x] Generation / names / building labels can pick up a little of this — deferred, per spec not required here (occult shop is a later Wave 4 kind).

**Done when.** Roleplay, if connected, knows it is urban fantasy without being told in every chat line. The ledger has a one-line setting.

### 6.2 Ancestry (kindred)

Shipped: `human` | `demon` | `angel` | `vampire`. **Overlay defs** add more (were, fey, construct, …) the same way jobs do.

- [x] Every soul (and the PC) has `ancestryId`.
- [x] Ancestry def (data): id, label, plural, palette bias, canvas mark (small geometric: halo ring, horn ticks, fang notch — no spritesheet required), need modifiers, tags, optional extra resource (`essence` | `vitae` | `grace` | `ember`).
- [x] Founding mix (tune later): mostly human, a handful of each other. Editor picker includes overlay kinds.
- [x] Inspector + census by ancestry. Roleplay snapshot includes it.
- [x] Kin (Wave 2): mixed-ancestry families are allowed. Blood-kin romance block still holds.
- [x] Vampire **thirst** is a need. It is slaked three ways: **bottled vitae** (apothecary / temple ration / tavern under-the-counter stock), **willing donors** (a soul may agree, via `ask`, to let a vampire drink — recorded per pair, ended by rupture), and **unwilling feeding** (an attack of last resort or desperation). Feeding is adults only, never kin, never fatal, never graphic — a line in the chronicle, not a scene.
- [x] Existing saves: missing ancestry → `human`.

**Done when.** You can found a borough, see a vampire miller and an angel guard in the census, change someone’s ancestry in the editor, save/load keeps it. A thirsty vampire asks, is answered, and drinks without harm — or feeds unwilling and the victim holds a grudge.

### 6.3 Magic

Data-driven. Phase 1 is **have magic exist**; not a battle system.

- [x] `defs.spells` (shipped + overlay): id, label, school (`ward`, `hearth`, `charm`, `sign`, `bloodless vitae`, …), cost (essence), tags, a one-line effect for the chronicle / LLM.
- [x] Soul: `bb.essence` (0–100, decays slowly), `bb.spells: string[]` (known ids). Ancestry may raise the cap or the regen.
- [x] Inspector shows essence + known signs. Editor can grant/revoke a spell.
- [x] Snapshot includes essence, ancestry, known spells.
- [x] Autonomous use is **optional this wave**. If cheap: a `ward` can be a BT action at home (comfort up, chronicle “Mara redrew the threshold sign”). If not cheap, magic is identity + roleplay only until a later pass.
- [x] Economy hook: vitae stocked at temple/tavern (+ free temple ration). Salt/candles and a dedicated occult shop deferred — not the bar.

**Done when.** A demon baker can have two known signs and an essence bar. The LLM snapshot mentions them. No combat UI.

### 6.4 Narrative definition

The numbers are not enough for roleplay. Each soul needs a **written person**.

- [x] Fields on the soul:
  - `narrative.public` — what the borough knows (~600 chars). Shown in the ledger.
  - `narrative.private` — voice, secrets, how they think. **LLM + editor only**, not shown to other NPCs’ snapshots.
  - `narrative.voice` — a short steering line (“dry, old-fashioned, never swears”).
- [x] Editor: textareas on the person page. PC has them too.
- [x] Founding: fill from templates using name, ancestry, job, traits, household — not identical boilerplate. Player can rewrite.
- [x] Snapshot packer (Wave 7) always includes public + voice + private for **that** NPC only.
- [x] Persist on the town save.

**Done when.** You open Pia Reed, read a paragraph that sounds like her, edit it, talk to her (if an LLM is connected) and she holds that voice. Leave and re-enter: the paragraph is still there.

---

## Wave 7 — LLM: endpoint, prompts, context, turn protocol — SHIPPED

Today roleplay is a single server function: hardcoded xAI URL, `XAI_API_KEY`, a baked system string, last 8 turns, 800-char message, JSON deltas. That becomes a **configurable OpenAI-compatible client** plus a prompt book plus a context packer. The sim remains the source of truth; the model never writes the world except through validated deltas.

Read “OpenAI-compatible” as the **Chat Completions wire format** (`POST {baseUrl}/v1/chat/completions`, `messages[]`, `model`, `max_tokens`). That is what xAI, Groq, Together, llama.cpp, Ollama (with the OpenAI shim), and most proxies speak. Not an OpenAPI schema file. Factory default: a local keyless provider (`testmodel` — the id is ignored there).

### 7.1 Connection settings

A **Settings** pane (start screen + in-play). Device-local (`fenwick.v1.llm`). **Not** exported with a town (the key must not ride along in a borough file).

- [x] Fields:
  - enabled
  - base URL (e.g. `https://api.x.ai` or `http://127.0.0.1:11434`)
  - path (default `/v1/chat/completions`)
  - API key (password field, never logged, never put in chronicle / snapshots)
  - model id
  - temperature, max output tokens
- [x] **Test connection** — one cheap request, show ok / HTTP error / parse error.
- [x] If disabled or base URL empty, talk UI says roleplay is offline. The sim does not care. (Empty *key* counts as online — keyless providers exist; auth failures surface as 401s.)
- [x] Factory default is the local keyless provider. A server-side env key is used only when the saved settings carry no key — player-owned values always win.

**Done when.** You point Simulity at an OpenAI-compatible server, test, and a talk turn goes there instead of the baked xAI URL.

### 7.2 Prompt configuration

A **prompt book** (editable, reset-to-default). Placeholders, not concatenation soup.

- [x] Templates:
  - `system` — who the model is, JSON-only reply, urban-fantasy bible slot
  - `character` — filled with narrative + ancestry + job + voice
  - `snapshot` — how live state is shown (needs, mood, goal, place, bonds, recent chronicle, knowledge, essence/spells)
  - `delta schema` — the exact JSON the model must return (keep today’s shape: speech, action, deltas)
- [x] Placeholders: `{{setting}}`, `{{narrative}}`, `{{snapshot}}`, `{{name}}`, …
- [x] Reset to shipped defaults. Persist with LLM settings (device), not the town.

**Done when.** You change the system prompt, talk to someone, they follow the new instructions. Reset brings the shipped book back.

### 7.3 Context size

- [x] `contextTokens` (player-set, e.g. 4k / 8k / 16k / 32k). Packer treats `chars ≈ tokens * 4` unless a real tokenizer exists later.
- [x] Budget order (keep, then drop from the tail) — bonds/chronicle ride inside the snapshot bundle; only history is ever cut:
  1. compiled system + setting bible
  2. this NPC’s narrative (public + private + voice)
  3. live snapshot (needs, mood, goal, place, ancestry, spells, coin)
  4. named bonds + top relationships
  5. recent chronicle involving them
  6. conversation history (newest first)
- [x] `maxHistoryTurns` cap. When history would blow the budget, **drop oldest turns**. A later pass may summarize; not required this wave.
- [x] Player message still clipped to a sane max (today 800). Snapshot JSON clipped to `maxSnapshotChars`.
- [x] Settings show a rough “this turn used ~N / context” estimate after a reply.

**Done when.** A long talk does not 400 the endpoint because the payload grew without bound. Cutting history keeps the narrative and the live needs.

### 7.4 Communication systems

Name the parts so they stay separable:

| Piece | Job |
|---|---|
| **LlmSettings** | Load/save connection + prompt book + budget |
| **PromptCompiler** | Fill templates |
| **ContextPacker** | Build `messages[]` under the token budget |
| **ChatTransport** | HTTP Chat Completions, timeouts, non-2xx → typed error |
| **TurnProtocol** | Pause that NPC’s BT, send one turn, parse JSON, **DeltaGuard**, apply, resume. Other NPCs keep ticking |
| **DeltaGuard** | Existing `applyDeltas`: whitelist fields, clamp sizes, no location teleport unless we explicitly allow it, no inventing items/coin in Phase 1 |

- [x] Replace the baked `roleplayTurn` body with the stack above. Same player-facing talk UI.
- [x] Errors surface in the talk pane (offline, 401, bad JSON). The NPC stays paused until the player closes talk; they do not freeze the town.
- [x] Optional **debug** fold-out: compiled system (no API key), packed message count, raw error. Off by default.
- [x] One NPC per talk for this wave (today’s model). Multi-NPC scenes later.
- [x] No tools/function-calling required this wave. If the model emits extra keys, ignore them.

**Done when.** Talk uses the configured endpoint and prompt book, respects the budget, and still only mutates the world through `applyDeltas`. Unplug the key: the town keeps living, talk reports offline.

---

## Data contracts (for whoever implements)

Keep these in the town save (`SAVE_VERSION` bump when any of this lands). Overlay defs live on the save so custom jobs/kinds survive.

```
orientation: "hetero" | "homo" | "bi" | "ace"
bond: { a, b, status, sinceTick }
kin: { parentIds, spouseId }          // siblings inferred
furniture: { id, kind, x, y, floor, ownerId? }
floor.index: number                   // 0 ground, -1 cellar, 1+ above
job.produces / consumes / wage        // Wave 5
building.stock: Record<goods, number>
building.coffer: number
npc.coin: number
npc.ancestryId: string                // Wave 6, default "human"
npc.narrative: { public, private, voice }
npc.bb.essence: number
npc.bb.spells: string[]
donor: { donor, drinker, sinceTick }  // Wave 6, consent to feed
defsOverlay: { jobs, buildings, furniture, goods, ancestries, spells }
settingBible: string                  // Wave 6, per town (ledger Settings tab)
```

LLM settings are **device-local**, not in the town save:

```
fenwick.v1.llm: {
  enabled, baseUrl, path, apiKey, model,
  temperature, maxOutputTokens, contextTokens, maxHistoryTurns, maxSnapshotChars,
  prompts: { system, character, snapshot, deltaSchema }
}
```

Camera is **not** persisted (or persist zoom only — do not care this round).

Path planning: `commandPlayerTo` / `planRoute` must take **from = (px, py)** and may drop the first waypoint if it is the current cell.

---

## Suggested order of play

1. **Wave 1 — SHIPPED.** Camera, click, repath.
2. **Wave 2 — SHIPPED.** Age 18, orientation, named bonds, kin. Stopped here on request.
3. **Wave 3 — SHIPPED.** Plan editor, basements, owned beds. Needs Wave 1 select-a-building.
4. **Wave 4 — SHIPPED.** Custom kinds/jobs.
5. **Wave 5 — SHIPPED.** Economy.
6. **Wave 6 — SHIPPED.** Urban fantasy (ancestry, magic data, narrative).
7. **Wave 7 — SHIPPED.** LLM endpoint / prompts / context.

---

## Open choices (do not block Wave 1)

- Pan modifier on desktop: left-drag empty vs space-drag vs right-drag. Spec currently: **left-drag empty pans**.
- Touch: long-press = select, one-finger drag = pan, two-finger = zoom, no middle button — add a **Walk** toggle or use double-tap to walk.
- Polygamy / affairs: out of scope; one sweetheart/partner/spouse.
- Off-map parents: allowed as ids that do not resolve; ledger shows “parent (away).”
- Custom kinds in the *generator* (new boroughs spawn apothecaries): later. Author + place is enough.
- Supply-driven prices, debt, famine events: after 5.2 works.
- Vampire vitae is a bottled stock (apothecary / temple / tavern) with a free temple ration as fallback, plus willing donors and unwilling feeding. Shipped in Wave 6.
- Magic combat / PvE: not this wave. Signs are identity + household wards; spells carry tags and effect lines so combat has something to key off later.
- Tokenizer: char/4 estimate until it hurts.
- Function-calling / MCP tools from the talk turn: later. Deltas stay JSON.

---

## Explicitly out of this list

- Generated children / pregnancy / aging-into-minors (the pop is 18+).
- Multiplayer, accounts, cloud saves.
- Shipping the player’s API key inside a town export.
- Rewriting the BT editor or persistence format except versioned additive fields.
