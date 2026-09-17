# Urban Fantasy Default World — Content Spec

**Status:** Ready for implementation  
**Tone target:** Urban fantasy. Cyberpunk texture meets Constantine occult. Neon, rain, old brick, fluorescent diners, parish basements, relic lockers, night-shift work.  
**Scope:** Default shipped *content* only (defs, generation roster, names, setting bible, copy, commodities, behavior-tree destinations). Not a new simulation architecture.  
**Saves:** Existing town saves may be deleted. **Rename IDs.** Do not keep `tavern` / `farmer` / `cottage` as hidden aliases. Grep the repo and replace. No migration layer required.  
**Non-negotiable:** All NPCs are adults (18+), including tests and generated founders. No child/minor jobs, homes, schools-as-childcare, or flavor text. Do not add Grok/xAI auth, tools, or branding. Do not invent illegal-activity systems (no drug labs, trafficking, weapons construction, hacking-as-crime-sim). Occult and night work are legal-in-setting trades.

This document is the hand-off for a local coding agent. Change data first. Touch TypeScript wherever old IDs are hardcoded (unions, switch cases, generation tables, tests, UI copy).

---

## 1. Why this pass exists

The current default world reads as a historic/fantasy market town:

- Jobs: `farmer`, `baker`, `miller`, `carpenter`, `priest`, `innkeeper`, `guard`, `homemaker`, `elder`, `child`
- Buildings: `cottage`, `tavern`, `bakery`, `mill`, `farmhouse`, `temple`, `well`, `workshop`, `market`, `guardhouse`
- Copy: hearths, grain lofts, Saint Bramble, town well, “Fenwick is a borough where the veil is thin” in a pastoral register
- Generation: 3 farmhouses, 22 cottages, trees on the map edge, grass tiles

Keep the *systems* (needs, utility goals, BT trees, ancestries, vitae/essence, wards, night/kindred tags). Replace the *default content vocabulary* so a new borough feels like a rain-wet city ward where angels file paperwork, vampires buy bottled vitae at the all-night counter, and someone is always redrawing a sign on a steel door.

Fenwick stays the default ward name. It is no longer a village. It is a city ward.

---

## 2. Constraints for the implementing agent

### 2.1 Must keep

- Data-driven first. Prefer edits in `src/sim/defs.ts`, `src/sim/gen.ts`, `src/sim/interiors.ts`, `src/sim/custom.ts`, `src/sim/economy.ts`, `src/sim/narrative.ts`, and UI copy. Do not hardcode new job logic in the tick loop.
- Save *schema* (`TownSave` version may bump if you already version it). Shape stays. **Stored ID strings change.** Wiping towns is acceptable; do not write a compat shim.
- Ancestries already shipped: `human`, `demon`, `angel`, `vampire`. Do not remove or rename those IDs. They are the Constantine half of the brief.
- Goal IDs and BT *tree ids* (`eat`, `sleep`, `work`, `tree.eat`, `tree.sleep`, `tree.work`, `tree.worship`, `tree.hygiene`, `tree.relax`, …). These are system verbs, not setting nouns. Relabel destinations and action copy.
- Generic `moveTo` tokens that are not building kinds: `bed`, `drink`, `home`, `work`, `target`, `plaza`. Kind-named tokens (`tavern`, `well`, `temple`) **must** become the new kind IDs.
- Workplace resolution in `src/sim/custom.ts` (`home`, `plaza`, or a building kind id) — update the kind strings it looks for.
- Server persistence plumbing. This pass does not change stores. Emptying the towns table / `./data/pglite` is fine.
- Adult-only cast. Founding ages stay `18–58` for working jobs, `62–84` for pensioners. Delete the `child` job. No replacement ID.

### 2.2 Must not do

- No 3D, no new renderer, no texture pack requirement. 2D top-down stays. Visuals may keep current tiles; labels and interiors carry the aesthetic until a later art pass.
- No Grok branding.
- No crime-sim loop, no “how to” occult ritual recipes, no minors.
- No leftover aliases. After this pass a repo-wide search for `tavern`, `farmhouse`, `cottage`, `farmer`, `innkeeper`, `priest`, `guardhouse`, `child` as IDs must return nothing (comments that say “formerly tavern” are fine in this spec only, not in runtime code).

### 2.3 ID policy

IDs are lowercase kebab-case. A job ID is the role. A building-kind ID is the place. Labels match.

Need IDs (`hunger`, `energy`, `social`, `fun`, `hygiene`, `comfort`, `status`, `thirst`) stay. They are the need system, not setting nouns. Labels may change per §6.

