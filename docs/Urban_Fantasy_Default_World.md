# Urban Fantasy Default World — Content Spec

**Status:** Ready for implementation  
**Tone target:** Urban fantasy. Cyberpunk texture meets Constantine occult. Neon, rain, old brick, fluorescent diners, parish basements, relic lockers, night-shift work.  
**Scope:** Default shipped *content* only (defs, generation roster, names, setting bible, copy, commodity labels, behavior-tree destination labels). Not a new simulation architecture.  
**Non-negotiable:** All NPCs are adults (18+), including tests and generated founders. No child/minor jobs, homes, schools-as-childcare, or flavor text. Do not add Grok/xAI auth, tools, or branding. Do not invent illegal-activity systems (no drug labs, trafficking, weapons construction, hacking-as-crime-sim). Occult and night work are legal-in-setting trades.

This document is the hand-off for a local coding agent. Change data first. Touch TypeScript only where IDs, switch cases, or generation tables are hardcoded today.

---

## 1. Why this pass exists

The current default world reads as a historic/fantasy market town:

- Jobs: farmer, baker, miller, carpenter, priest, innkeeper, guard, homemaker, elder, child
- Buildings: cottage, tavern, bakery, mill, farmhouse, temple, well, workshop, market, guardhouse
- Copy: hearths, grain lofts, Saint Bramble, town well, “Fenwick is a borough where the veil is thin” in a pastoral register
- Generation: 3 farmhouses, 22 cottages, trees on the map edge, grass tiles

Keep the *systems* (needs, utility goals, BT trees, ancestries, vitae/essence, wards, night/kindred tags). Replace the *default content skin* so a new borough feels like a rain-wet city ward where angels file paperwork, vampires buy bottled vitae at the all-night counter, and someone is always redrawing a sign on a steel door.

Fenwick stays the default ward name. It is no longer a village. It is a city ward.

---

## 2. Constraints for the implementing agent

### 2.1 Must keep

- Data-driven first. Prefer edits in `src/sim/defs.ts`, `src/sim/gen.ts`, `src/sim/interiors.ts`, `src/sim/custom.ts`, `src/sim/economy.ts`, `src/sim/narrative.ts`, and UI copy. Do not hardcode new job logic in the tick loop.
- Existing save shape (`TownSave` version 6). Old kind/job IDs in existing saves must still load.
- Ancestries already shipped: `human`, `demon`, `angel`, `vampire`. Do not remove them. They are the Constantine half of the brief.
- Goals and BT *tree ids* (`tree.eat`, `tree.sleep`, `tree.work`, `tree.worship`, `tree.hygiene`, `tree.relax`, …). Relabel destinations and action copy; do not invent a parallel AI stack.
- `moveTo` `where` tokens currently used: `tavern`, `bed`, `drink`, `home`, `work`, `target`, `well`, `plaza`, `temple`. Keep the token strings. Remap what building they resolve to.
- Workplace resolution in `src/sim/custom.ts` (`home`, `plaza`, or a building kind id).
- Server persistence. This pass does not change stores.
- Adult-only cast. Founding ages stay `18–58` for working jobs, `62–84` for elders. Delete the `child` job entirely.

### 2.2 Must not do

- No 3D, no new renderer, no texture pack requirement. 2D top-down stays. Visuals may keep current tiles; labels and interiors carry the aesthetic until a later art pass.
- No new persistence format.
- No Grok branding.
- No crime-sim loop, no “how to” occult ritual recipes, no sexual content involving minors (there are no minors).
- Do not rename every TypeScript identifier in one heroic sweep if a label change will do. IDs are wiring. Labels are flavor.

### 2.3 Save compatibility rule

**Keep shipped kind IDs and job IDs that already exist**, then change `label`, names, rooms, tags, commodities, and generation counts.

| Keep ID | New default reading |
|---|---|
| `cottage` | Walk-up flat / row apartment |
| `farmhouse` | Converted walk-up (same home tag; no acreage) |
| `tavern` | All-night diner and bar |
| `bakery` | Night bakery / steam-window shop |
| `market` | Night market / arcade stalls |
| `temple` | Parish of the Threshold (occult-Catholic storefront church) |
| `workshop` | Garage atelier / chop shop for signs and fixtures |
| `mill` | Substation / pump house (power and water, not grain) |
| `guardhouse` | Ward precinct / night watch |
| `well` | Public wash / kiosk (hygiene destination) |

