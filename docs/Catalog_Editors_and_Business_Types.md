# Catalog Editors and Business Types

**Status:** [spec_index.md](spec_index.md). Draft. Q1–Q5 locked 2026-09-20.  
**Depends on:** [Data-Driven Catalog](Data_Driven_Catalog.md), [Urban Fantasy](Urban_Fantasy_Default_World.md), [Scene Time / Kits](Scene_Time_Prompts_Appearance_and_Kits.md)  
**Saves:** Shipped `content/catalog/*.json` stay in git and are read-only in the UI. Custom catalog JSON lives in a writable server directory (same pattern as custom kits). Live towns keep `DefsOverlay`. No wipe of existing towns; they keep the defs they were generated with plus overlay.  
**Non-negotiable:** Adults 18+ only. Editors cannot author a minor. Concealed-ancestry rules still apply. Client has zero sim logic.

**Terminology (locked Q5):** the playable place is a **city**. Shipped city name: **Shadows Veil**. Money: **credits**. Not ward, not coin. (Magic school `ward` stays.)

---

## 1. Why this file exists

Kit builder (scene spec) edits **how many** of each already-defined thing a city gets. It does not author the things.

Today the Town ledger can add a building kind and a job (`KindsJobs.tsx`). Everything else in `content/catalog/` is files-only:

ancestries, building-kinds, commodities, goals, jobs, names, needs, setting, social, spells, traits.

There is no **business type**. A diner is a building kind; a diner-lead job points at that kind UUID. Two diners are two buildings of the same shell. There is no catalog row that means “this is a restaurant business” independent of the floorplan.

The ask: full catalog editors, plus business types, so the world can grow from the UI.

---

## 2. Goals

1. One editor per catalog collection listed above (plus garments when that catalog lands, plus business types).
2. Same JSON shape as the shipped files. Duplicate / edit / download / upload. Shipped rows are read-only.
3. **Business type** = use of a building (staff, stock, tags). **Building kind** = the shell.
4. Kit stays **buildings-first**. Each spawned building can carry a type. Staff is defined on the type, not as a second kit list to keep in sync.
5. Jobs match workplaces **smartly** (bartender at a bar, waitress at a diner, housekeeper at a home).
6. New shipped businesses this pass. Display name is **Shadows Veil**. Places are **cities**, not wards. Money is **credits**, not coin.

---

## 3. Non-goals

- Catalog **MCP** (still a later spec). UI + JSON files this pass.
- Rewriting shipped catalog in git from the UI (duplicate-to-custom).
- Node-graph interior designer (layouts stay JSON; a simple room list + footprint is enough to add a kind).
- Generating new portraits or lore with an LLM from the editor.
- Per-town catalog becoming a second kit format.
- People slider scaling shops (scene spec Q5: homes + roster only).

---

## 4. Where editors live

**Locked Q4: both, same forms.**

**Start screen (no town loaded) — Library.**  
Catalog tab next to kit builder. Lists collections. Edits custom JSON on the server. This is how you invent a new ancestry or a clinic **before** generating a city.

**Live city — Overlay.**  
City tab today has a stub kinds/jobs adder. Replace it with the same field editors, writing `DefsOverlay` on **this** city (insert / patch / `removedIds`). Overlay wins at runtime. Does not mutate Library files. Ledger label **Town** becomes **City**. Purse copy **coin** becomes **credits**.

Shipped rows: duplicate-to-custom in Library, then edit. Live overlay can still patch a shipped id for that town only.

---

## 5. Editors (one form per collection)

UUID is assigned on create, never edited. Slug is authoring-only. Label is required. Ages < 18 rejected on any ancestry/job/name path.

| Collection | Fields the form covers (this pass) |
|---|---|
| ancestries | label, slug, note, mark, `mundane` (human = mundane; others conceal by default) |
| building-kinds | label, names, footprint, stories, rooms, tags, layouts (JSON textarea ok), stockDefaults, furniturePlan |
| commodities | label, tags, price |
| goals | label, treeId, considerations |
| jobs | label, workplace matcher (§6.2), hours, wage, produces/consumes, palette |
| names | firstF, firstM, surnames (lists) |
| needs | label, decayPerHour, critical |
| setting | label, line, bible |
| social | label, effects |
| spells | label, cost, notes |
| traits | label, notes |
| garments | when scene spec lands: slot, layer, label |
| **business types** | label, default `buildingKindId`, `staff[]`, stockDefaults, tags, hours |

Validate with the existing `custom.ts` rules (extend them; don’t fork). Import JSON must be UUID-valid and 18+.

Trees stay in the visual BT editor. Setting bible is a textarea, not a rich doc.

---

## 6. Buildings, types, staff, smart jobs

### 6.1 Two catalogs

**Building kind** = shell (footprint, rooms, furniture).  
**Business type** = what that shell is used for.

```
BusinessType {
  id, slug, label
  buildingKindId          // default shell
  staff: [{ jobId, countPerInstance }]   // required workers for ONE instance
  stockDefaults?
  tags: ["shop","eat","work",…]
  hours?: { startHour, endHour }
}
```

A generated building stores `kindId` **and** `businessTypeId | null`. Homes and the PC house have `businessTypeId: null`.