Trait IDs stay except where listed. Spell IDs rename per §9.

---

## 3. Canonical ID maps

These tables are authoritative. Implementers replace every old string.

### 3.1 Building kinds

| Old ID | New ID | Label |
|---|---|---|
| `cottage` | `walk-up` | Walk-up |
| `farmhouse` | `tenement` | Tenement |
| `tavern` | `diner` | Diner |
| `bakery` | `bakery` | Night bakery |
| `market` | `night-market` | Night market |
| `temple` | `parish` | Parish |
| `workshop` | `atelier` | Atelier |
| `mill` | `substation` | Substation |
| `guardhouse` | `precinct` | Precinct |
| `well` | `wash` | Wash kiosk |

`bakery` stays. It already reads as a city shop.

Update `BuildingKind` in `src/sim/types.ts`. Update `SHIPPED_KINDS`, `FOOTPRINT`, `KIND_*`, `BUILDING_NAMES`, interiors `switch`, tests.

### 3.2 Jobs

| Old ID | New ID | Label | Workplace |
|---|---|---|---|
| `farmer` | `superintendent` | Superintendent | `tenement` |
| `baker` | `night-baker` | Night baker | `bakery` |
| `innkeeper` | `diner-lead` | Diner lead | `diner` |
| `merchant` | `stall-broker` | Stall broker | `night-market` |
| `carpenter` | `signwright` | Signwright | `atelier` |
| `miller` | `grid-tech` | Grid tech | `substation` |
| `priest` | `parish-clerk` | Parish clerk | `parish` |
| `guard` | `night-watch` | Night watch | `precinct` |
| `laborer` | `runner` | Runner | `plaza` |
| `homemaker` | `householder` | Householder | `home` |
| `elder` | `pensioner` | Pensioner | `parish` |
| `child` | — | **delete** | — |

### 3.3 `moveTo` / destination tokens

| Old token | New token | Resolves to |
|---|---|---|
| `tavern` | `diner` | kind `diner` |
| `temple` | `parish` | kind `parish` |
| `well` | `wash` | kind `wash` |
| `plaza` | `plaza` | plaza tiles, else kind `night-market` |
| `home` | `home` | NPC `homeId` |
| `work` | `work` | NPC `workId` |
| `bed` | `bed` | owned bed |
| `drink` | `drink` | vitae/drink resolver (diner or parish stock) |
| `target` | `target` | social target |

`custom.ts` `workplace === "plaza"` prefers `night-market` then `wash`.

`homeKindIds()` returns kinds tagged `home` (`walk-up`, `tenement`). If diner rooms still sleep people, include `diner` explicitly the same way `tavern` is included today.

### 3.4 Commodities

Saves may be wiped. Rename stock keys to match the ward.

| Old key | New key | Display |
|---|---|---|
| `grain` | `dry-goods` | Dry goods |
| `flour` | `charge` | Charge |
| `bread` | `bread` | Bread |
| `ale` | `well-drink` | Well drink |
| `food` | `food` | Food |
| `goods` | `goods` | Goods |
| `wood` | `scrap` | Scrap |
| `coin` | `coin` | Coin |
| *(new, optional)* | `parts` | Parts |

`ensureBuildingEconomy` and any UI stock labels use the new keys only.

---

## 4. Setting

### 4.1 Pitch

Fenwick Ward sits on the wet side of a larger unnamed city. Neon sits on brick. The parish still opens at dawn. The diner never closes. Kindred (demons, angels, vampires) hold ordinary jobs. Magic is municipal-adjacent: threshold signs on steel doors, bottled vitae behind the counter, a relic locker in the parish basement. Nobody duels in the plaza. Work happens. Night happens. The veil is a zoning problem.

### 4.2 Replacement setting bible

Replace `SETTING_BIBLE` and `SETTING_LINE` in `src/sim/defs.ts`.

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

### 4.3 What “cyberpunk × Constantine” means here

Use when naming rooms, businesses, and jobs:

- Fluorescent, wet asphalt, chainlink, roof antennas, parish gold leaf under a neon cross
- Trench weather. Night shifts. Paperwork that happens to bind a spirit
- Relics in lockers, not dragon hoards
- Coffee, bottled vitae, cheap noodles, charged cells
- Angels who look tired. Demons who fix signage. Vampires who clock out at dawn

Avoid:

- Thatched roofs, grain sacks, village greens, “ye olde,” rustic hearths as the default read
- High-fantasy spell duels
- Corporate megatowers as the whole map (one office kind is enough; this is a ward, not Night City downtown)