Add **new** kinds and jobs only when the old ID cannot carry the role. New IDs are additive. Old saves that lack them still boot.

If a save contains `jobId: "child"`, migrate that NPC to `laborer` (or the new `runner` if you add it and map `laborer` → `runner` via alias) and clamp `age` to ≥ 18. Same rule if any narrative string says “child.”

---

## 3. Setting

### 3.1 Pitch

Fenwick Ward sits on the wet side of a larger unnamed city. Neon sits on brick. The parish still opens at dawn. The diner never closes. Kindred (demons, angels, vampires) hold ordinary jobs. Magic is municipal-adjacent: threshold signs on steel doors, bottled vitae behind the counter, a relic locker in the parish basement. Nobody duels in the plaza. Work happens. Night happens. The veil is a zoning problem.

### 3.2 Replacement setting bible

Replace `SETTING_BIBLE` and `SETTING_LINE` in `src/sim/defs.ts` with text in this register (edit for length, keep the facts):

**SETTING_LINE**

`Fenwick Ward — neon on brick, incense on rain.`

**SETTING_BIBLE** (authoritative facts the LLM may read)

- Fenwick is a city ward, not a village.
- Humans run most counters. Demons, angels, and vampires work the same streets and hold papers like anyone else.
- Magic is uncommon, visible, and treated like a permit. Signs on doors. Charms sold next to batteries. Vitae bottled and taxed like anything else that stains.
- Two anchors: the Parish of the Threshold (rites, marriages, vitae ration for those who thirst) and the night market (goods, gossip, under-counter bottles).
- The diner is the civic living room after midnight.
- Public talk is public. Private fears, appetites, and old vows stay private unless spoken.
- No open warfare in the plaza. Signs are for homes and work.

Do not write a novel. The bible is a contract for roleplay snapshots.

### 3.3 What “cyberpunk × Constantine” means here

Use these images when naming rooms, businesses, and jobs:

- Fluorescent, wet asphalt, chainlink, roof antennas, parish gold leaf under a neon cross
- Trench weather. Night shifts. Paperwork that happens to bind a spirit
- Relics in lockers, not dragon hoards
- Coffee, smokes-as-prop (no need to simulate tobacco), bottled vitae, cheap noodles, charged cells
- Angels who look tired. Demons who fix signage. Vampires who clock out at dawn

Avoid:

- Thatched roofs, grain sacks, village greens, “ye olde,” rustic hearths as the default read
- High-fantasy spell duels
- Corporate megatowers as the whole map (one office kind is enough; this is a ward, not Night City downtown)

---

## 4. File map (touch list)

| File | Why |
|---|---|
| `src/sim/defs.ts` | Jobs, kinds, names, spells, traits, setting bible, BT labels, commodities on jobs |
| `src/sim/types.ts` | `BuildingKind` union if new kind IDs are added |
| `src/sim/gen.ts` | Building queue, home filter, job roster counts, player default job label |
| `src/sim/interiors.ts` | Room layouts keyed by kind id; farmhouse/cottage cases become urban interiors |
| `src/sim/interiors.test.ts` | Kind list in tests |
| `src/sim/custom.ts` | `plaza` fallback buildings; `homeKindIds` |
| `src/sim/economy.ts` | Starting stock keys if commodity names change |
| `src/sim/narrative.ts` | Job/home phrasing if it assumes village life |
| `src/sim/ai.ts` / nav helpers | Only if `where: "tavern" \| "well" \| "temple"` resolution is hardcoded to labels |
| `src/components/game/StartScreen.tsx` | Hero copy if it still says pastoral “street that remembers you” without city register |
| `src/components/game/SettingsPane.tsx` | Bible helper text (“What Fenwick is”) |
| Tests that mention Farmer / Cottage / Town Well / Child | Update expected labels or IDs |