### 6.2 Job workplace is a matcher (locked Q1)

`JobDef.workplace` is not “this one UUID kind only.” Resolve in this order:

| Value | Matches |
|---|---|
| `sys:home` / `sys:plaza` / other `sys:*` | engine tokens, unchanged |
| a **business type** id | buildings whose `businessTypeId` is that type (bartender → bar, bouncer → bar, waitress → diner) |
| a **building kind** id | buildings of that kind |
| a **tag** (`home`, `eat`, `shop`, `work`, `worship`) | buildings whose kind or type carries that tag (housekeeper → `home`) |

Gen / daily work: pick a matching building and set `workId`. If several match, prefer one with fewer assigned workers, then rng. A housekeeper works at a home; they are not required staff on every walk-up unless a type says so.

Invalid workplace (unknown id, not a tag, not sys) fails validation in the editor.

### 6.3 Kit is buildings-first (locked Q2)

No parallel `kit.businesses[]`. Kit `buildings[]` gains an optional type:

```
{ "kindId": "<shell>", "count": 2, "typeId": "<business type>" }
```

- `typeId` present: each instance gets that business type. Staff for the city += `count * type.staff`. `kindId` should be the type’s default shell (editor warns if it differs; still allowed so you can put a bar in a diner shell).
- `typeId` omitted: residence / civic shell with no staff table (walk-up, tenement, PC home, maybe parish if we keep clerks on roster).

**Staff is not a second roster to keep in sync.** Kit builder shows a derived line: “From buildings: 2 diner-leads, 2 bartenders, 1 bouncer…”. `kit.roster[]` is **extras** who live here and are not implied by staff (runners, pensioners, householders).

People slider (scene spec Q5): scales **homes** and **roster extras**. Building `count` for typed businesses stays as authored, so staff stays put.

PC home: one untyped `pc-home` kind. Never staffed unless you add a type later.

### 6.4 Shipped migration

Each current work/shop kind gets a business type with staff taken from today’s shipped roster counts **per instance**:

| Type | Shell | Staff per instance (starting point) |
|---|---|---|
| Diner | diner | diner-lead × 2 (2 buildings × 3 leads in kit ≈ 1.5; round to 2 and drop extras from roster) |
| Night bakery | bakery | night-baker × 2 |
| Night market | night-market | stall-broker × 4 |
| Sign shop | sign-shop | signwright × 3 |
| Grid station | grid | grid-tech × 2 |
| Parish | parish | parish-clerk × 2 |
| Watch house | watch | night-watch × 4 |
| Wash | wash | — (no dedicated job today; leave untyped or staff 0) |

Exact per-instance numbers: derive so `count * staff` ≈ current roster for that job, remainder stays on `roster[]`. Superintendents stay roster (workplace = tenement kind / `home` tag), not diner staff.

### 6.5 New content this pass (locked Q3)

Add a generic **shopfront** kind (reuse for several types) plus a **bar** kind (not the diner — different rooms: bar, back, door).

| Business | Shell | Staff per instance |
|---|---|---|
| Bar | bar | bartender × 2, bouncer × 1 |
| Tailor | shopfront | tailor × 2 |
| Pawn | shopfront | pawnbroker × 1 |
| Bookshop | shopfront | bookseller × 1 |
| Clinic | shopfront (or a small clinic kind if shopfront feels wrong) | medic × 2 |

All adults 18+. Kit: 1 of each new type (2 if the map looks empty — implementer’s call, keep it small). New jobs get workplace = that **business type** id. Eat affinity: bar can take `eat` if we serve drinks there; clinic does not.

Names, stock, interiors: urban-fantasy, not pastoral. No “Hi mr. demon” on the door.

---

## 7. Decisions

| # | Locked 2026-09-20 |
|---|---|
| Q1 | Workplace is a **matcher**: sys token, business type, building kind, or tag. Bartender at a bar, waitress at a diner, housekeeper at a home. |
| Q2 | Kit stays **buildings[]**. Each row may set `typeId`. Staff lives on the business type. Roster is extras only. |
| Q3 | New shipped businesses this pass: Bar, Tailor, Pawn, Bookshop, Clinic. |
| Q4 | Library (start screen) **and** live overlay. Same forms. |
| Q5 | Display name **Shadows Veil**. Call the place a **city**, not a ward. Money is **credits**, not coin. Kit UUID stays. Slug/file become `shadows-veil` at implement. |

---

## 8. Acceptance

1. Start screen Catalog: duplicate Human ancestry, rename, save custom JSON, generate a city that can pick it.
2. Live City overlay: add a job; it exists only in that city’s overlay; Library files unchanged.
3. Cannot save an ancestry/job/kit row with age < 18.
4. Two diner buildings with type Diner spawn diner-lead staff onto those buildings; compact cards / workId match.
5. A bartender’s workplace matcher fills a Bar building, not a walk-up. A housekeeper matcher fills a home-tagged building.
6. New city generates with Bar, Tailor, Pawn, Bookshop, Clinic present and staffed.
7. Download/upload round-trips a custom catalog file.
8. UI, kit label, and setting line say **Shadows Veil** (a city). Purse copy says **credits**. Spell school `ward` (steel-door ward) is unchanged — that is magic, not the place.