---

## 5. File map (touch list)

| File | Why |
|---|---|
| `src/sim/types.ts` | `BuildingKind` union = the new IDs only |
| `src/sim/defs.ts` | Jobs, kinds, names, spells, traits, setting bible, BT params, commodities |
| `src/sim/gen.ts` | Queue kinds, home filter, roster job IDs, PC job, building-name keys |
| `src/sim/interiors.ts` | `switch` cases on new kind IDs |
| `src/sim/interiors.test.ts` | Kind list |
| `src/sim/custom.ts` | plaza fallback kinds; `homeKindIds` |
| `src/sim/economy.ts` | New stock keys |
| `src/sim/narrative.ts` | Job/home phrasing |
| `src/sim/ai.ts` and nav / BT action resolvers | `where` token strings |
| `src/sim/persist.ts` / world hydrate | Drop any hardcoded old kind checks |
| `src/components/game/StartScreen.tsx` | Hero copy |
| `src/components/game/SettingsPane.tsx` | Bible helper text |
| Tests | Expected IDs and labels |

Grep the whole repo for every old ID in §3. Do not churn portraits (`public/portraits/*`).

---

## 6. Needs, traits, goals

Need **IDs** stay. Optional label-only tweaks:

| ID | New label |
|---|---|
| `hunger` | Hunger |
| `energy` | Energy |
| `social` | Company |
| `fun` | Static |
| `hygiene` | Clean |
| `comfort` | Shelter |
| `status` | Standing |
| `thirst` | Thirst |

Trait IDs stay. Relabel:

| ID | New label | Notes |
|---|---|---|
| `devout` | Devout | Still boosts `worship` |
| `industrious` | Clocked-in | Same work utility |
| `glutton` | Hollow | Same hunger decay |
| others | keep | |

Goal IDs and tree ids stay. Relabel + retarget:

| Goal ID | New label | Tree goes to |
|---|---|---|
| `eat` | Eat | `diner` or carried food |
| `sleep` | Sleep | `bed` |
| `drink` | Drink | `drink` |
| `ward` | Reward | `home` + `ward` action |
| `work` | Shift | `work` |
| `socialize` | Talk | `target` |
| `hygiene` | Wash | `wash` |
| `relax` | Kill time | `diner` or `plaza` |
| `worship` | Observe | `parish` |
| `wander` | Walk | wander |

BT labels: “Go to the diner”, “Go to the wash”, “Go to parish”, “Observe”. No “tavern” / “well” / “temple” in tree params.

---

## 7. Jobs after this pass

| ID | Label | Workplace | Hours | Goods | Wage | Roster |
|---|---|---|---|---|---|---|
| `superintendent` | Superintendent | `tenement` | 7–18 | produces `{ parts: 1 }` | 1 | 4 |
| `night-baker` | Night baker | `bakery` | 21–7 if wrap works, else 5–14 + TODO | consumes `{ dry-goods: 1 }`, produces `{ bread: 1, food: 2 }` | 2 | 2 |
| `diner-lead` | Diner lead | `diner` | 18–4 or 11–23 fallback | consumes `{ dry-goods: 1 }`, produces `{ well-drink: 2, food: 1 }` | 2 | 3 |
| `stall-broker` | Stall broker | `night-market` | 16–2 or 8–17 fallback | consumes `{ goods: 1 }`, produces `{ coin: 4 }` | 2 | 4 |
| `signwright` | Signwright | `atelier` | 10–20 | consumes `{ scrap: 1 }`, produces `{ goods: 1 }` | 2 | 3 |
| `grid-tech` | Grid tech | `substation` | 6–16 | consumes `{ dry-goods: 1 }` as cells-in, produces `{ charge: 1 }` | 2 | 2 |
| `parish-clerk` | Parish clerk | `parish` | 7–19 | — | 1 | 2 |
| `night-watch` | Night watch | `precinct` | 20–6 or 8–20 fallback | — | 1 | 4 |
| `runner` | Runner | `plaza` | 18–3 or 8–17 fallback | — | 1 | 10 |
| `householder` | Householder | `home` | 8–16 | consumes `{ dry-goods: 1 }`, produces `{ food: 2 }` | 1 | 8 |
| `pensioner` | Pensioner | `parish` | 10–15 | — | 1 | 6 |

If `startHour > endHour` is unsupported, do not invent a scheduler. Use a late finite window and leave a `TODO` on the job def.

### 7.1 Additive jobs (optional)

Only if the kind exists and total population does not jump.