Do not churn portraits (`public/portraits/*`). Keep files; they are faces, not costumes.

---

## 5. Needs, traits, goals

Needs stay. Optional label-only tweaks (IDs unchanged):

| ID | Current label | New label |
|---|---|---|
| `hunger` | Hunger | Hunger |
| `energy` | Energy | Energy |
| `social` | Company | Company |
| `fun` | Spirit | Static |
| `hygiene` | Clean | Clean |
| `comfort` | Comfort | Shelter |
| `status` | Standing | Standing |
| `thirst` | Thirst | Thirst |

Traits: keep IDs. Relabel only where pastoral:

| ID | New label | Notes |
|---|---|---|
| `devout` | Devout | Still boosts `worship` |
| `industrious` | Clocked-in | Same work utility |
| `glutton` | Hollow | Same hunger decay |
| others | keep | |

Goals: keep IDs and tree ids. Relabel:

| Goal ID | New label | Tree still goes to |
|---|---|---|
| `eat` | Eat | diner (`tavern`) or carried food |
| `sleep` | Sleep | `bed` |
| `drink` | Drink | `drink` / vitae source |
| `ward` | Reward | `home` + `ward` action |
| `work` | Shift | `work` |
| `socialize` | Talk | target |
| `hygiene` | Wash | `well` (now kiosk/wash) |
| `relax` | Kill time | diner or plaza |
| `worship` | Observe | `temple` |
| `wander` | Walk | wander |

BT action labels inside `compileTree(...)` must change to match (e.g. “Go to tavern” → “Go to the diner”, “Go to well” → “Go to the wash”, “Go to temple” → “Go to parish”, “Pray” → “Observe”).

`tree.relax` selector: first branch diner (`tavern`), second branch plaza / night market. No village green.

---

## 6. Jobs

### 6.1 Shipped jobs after this pass

Keep job **IDs** in the left column. Change labels, workplaces, hours, goods.

| ID | Label | Workplace kind | Hours | Goods (suggested) | Wage | Roster count |
|---|---|---|---|---|---|---|
| `farmer` | Superintendent | `farmhouse` or `cottage` as `home` if you flip workplace to `home`; **preferred:** workplace `farmhouse` still, now meaning a converted walk-up they maintain | 7–18 | produces `{ parts: 1 }` | 1 | 4 |
| `baker` | Night baker | `bakery` | 21–7 (overnight; if hours cannot wrap in current engine, use 22–6 or 5–14 and document the limitation) | consumes `{ flour: 1 }`, produces `{ bread: 1, food: 2 }` | 2 | 2 |
| `innkeeper` | Diner lead | `tavern` | 18–4 or 11–23 if wrap is unsupported | consumes `{ grain: 1 }` as `stock`, produces `{ ale: 2, food: 1 }` — **relabel commodities in economy display** to coffee/noodles/vitae-chaser without renaming keys unless economy is already stringly keyed for UI | 2 | 3 |
| `merchant` | Stall broker | `market` | 16–2 or 8–17 fallback | consumes `{ goods: 1 }`, produces `{ coin: 4 }` | 2 | 4 |
| `carpenter` | Signwright | `workshop` | 10–20 | consumes `{ wood: 1 }` as `scrap`, produces `{ goods: 1 }` | 2 | 3 |
| `miller` | Grid tech | `mill` | 6–16 | consumes `{ grain: 1 }` as `cells`, produces `{ flour: 1 }` as `charge` | 2 | 2 |
| `priest` | Parish clerk | `temple` | 7–19 | no shop goods required | 1 | 2 |
| `guard` | Night watch | `guardhouse` | 20–6 or 8–20 fallback | — | 1 | 4 |
| `laborer` | Runner | `plaza` | 18–3 or 8–17 fallback | — | 1 | 10 |
| `homemaker` | Householder | `home` | 8–16 | consumes `{ grain: 1 }`, produces `{ food: 2 }` | 1 | 8 |
| `elder` | Pensioner | `temple` or `plaza` | 10–15 | — | 1 | 6 |
| `child` | **DELETE** | — | — | — | — | 0 |

