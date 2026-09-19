# Data-Driven Catalog + UUID Identity

**Status:** Implemented (landed; §11 acceptance is enforced by `src/sim/acceptance.test.ts`)  
**Depends on:** Architecture Foundations  
**Consumed by:** `docs/Urban_Fantasy_Default_World.md`  
**Saves:** May be wiped. No slug-compat layer.  
**Non-negotiable:** Adults only (18+). No Grok/xAI branding. No illegal-activity systems.

---

## 1. Current state (honest)

This section is the **pre-landing diagnosis**. Acceptance in §11 is the current bar; `src/sim/acceptance.test.ts` enforces it.

What the system looked like before this spec landed:

- `NeedDef`, `JobDef`, `BuildingKindDef`, `GoalDef`, `BtTree`, `AncestryDef`, `SpellDef` live as objects.
- `Defs` is a bag the sim indexes.
- Town saves carry a `DefsOverlay` for runtime-authored jobs/kinds.
- `custom.ts` validates new kind/job rows.
- UI editors exist (`KindsJobs.tsx`, `BtEditor.tsx`).

What still requires a code change:

- `BuildingKind` is a **closed TypeScript union** in `src/sim/types.ts`.
- Shipped rows are **literals in** `src/sim/defs.ts`.
- `src/sim/interiors.ts` **switches on kind slugs**.
- `src/sim/gen.ts` **hardcodes** the building queue and job roster by slug.
- BT `moveTo.where` and `JobDef.workplace` are **slug strings**.
- Adding a diner, a job, or a commodity means editing TypeScript and often a `switch`.

That is the gap. Close it.

---

## 2. Target

1. Shipped world content lives in **files**, not TS literals.
2. Every catalog row has a **UUID primary id**. Labels and slugs are metadata. Rename is a field write.
3. References (workplace, `moveTo`, produces, treeId, ancestry, home filter) store **UUIDs** or a small set of **engine tokens**. Never slugs.
4. Adding / removing / retuning a job, kind, need, commodity, name list, or generation kit does **not** require a compiler change.
5. Runtime overlay (editor / later MCP) writes the same shape onto the town and merges over shipped files.

Code still owns: tick loop, pathfinding, BT *interpreter*, utility scorer, action *implementations*, renderer primitives (`TileKind`), persistence plumbing.

---

## 3. Identity rules

### 3.1 UUID

- Catalog id = UUID v4, lowercase, canonical `8-4-4-4-12`.
- Generated **once** when the row is created. Never regenerated on rename.
- Shipped rows pin their UUIDs in git so every clone shares identity.
- Runtime-created rows get a new UUID from the server at insert time.
- Do not accept a client-supplied id unless it is a valid UUID and unique in that collection.

### 3.2 Slug (authoring only)

- Optional `slug` string. Kebab-case. Unique **per collection**, not globally.
- Used in filenames, editor search, docs, MCP prompts.
- **Never stored** on `Npc.bb.jobId`, `Building.kind`, BT params, or stock keys.
- Renaming `slug` or `label` does not rewrite world instances.

### 3.3 Label

- Human display. Change freely.

### 3.4 Engine tokens

Not catalog rows. Interpreter vocabulary. Prefix `sys:` so they cannot collide with UUIDs.

| Token | Meaning |
|---|---|
| `sys:home` | NPC home building |
| `sys:work` | NPC workplace building |
| `sys:plaza` | City plaza tiles, else first kind tagged `gather` |
| `sys:bed` | Owned bed furniture |
| `sys:drink` | Resolver: stock or room tagged `drink` |
| `sys:target` | Current social target |
| `sys:wander` | Unstructured walk |

`JobDef.workplace` is either a **building-kind UUID** or `sys:home` / `sys:plaza`.  
`moveTo.where` is an engine token **or** a building-kind UUID.

### 3.5 Instance ids vs catalog ids

| Thing | Id |
|---|---|
| Job definition | catalog UUID |
| Building *kind* definition | catalog UUID |
| This diner on the map | instance id (`b12`, or also UUID — pick UUID for new instances too) |
| This NPC | instance UUID |
| Need definition | catalog UUID |
| `bb.needs` key | need catalog UUID |

World entities (NPCs, buildings, furniture) should also use UUIDs going forward. Saves may be wiped.

---

## 4. File layout

```
content/
  catalog/
    needs.json
    traits.json
    commodities.json
    building-kinds.json
    jobs.json
    ancestries.json
    spells.json
    goals.json
    social.json
    names.json
    setting.json
  kits/
    fenwick-ward.json
  trees/
    eat.json
    sleep.json
    drink.json
    ward.json
    work.json
    socialize.json
    hygiene.json
    relax.json
    worship.json
    wander.json
```

JSON (not YAML) for one parser and easy MCP writes. One collection per file. Arrays of rows.

`src/sim/defs.ts` shrinks to a **loader + index**. No shipped job/kind literals.

Load at server boot. Merge order:

1. Shipped `content/catalog/*` + `content/trees/*`
2. Active kit `content/kits/<id>.json`
3. Town `DefsOverlay` (runtime edits)

Later overlay wins on the same UUID (patch). New UUID = insert. Missing UUID in overlay does not delete shipped rows; deletion is an explicit overlay `removedIds: string[]` per collection.

---

## 5. Row shapes

Every catalog row:

```ts
{
  id: string;       // UUID
  slug: string;     // unique per collection
  label: string;
  // collection-specific fields
}
```

### 5.1 Building kind

Keep current `BuildingKindDef` fields, plus:

- `id` UUID
- `slug`
- `tags` including `home` | `work` | `shop` | `gather` | `worship`
- `interior` recipe (replaces `interiors.ts` switch): rooms already on the def; add `furniturePlan` as data (list of `{ tile, roomKind, count?, tags? }`) so interiors are compiled from the def, not from `case "tavern"`
- `stockDefaults?: Record<commodityUuid, number>`

Delete `export type BuildingKind = "cottage" | ...`. `Building.kind` is `string` (UUID).

### 5.2 Job

- `workplace`: kind UUID | `sys:home` | `sys:plaza`
- `produces` / `consumes`: keys are **commodity UUIDs**
- `palette`, hours, wage as today
- no `child` job in any shipped file

### 5.3 Commodity

```ts
{ id, slug, label }
```

Stock maps and job goods use commodity UUIDs.

### 5.4 Need / trait / goal / spell / ancestry / social

Same as today plus UUID + slug.  
`GoalDef.treeId` = tree UUID (tree files also have `id` + `slug`).  
Consideration `needId` = need UUID.  
Trait modifiers that key needs/goals use UUIDs.

### 5.5 Names + setting

`names.json`: `{ firstF, firstM, surnames }` — all adult.  
`setting.json`: `{ line, bible }`.

### 5.6 Kit (generation)

`content/kits/fenwick-ward.json`:

```ts
{
  id: UUID,
  slug: "fenwick-ward",
  label: "Fenwick Ward",
  settingId: UUID,          // or inline; prefer setting.json singleton
  buildings: [{ kindId: UUID, count: number }],
  homes: [kind UUID, ...],  // which kinds receive residents
  roster: [{ jobId: UUID, count: number }],
  defaultPcJobId: UUID,
  unnamedHomePattern: "{surname} Walk-up"
}
```

`generateWorld(rng, defs, kit)` reads the kit. No kind/job slugs in `gen.ts`.

---

## 6. Indexes the loader must expose

```ts
catalog.jobs.byId[uuid]
catalog.jobs.bySlug["diner-lead"]      // authoring / tests only
catalog.kinds.tagged("home")           // UUID[]
catalog.commodity.bySlug["bread"]
```

Runtime sim path uses `byId` only.

Resolve helper:

```ts
function resolveWorkplace(job, buildings, homeId): WorkTarget
```

Looks up `job.workplace`. If UUID, find a building whose `kind === that UUID`. If `sys:plaza`, find first building whose kind tags include `gather`, else plaza tiles.

---

## 7. What stays in code

| Code | Why |
|---|---|
| BT interpreter + condition/action registry | `cond: "hasFood"`, `act: "eat"` are engine verbs |
| Utility scorer | reads goal considerations; does not know diner from parish |
| Nav / interiors compiler | compiles a kind's `interior` data into floors |
| `TileKind` union | renderer primitives (may data-drive later; not this pass) |
| Persistence | towns table, PGLite |
| Age clamp ≥ 18 | invariant, not content |

Adding a **new action** (`act: "hack"`) is still a code change. Adding a **new job that uses `act: "work"`** is not.

---

## 8. Editors, overlay, MCP

- In-app kind/job editors already write overlay. Switch them to UUID-on-create + slug/label fields.
- Overlay persists on the town save as today (`DefsOverlay`), keyed by UUID.
- MCP catalog insert/patch: later. Runtime MCP (`list_souls`, `move_soul`, `call_soul`, `assign_task`) is specified in `docs/Occupancy_Conversation_Ledger_and_MCP.md` and is a different tool surface — it does not write catalog rows. Overlay validators stay the contract for catalog MCP.
- Slug uniqueness validated on write. UUID uniqueness validated on write.

---

## 9. Interiors

`src/sim/interiors.ts` must stop switching on slugs.

Required: one compiler `buildFloors(kindDef, doorSide, rng)` that uses `kindDef.footprint`, `stories`, `ground`/`upper`, and a data `furniturePlan`. Existing per-kind case bodies become data on the kind row (or a `content/catalog/interiors/<slug>.json` keyed by kind UUID).

Tests pass a kind UUID + def, not `"cottage"`.

---

## 10. Migration / wipe

- No read-path from old slugs.
- Wipe `./data/pglite` towns after landing.
- Bump `TownSave` version if one exists. Reject older saves with a clear “found a new ward” path rather than a mapper.

---

## 11. Acceptance

- `src/sim/defs.ts` contains no shipped job/kind/need arrays.
- `BuildingKind` union is gone.
- `interiors.ts` has no `case "tavern"` / `case "cottage"` / urban replacements either — no kind-id switch.
- `gen.ts` has no string kind/job literals; it consumes a kit.
- Repo grep of runtime TS for `"tavern"`, `"farmer"`, `"cottage"` as ids is empty (docs may mention them as old).
- Every catalog row in `content/` has a pinned UUID.
- Renaming a kind `label`/`slug` and booting a **new** town does not require TS edits.
- Creating a job in the editor does not require TS edits.
- `bb.jobId` and `building.kind` in a fresh save are UUIDs.
- Adults only. No `child` row. No Grok strings.

---

## 12. Implementation order

1. Introduce `content/` JSON + loader + indexes. Keep slugs as ids temporarily *only* if a single intermediate commit is required; do not ship that state.
2. Pin UUIDs. Switch `Defs` maps to UUID keys.
3. Delete `BuildingKind` union. Fix types.
4. Data-drive interiors compiler. Delete kind switches.
5. Kit-drive `generateWorld`.
6. Point BT params and workplaces at UUIDs / `sys:*`.
7. Editor creates UUID rows.
8. Drop `src/sim/defs.ts` literals. Grep clean.
9. Wipe towns. Boot Fenwick kit.

Urban-fantasy vocabulary (diner, parish, runner, …) is applied **as the first shipped catalog**, not as a second rewrite of `defs.ts`.
