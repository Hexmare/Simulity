# Urban Fantasy Default World — Content Spec

**Status:** Ready for implementation  
**Tone target:** Urban fantasy. Cyberpunk texture meets Constantine occult.  
**Identity / files:** Follow `docs/Data_Driven_Catalog.md`. Rows live under `content/`. Primary id is a **pinned UUID**. Slug is authoring-only.  
**Saves:** Wipe. No slug migration.  
**Non-negotiable:** Adults 18+ only. No `child` job. No Grok/xAI branding. No illegal-activity systems.

This is the first shipped **kit**: `content/kits/fenwick-ward.json`. Do not encode Fenwick slugs in TypeScript.

---

## 1. Pitch

Fenwick Ward sits on the wet side of a larger unnamed city. Neon on brick. Parish at dawn. Diner never closes. Kindred (demons, angels, vampires) hold ordinary jobs. Magic is municipal-adjacent: signs on steel doors, bottled vitae behind the counter, a relic locker in the parish basement. Nobody duels in the plaza.

**SETTING_LINE:** `Fenwick Ward — neon on brick, incense on rain.`

**SETTING_BIBLE facts:**

- City ward, not a village.
- Humans run most counters. Kindred work the same streets.
- Magic is uncommon, visible, treated like a permit.
- Anchors: Parish of the Threshold; Fenwick Night Market; the diner after midnight.
- Public talk is public. Private vows stay private unless spoken.
- Signs are for homes and work, not war.

Use: fluorescent wet asphalt, tired angels, demons on signage, vampires clocking out at dawn.  
Avoid: thatch, grain sacks, village greens, spell duels, megatower downtown.

---

## 2. Pinned shipped UUIDs

These UUIDs are part of the product. Copy them into the JSON. Do not regenerate.

### 2.1 Building kinds

| Slug | UUID | Label | Tags |
|---|---|---|---|
| `walk-up` | `7bac3948-f182-4301-be38-92eb00a3890c` | Walk-up | `home` |
| `tenement` | `0d1a23dc-1acc-424d-9975-80694bafcb42` | Tenement | `home`, `work` |
| `diner` | `491d88f6-8919-4084-b0c5-a0ab0b902935` | Diner | `work`, `shop`, `gather` |
| `bakery` | `495e4667-a617-4278-bd7b-24df0b856369` | Night bakery | `work`, `shop` |
| `night-market` | `6823c48c-e621-49bb-be2a-ba1df6db492d` | Night market | `work`, `shop`, `gather` |
| `parish` | `cd34e4cb-e977-4195-bc2e-570d3c92d5e1` | Parish | `work`, `worship`, `gather` |
| `atelier` | `4f36e735-f191-4d63-b37c-c4cd60047d70` | Atelier | `work` |
| `substation` | `da327cfa-140d-4ec5-8c87-f44963d53f6a` | Substation | `work` |
| `precinct` | `f953670b-0668-46af-a79f-6aad9b4c58a3` | Precinct | `work` |
| `wash` | `7cbcb658-b371-437f-86cc-b57b725d0483` | Wash kiosk | `gather` |

Footprints / stories / rooms stay as previously specified (walk-up 4×3 two-storey, diner 7×5, parish 6×6, wash 2×2, …). Interiors are data on the kind row.

### 2.2 Jobs

| Slug | UUID | Label | Workplace |
|---|---|---|---|
| `superintendent` | `01d71a0e-749d-4fe9-aea8-77fa73bb7307` | Superintendent | tenement UUID |
| `night-baker` | `36666998-31f2-47df-8775-2656fad7fc35` | Night baker | bakery UUID |
| `diner-lead` | `dbc35b68-7834-487e-b60f-8b2866e7e8be` | Diner lead | diner UUID |
| `stall-broker` | `ea252e61-aca6-433d-80a2-e8003678e83a` | Stall broker | night-market UUID |
| `signwright` | `a443c7f0-f1eb-484d-b3c8-d0b1f9a5eabf` | Signwright | atelier UUID |
| `grid-tech` | `4df8e7bd-f56a-424a-bd3d-621a2416a864` | Grid tech | substation UUID |
| `parish-clerk` | `5b64392c-5ff0-4b52-9670-3952fd217b49` | Parish clerk | parish UUID |
| `night-watch` | `00ffc5c6-9b2c-4272-a419-c58bfbdc4b23` | Night watch | precinct UUID |
| `runner` | `105cafac-71d5-4688-80da-602226a6e5e0` | Runner | `sys:plaza` |
| `householder` | `e541d9b0-fed4-41d6-8e0b-c828bad3c016` | Householder | `sys:home` |
| `pensioner` | `7e5c4b0c-30e9-45c1-ad9e-aea8297a590c` | Pensioner | parish UUID |