If shift wrap-around (`startHour > endHour`) is not supported today, do **not** fake it with a new scheduler in this pass. Use late-start finite windows (e.g. guard 16–24 clamped to 23, baker 5–14) and leave a `TODO` in defs. Night flavor can live in labels until utility time-bands support wrap.

### 6.2 Additive jobs (optional, this pass if time)

Only add if generation and workplace kinds exist.

| ID | Label | Workplace | Hours | Count |
|---|---|---|---|---|
| `clerk` | Records clerk | `temple` or new `office` | 9–17 | 2 |
| `tech` | Rig tech | `workshop` | 12–22 | 2 |
| `cook` | Grill | `tavern` | 16–2 or 11–23 | 2 |

If added, cut `laborer`/`runner` count so total founding population stays near current (~58 working + elders, not a doubling).

### 6.3 Player default

`generateWorld` currently assigns the PC `defs.jobs.laborer` and narrative job `"Laborer"`. Change the visible job string to `"Runner"`. ID may stay `laborer`.

---

## 7. Buildings / locations

### 7.1 Kind table (IDs kept)

| ID | Label | Tags | Stories | Footprint (keep unless cramped) | Ground rooms | Upper rooms |
|---|---|---|---|---|---|---|
| `cottage` | Walk-up | `home` | 2 | 4×3 | hall “Front room”, bedroom | loft “Sleep loft” |
| `farmhouse` | Tenement | `home` (drop implicit farm; may keep `work` if superintendent still keys off it) | 2 | 5×4 | kitchen “Galley”, hall “Front room” | bedroom “Flats” |
| `tavern` | Diner | `work`, `shop`, `gather` | 2 | 7×5 | taproom “Counter”, kitchen “Grill” | bedroom “Upstairs rooms” |
| `bakery` | Night bakery | `work`, `shop` | 2 | 5×4 | shop “Window”, kitchen “Ovens” | loft |
| `market` | Night market | `work`, `shop`, `gather` | 1 | 6×5 | shop “Stalls” | — |
| `temple` | Parish | `work`, `worship`, `gather` | 1 | 6×6 | sanctuary “Nave”, office “Sacristy / records” | — |
| `workshop` | Atelier | `work` | 1 | 5×4 | workshop “Bay”, office “Cage” | — |
| `mill` | Substation | `work` | 2 | 5×5 | mill “Floor” | loft “Catwalk” |
| `guardhouse` | Precinct | `work` | 2 | 4×4 | office “Desk” | bunk “Lockers” |
| `well` | Wash kiosk | `gather` | 1 | 2×2 | well “Wash” | — |

`homeKindIds()` must include every kind tagged `home`. Keep the current special-case that tavern can house people if that is already shipped.

### 7.2 Additive kinds (optional)

| ID | Label | Tags | Use |
|---|---|---|---|
| `clinic` | Night clinic | `work`, `gather` | hygiene / comfort fallback later |
| `office` | Agency office | `work` | clerks, paper wards |
| `club` | Afterhours | `work`, `gather` | relax alt to diner |

Skip these if interiors + `BuildingKind` union + gen queue would blow the pass. The remapped ten IDs are enough for a first ward.

### 7.3 Generation queue (`src/sim/gen.ts`)

Replace the current queue:

```
tavern, temple, market, bakery, workshop, mill, guardhouse, well,
farmhouse ×3, cottage ×22
```

with:

```
tavern ×1
temple ×1
market ×1
bakery ×1
workshop ×1
mill ×1
guardhouse ×1
well ×1
farmhouse ×4     // tenements, more beds
cottage ×20      // walk-ups
```

Homes filter today:

```ts
buildings.filter((b) => b.kind === "cottage" || b.kind === "farmhouse")
```

Keep that filter. Population still needs beds.

Map paint: keep the road grid and central plaza. Optional in this pass (not required): fewer `tree` stamps at the edge, or stamp them only in one quadrant so the map reads less pastoral. Do not invent new tile kinds unless `TileKind` already allows something urban (`dirt` as alley is fine).

### 7.4 Interiors

`src/sim/interiors.ts` has `case "farmhouse"` and `case "cottage"`. Keep the case IDs. Change furniture and room flavor:

- Farmhouse: not a hearth farm. Galley kitchen, stacked beds, a metal door.
- Cottage: one-room-up walk-up. Bed, sink, table.
- Tavern: counter, stools, grill, not barrels and a taproom bench as the only read.
- Temple: pews or chairs + records desk + a locker (furniture kind can stay existing tiles: bed/table/counter/door).
- Mill: machines as tables/counters. No grain piles required.
- Well: a stall, not a village well cap if the tiles allow; otherwise keep tiles and change the room name only.

`interiors.test.ts` kind list can stay the same IDs.

### 7.5 Building names

Replace `BUILDING_NAMES`:

```
tavern:    The Last Counter, Neon Mercy, The Closed Eye
bakery:    Graveyard Shift, Steam Window
market:    Fenwick Night Market
temple:    Parish of the Threshold, Our Lady of the Service Door
workshop:  Ash & Circuit, Crowe Signs
mill:      Ward Substation, East Pump
farmhouse: 14 Lumen Court, Stack Nine, The Old Dye Works
guardhouse: Ward Precinct
well:      Wash Kiosk
cottage:   []   // still "{Surname} House" or better "{Surname} Walk-up"
```

Generation fallback `name = item.name || \`${surname} House\`` → `\`${surname} Walk-up\``.

---

## 8. Economy / commodities

Do **not** break stock keys if buildings already persist `{ grain, flour, bread, ale, food, goods, wood, coin }`.

Two acceptable approaches (pick one, document in the PR):

1. **Keys stay, labels change in UI / setting bible only.** Grain reads as “dry goods”, ale as “well drinks”, wood as “scrap”, flour as “charge”, coin stays coin, vitae stays a thirst resource not a market SKU unless already present.
2. **Keys change and `ensureBuildingEconomy` plus save migrate** map old keys → new.

Prefer (1) for this pass.

Vampires keep `thirst` + bottled vitae as ancestry resource. Parish (`temple`) remains the narrative ration point. No need for a new commodity ID if thirst is already a need.

---

## 9. Names and voice

Replace pastoral name lists with a mixed city register. Keep array lengths roughly the same. All adult.

**Feminine first:** Mara, Nell, Ivy, Cass, June, Rhea, Sable, Vera, Nico, Quinn, Adele, Bridget, Carmen, Delia, Esme, Frances, Greta, Hana, Iris, Jude, Kara, Leda, Mina, Odette, Pearl, Ruth, Sybil, Tess  

**Masculine first:** Bram, Calder, Theo, Cole, Dorian, Ellis, Finn, Gideon, Harlan, Ivor, Jules, Kent, Lev, Moss, Niall, Owen, Peregrine, Rook, Silas, Victor, Walsh, York, Abel, Bennett, Cyrus, Dax, Ezra, Frost  

**Surnames:** Ash, Crowe, Dunne, Hawke, Kell, Pike, Reed, Stone, Vale, Ward, Voss, Rourke, Lang, Mercer, Quinn, Sato, Alvarez, Bishop, Crane, Doyle, Frost, Glass, Hahn, Ibarra, Graves, Keller, Lynch, Morse  

Avoid: Underhill, Yarrow, Bramble, Cartwright, Baker-as-surname-only-village, Oak-the-tree-as-default.

Narrative (`makeNarrative`): job and home words must accept “Night baker”, “Parish clerk”, “14 Lumen Court”. If templates say “tends the fields” / “keeps the hearth”, rewrite those clauses.

Spells — keep IDs, urbanize labels/effects:

| ID | New label | Effect one-liner |
|---|---|---|
| `threshold` | Threshold Sign | Redraws the ward on a steel door. The flat sleeps easier. |
| `hearthlit` | Service Light | Coaxes a dead fixture on without the grid. |
| `kindle` | Small Courtesy | Warms a conversation at a counter. |
| `namesign` | Name Plate | Marks a door with the household sign. |
| `quietus` | Quietus | Slows a pulse. Used in clinics and parish basements. |

Schools can stay `ward` / `hearth` / `charm` / `sign` / `bloodless vitae`.

---