| ID | Label | Workplace | Hours | Count |
|---|---|---|---|---|
| `records-clerk` | Records clerk | `parish` or optional `office` | 9–17 | 2 |
| `rig-tech` | Rig tech | `atelier` | 12–22 | 2 |
| `grill` | Grill | `diner` | 16–2 or 11–23 | 2 |

If added, cut `runner` count so founders stay near 48 + PC.

### 7.2 Player default

PC job is `defs.jobs["runner"]`. Narrative job string `"Runner"`.

---

## 8. Buildings / locations

### 8.1 Shipped kinds

| ID | Label | Tags | Stories | Footprint | Ground | Upper |
|---|---|---|---|---|---|---|
| `walk-up` | Walk-up | `home` | 2 | 4×3 | hall “Front room”, bedroom | loft “Sleep loft” |
| `tenement` | Tenement | `home`, `work` | 2 | 5×4 | kitchen “Galley”, hall “Front room” | bedroom “Flats” |
| `diner` | Diner | `work`, `shop`, `gather` | 2 | 7×5 | taproom “Counter”, kitchen “Grill” | bedroom “Upstairs rooms” |
| `bakery` | Night bakery | `work`, `shop` | 2 | 5×4 | shop “Window”, kitchen “Ovens” | loft |
| `night-market` | Night market | `work`, `shop`, `gather` | 1 | 6×5 | shop “Stalls” | — |
| `parish` | Parish | `work`, `worship`, `gather` | 1 | 6×6 | sanctuary “Nave”, office “Sacristy / records” | — |
| `atelier` | Atelier | `work` | 1 | 5×4 | workshop “Bay”, office “Cage” | — |
| `substation` | Substation | `work` | 2 | 5×5 | mill “Floor” | loft “Catwalk” |
| `precinct` | Precinct | `work` | 2 | 4×4 | office “Desk” | bunk “Lockers” |
| `wash` | Wash kiosk | `gather` | 1 | 2×2 | well “Wash” | — |

Room `kind` strings on floors (`hall`, `bedroom`, `taproom`, …) may stay. They are interior taxonomy, not ward vocabulary. Names in the table above are what the player sees.

### 8.2 Additive kinds (optional)

| ID | Label | Tags | Use |
|---|---|---|---|
| `clinic` | Night clinic | `work`, `gather` | later hygiene / comfort |
| `office` | Agency office | `work` | records, paper wards |
| `club` | Afterhours | `work`, `gather` | relax alt to diner |

Skip if interiors + union + queue would blow the pass. The ten renamed kinds are enough.

### 8.3 Generation queue

```
diner ×1
parish ×1
night-market ×1
bakery ×1
atelier ×1
substation ×1
precinct ×1
wash ×1
tenement ×4
walk-up ×20
```

Homes filter:

```ts
buildings.filter((b) => b.kind === "walk-up" || b.kind === "tenement")
```

Map paint: keep the road grid and central plaza. Optional: fewer edge `tree` stamps. Do not add tile kinds unless `TileKind` already has something urban.

### 8.4 Interiors

Rename every `case "farmhouse"` / `case "cottage"` / `case "tavern"` / … to the new IDs.

- `tenement`: galley, stacked beds, metal door. Not a hearth farm.
- `walk-up`: bed, sink, table.
- `diner`: counter, stools, grill.
- `parish`: chairs + records desk + locker (reuse existing furniture tile kinds).
- `substation`: machines as tables/counters.
- `wash`: a stall. Room name carries it if tiles cannot.

### 8.5 Building names

```
diner:         The Last Counter, Neon Mercy, The Closed Eye
bakery:        Graveyard Shift, Steam Window
night-market:  Fenwick Night Market
parish:        Parish of the Threshold, Our Lady of the Service Door
atelier:       Ash & Circuit, Crowe Signs
substation:    Ward Substation, East Pump
tenement:      14 Lumen Court, Stack Nine, The Old Dye Works
precinct:      Ward Precinct
wash:          Wash Kiosk
walk-up:       []
```

Unnamed walk-ups: `` `${surname} Walk-up` ``. Not “House.”

---

## 9. Names, spells, voice

All adult name lists. Keep roughly the same lengths.

**Feminine first:** Mara, Nell, Ivy, Cass, June, Rhea, Sable, Vera, Nico, Quinn, Adele, Bridget, Carmen, Delia, Esme, Frances, Greta, Hana, Iris, Jude, Kara, Leda, Mina, Odette, Pearl, Ruth, Sybil, Tess