No `child` row. Hours/wages/goods: see §4. If overnight wrap is unsupported, finite late window + TODO on the job row.

PC default job = runner UUID.

### 2.3 Commodities

| Slug | UUID | Label |
|---|---|---|
| `dry-goods` | `07d25536-cf7e-493a-b80e-9345c6fcad87` | Dry goods |
| `charge` | `e56722b9-70db-4b1f-8f7e-295e8147dfaf` | Charge |
| `bread` | `c2f2867d-10c9-4796-8b9b-c7519bff9227` | Bread |
| `well-drink` | `6c99b1c3-d9c5-4715-9dd4-d92570292ef7` | Well drink |
| `food` | `d9d8aad9-eb48-4070-83d0-6f0e73b7dfbb` | Food |
| `goods` | `3079c245-da31-4460-beff-1039e25f0143` | Goods |
| `scrap` | `0d20fcd4-40a5-4e8c-98d6-f771ba343e0c` | Scrap |
| `coin` | `bf4b550a-ef4d-44c3-b0d8-abf8a5423ed2` | Coin |
| `parts` | `a73ade1f-852d-4855-867f-9f86a83c4f77` | Parts |

### 2.4 Spells

| Slug | UUID | Label |
|---|---|---|
| `threshold` | `8f350640-2d71-4763-9295-0725a4835080` | Threshold Sign |
| `service-light` | `1c018685-cc3b-403c-8713-8c4b0e705e58` | Service Light |
| `courtesy` | `81605281-37a8-4f35-b675-23474bbf1ebc` | Small Courtesy |
| `name-plate` | `b6b6c736-6920-4611-9ceb-8e88657b6d9c` | Name Plate |
| `quietus` | `ba92d7aa-1d39-4519-ac33-badf742391c5` | Quietus |

Effects: steel-door ward; dead fixture on; counter courtesy; household plate; still a pulse. Schools: `ward` / `grid` / `charm` / `sign` / `vitae`.

### 2.5 Needs

Need **rows** get UUIDs so a later rename of “Spirit” → “Static” does not break `bb.needs`. Shipped:

| Slug | UUID | Label |
|---|---|---|
| `hunger` | `d8391055-5946-479e-8807-973374328290` | Hunger |
| `energy` | `df631b06-b6c2-4f92-b79d-6402f8b41eea` | Energy |
| `social` | `47bef273-c68a-487f-843f-01f3c88c5b71` | Company |
| `fun` | `ac5f35ce-92a2-45df-acbd-f363568ea456` | Static |
| `hygiene` | `7ed5eb43-0283-4c22-84a1-e1993f7b7bd8` | Clean |
| `comfort` | `a56a3b1b-40a1-426a-b76b-7fe5052b20fc` | Shelter |
| `status` | `e3df31c9-4dfa-4b1d-b65e-d5d0ad930715` | Standing |
| `thirst` | `f3a608c9-e74f-4262-8332-da4177bd064d` | Thirst |

Decay values stay as current code. Trait/goal considerations reference these UUIDs.

Ancestry IDs (`human`, `demon`, `angel`, `vampire`) also become UUID rows in `ancestries.json`. Generate pinned UUIDs at implement time and list them in the kit README or this file in a follow-up. Do **not** change ancestry *behavior* this pass. Keep `mark` as renderer enum (`none` | `halo` | `horns` | `fangs`).

Traits keep current modifiers; assign pinned UUIDs when filing `traits.json`. Goal + tree slugs stay (`eat`, `tree.eat`) but each file has its own UUID; `GoalDef.treeId` stores the tree UUID.

---

## 3. Kit: Fenwick Ward

`content/kits/fenwick-ward.json`

**Buildings**

| Kind slug | Count |
|---|---|
| diner | 1 |
| parish | 1 |
| night-market | 1 |
| bakery | 1 |
| atelier | 1 |
| substation | 1 |
| precinct | 1 |
| wash | 1 |
| tenement | 4 |
| walk-up | 20 |

**Homes:** walk-up + tenement UUIDs.

**Roster**