## 10. Copy / UI

Update player-facing strings that assume a village:

- Start screen blurb: boroughs in a city that keep. Found a ward from a seed.
- Settings bible helper: “What Fenwick Ward is. Read by roleplay.”
- Roleplay offline lines can stay.
- Inspector job/building labels come from defs; they update automatically if defs change.
- Default town name may stay `"Fenwick"`; bible and line carry “Ward.”

Do not add Grok copy.

---

## 11. Resolution map for existing `where` tokens

Implementers must grep `where:` and workplace strings.

| Token | Resolves to after this pass |
|---|---|
| `tavern` | kind `tavern` (diner) |
| `temple` | kind `temple` (parish) |
| `well` | kind `well` (wash kiosk) |
| `plaza` | plaza tiles or kind `market` |
| `home` | NPC `homeId` |
| `work` | NPC `workId` |
| `bed` | owned bed furniture |
| `drink` | vitae/drink spot (temple or tavern stock) — keep current drink resolver |
| `target` | social target |

`custom.ts` `workplace === "plaza"` currently prefers `market` then `well`. Keep that.

---

## 12. Generation roster (authoritative counts)

After deleting `child` and retuning homes:

| Job ID | Count |
|---|---|
| `farmer` | 4 |
| `baker` | 2 |
| `innkeeper` | 3 |
| `merchant` | 4 |
| `carpenter` | 3 |
| `miller` | 2 |
| `priest` | 2 |
| `guard` | 4 |
| `laborer` | 10 |
| `homemaker` | 8 |
| `elder` | 6 |
| **Total NPCs** | **48** plus PC |

Beds: 4 tenements + 20 walk-ups must cover 48 residents. If interiors do not expose enough beds, either add beds per home in `interiors.ts` or drop counts — do not spawn people without a bed claim.

Age: workers 18–58, elders 62–84, PC 30. No other bands.

---

## 13. Tests and acceptance

### 13.1 Mechanical

- `npm run typecheck` (or project equivalent) clean
- Existing persist / interiors tests pass with updated kind lists
- No remaining `jobs.child` or `id: "child"`
- `generateWorld` for seed `1742` produces only job IDs in the table above
- Every founding NPC `age >= 18`
- Every founding NPC has `homeId` pointing at `cottage` or `farmhouse`
- Workplaces exist for baker, innkeeper, merchant, carpenter, miller, priest, guard
- `SETTING_BIBLE` contains “ward” and does not contain “carts” / “South Field” / village-well pastoral sentences
- No `localStorage` writes introduced
- No Grok/xAI strings introduced

### 13.2 Content

- New borough start screen can be read as a city ward in one glance (names + building labels)
- Diner, parish, night market, precinct, wash kiosk all present
- Spell and trait labels do not say “hearth without wood” as the lead image
- Roleplay snapshot still receives setting bible + job label + home name

### 13.3 Non-goals for acceptance

- Pretty cyberpunk pixels
- New tile atlas
- Wrapped night shifts if the clock utility cannot express them
- New ancestry
- Multi-ward / subway navigation (staged nav already exists; do not add a metro layer here)

---

## 14. Suggested implementation order

1. Delete `child` job + any references. Clamp ages.
2. Relabel jobs, kinds, rooms, names, spells, setting bible in `defs.ts`.
3. Update `BUILDING_NAMES`, name lists, gen queue, roster counts, “House” → “Walk-up”.
4. Retouch `interiors.ts` cases for cottage/farmhouse/tavern/temple/mill/well.
5. Grep UI and narrative for Farmer, Cottage, Town Well, Saint Bramble, fields, hearth-as-default.
6. Run tests. Fix hardcoded expected strings.
7. Boot a seed, confirm diner + parish + night market exist and NPCs have jobs that match workplaces.

---

## 15. Out of scope on purpose

- Rewriting Architecture Foundations (this spec is content; foundations stay)
- MCP tools for live content authoring (already a later phase)
- Social sim expansion
- Combat, exorcism minigames, shooting
- Branding passes

If a later art pass happens, this spec is the naming source of truth for buildings and jobs. Do not invent a second vocabulary.