**Masculine first:** Bram, Calder, Theo, Cole, Dorian, Ellis, Finn, Gideon, Harlan, Ivor, Jules, Kent, Lev, Moss, Niall, Owen, Peregrine, Rook, Silas, Victor, Walsh, York, Abel, Bennett, Cyrus, Dax, Ezra, Frost

**Surnames:** Ash, Crowe, Dunne, Hawke, Kell, Pike, Reed, Stone, Vale, Ward, Voss, Rourke, Lang, Mercer, Quinn, Sato, Alvarez, Bishop, Crane, Doyle, Frost, Glass, Hahn, Ibarra, Graves, Keller, Lynch, Morse

Avoid: Underhill, Yarrow, Bramble, Cartwright, Oak-as-default-tree-surname.

Narrative templates must accept “Night baker”, “Parish clerk”, “14 Lumen Court”. Rewrite “tends the fields” / “keeps the hearth.”

### Spells

| Old ID | New ID | Label | Effect |
|---|---|---|---|
| `threshold` | `threshold` | Threshold Sign | Redraws the ward on a steel door. The flat sleeps easier. |
| `hearthlit` | `service-light` | Service Light | Coaxes a dead fixture on without the grid. |
| `kindle` | `courtesy` | Small Courtesy | Warms a conversation at a counter. |
| `namesign` | `name-plate` | Name Plate | Marks a door with the household sign. |
| `quietus` | `quietus` | Quietus | Slows a pulse. Used in clinics and parish basements. |

Schools may stay `ward` / `hearth` / `charm` / `sign` / `bloodless vitae`, or become `ward` / `grid` / `charm` / `sign` / `vitae`. Pick one set and use it everywhere.

---

## 10. Copy / UI

- Start screen: boroughs in a city that keep. Found a ward from a seed.
- Settings bible helper: “What Fenwick Ward is. Read by roleplay.”
- Default town name may stay `"Fenwick"`. Bible and line carry “Ward.”
- No Grok copy.

---

## 11. Generation roster

| Job ID | Count |
|---|---|
| `superintendent` | 4 |
| `night-baker` | 2 |
| `diner-lead` | 3 |
| `stall-broker` | 4 |
| `signwright` | 3 |
| `grid-tech` | 2 |
| `parish-clerk` | 2 |
| `night-watch` | 4 |
| `runner` | 10 |
| `householder` | 8 |
| `pensioner` | 6 |
| **Total NPCs** | **48** plus PC |

Beds: 4 tenements + 20 walk-ups must cover 48 residents. Add beds in interiors or drop counts. Do not spawn people without a bed claim.

Ages: workers 18–58, pensioners 62–84, PC 30.

---

## 12. Tests and acceptance

### Mechanical

- Typecheck clean
- Interiors / persist / gen tests use **new** IDs only
- Repo grep finds no runtime `tavern`, `farmhouse`, `cottage`, `farmer`, `innkeeper`, `priest`, `guardhouse`, `child` job/kind IDs
- `generateWorld` seed `1742` emits only job IDs in §11
- Every founding NPC `age >= 18`
- Every founding NPC `homeId` is a `walk-up` or `tenement`
- Workplaces exist for every job that names a kind
- `SETTING_BIBLE` contains “ward” and does not contain “carts” / “South Field”
- No Grok/xAI strings
- Wiping `./data/pglite` or the towns table is the expected local reset; do not ship a migrate-old-ids path

### Content

- New borough reads as a city ward from names + building labels alone
- Diner, parish, night market, precinct, wash kiosk all present
- Roleplay snapshot still gets setting bible + job label + home name

### Non-goals

- New pixel atlas
- Wrapped night shifts if the clock cannot express them
- New ancestry
- Metro / multi-ward navigation

---

## 13. Implementation order

1. Delete `child` and every reference. Clamp ages.
2. Rename IDs in `types.ts` + `defs.ts` (kinds, jobs, commodities, spells, BT `where` params, names).
3. Update interiors switch cases and tests.
4. Update `gen.ts` queue, home filter, roster, PC job, walk-up name fallback.
5. Update `custom.ts`, economy, AI/nav resolvers.
6. Grep old IDs. Fix leftovers including UI and narrative.
7. Wipe local towns / PGLite data. Boot seed. Confirm diner + parish + night market and matching workplaces.

---

## 14. Out of scope

- Architecture Foundations rewrite
- MCP live-authoring tools
- Social sim expansion
- Combat / exorcism minigames
- Branding

This spec is the naming source of truth. Do not invent a second vocabulary.