| Job slug | Count |
|---|---|
| superintendent | 4 |
| night-baker | 2 |
| diner-lead | 3 |
| stall-broker | 4 |
| signwright | 3 |
| grid-tech | 2 |
| parish-clerk | 2 |
| night-watch | 4 |
| runner | 10 |
| householder | 8 |
| pensioner | 6 |

48 NPCs + PC. Every resident gets a claimed bed. Ages 18–58 workers, 62–84 pensioners, PC 30.

**BT destinations**

| Goal | `moveTo.where` |
|---|---|
| eat | diner UUID (then eat) |
| sleep | `sys:bed` |
| drink | `sys:drink` |
| ward | `sys:home` |
| work | `sys:work` |
| socialize | `sys:target` |
| hygiene | wash UUID |
| relax | diner UUID, else `sys:plaza` |
| worship | parish UUID |
| wander | `sys:wander` |

---

## 4. Job goods and hours

| Slug | Hours | Goods (commodity UUIDs) | Wage |
|---|---|---|---|
| superintendent | 7–18 | produces parts | 1 |
| night-baker | 21–7 or 5–14 | consumes dry-goods; produces bread + food | 2 |
| diner-lead | 18–4 or 11–23 | consumes dry-goods; produces well-drink + food | 2 |
| stall-broker | 16–2 or 8–17 | consumes goods; produces coin | 2 |
| signwright | 10–20 | consumes scrap; produces goods | 2 |
| grid-tech | 6–16 | consumes dry-goods; produces charge | 2 |
| parish-clerk | 7–19 | — | 1 |
| night-watch | 20–6 or 8–20 | — | 1 |
| runner | 18–3 or 8–17 | — | 1 |
| householder | 8–16 | consumes dry-goods; produces food | 1 |
| pensioner | 10–15 | — | 1 |

Palette indices may keep 0–11 as now.

---

## 5. Names and buildings

Adult lists only.

**Feminine:** Mara, Nell, Ivy, Cass, June, Rhea, Sable, Vera, Nico, Quinn, Adele, Bridget, Carmen, Delia, Esme, Frances, Greta, Hana, Iris, Jude, Kara, Leda, Mina, Odette, Pearl, Ruth, Sybil, Tess

**Masculine:** Bram, Calder, Theo, Cole, Dorian, Ellis, Finn, Gideon, Harlan, Ivor, Jules, Kent, Lev, Moss, Niall, Owen, Peregrine, Rook, Silas, Victor, Walsh, York, Abel, Bennett, Cyrus, Dax, Ezra, Frost

**Surnames:** Ash, Crowe, Dunne, Hawke, Kell, Pike, Reed, Stone, Vale, Ward, Voss, Rourke, Lang, Mercer, Quinn, Sato, Alvarez, Bishop, Crane, Doyle, Frost, Glass, Hahn, Ibarra, Graves, Keller, Lynch, Morse

Kind `names` arrays:

```
diner          The Last Counter, Neon Mercy, The Closed Eye
bakery         Graveyard Shift, Steam Window
night-market   Fenwick Night Market
parish         Parish of the Threshold, Our Lady of the Service Door
atelier        Ash & Circuit, Crowe Signs
substation     Ward Substation, East Pump
tenement       14 Lumen Court, Stack Nine, The Old Dye Works
precinct       Ward Precinct
wash           Wash Kiosk
walk-up        []
```

Unnamed homes: `{surname} Walk-up`.

Traits: relabel `industrious` → Clocked-in, `glutton` → Hollow. IDs are new UUIDs; slugs may stay.

---

## 6. Optional kit extras (not required)

Kinds: `clinic`, `office`, `club` — new UUIDs if added.  
Jobs: `records-clerk`, `rig-tech`, `grill` — cut runner count to hold ~48.

---

## 7. Acceptance (content)

- Fenwick kit + catalog files exist; `defs.ts` has no Fenwick literals.
- Fresh town shows diner, parish, night market, precinct, wash kiosk by **label**.
- Saved `building.kind` / `bb.jobId` are the UUIDs in §2.
- Renaming slug `diner` → `all-nite` in JSON does not require a code change and does not orphan buildings (UUID unchanged).
- No child job. All ages ≥ 18.
- Setting bible uses “ward”, not carts / South Field.
- No Grok strings.

Engine acceptance lives in `docs/Data_Driven_Catalog.md` §11. Land both together.

---

## 8. Order

Implement the catalog spec first (loader, UUID indexes, kit-driven gen, interiors-from-def). File Fenwick JSON using the UUIDs in this document as the first shipped kit. Wipe PGLite towns. Boot.
