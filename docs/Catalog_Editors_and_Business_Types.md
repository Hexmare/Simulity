# Catalog Editors and Business Types

**Status:** [spec_index.md](spec_index.md). Draft. Numbered questions in §7.  
**Depends on:** [Data-Driven Catalog](Data_Driven_Catalog.md), [Urban Fantasy](Urban_Fantasy_Default_World.md), [Scene Time / Kits](Scene_Time_Prompts_Appearance_and_Kits.md)  
**Saves:** Shipped `content/catalog/*.json` stay in git and are read-only in the UI. Custom catalog JSON lives in a writable server directory (same pattern as custom kits). Live towns keep `DefsOverlay`. No wipe of existing towns; they keep the defs they were generated with plus overlay.  
**Non-negotiable:** Adults 18+ only. Editors cannot author a minor. Concealed-ancestry rules still apply. Client has zero sim logic.

---

## 1. Why this file exists

Kit builder (scene spec) edits **how many** of each already-defined thing a ward gets. It does not author the things.

Today the Town ledger can add a building kind and a job (`KindsJobs.tsx`). Everything else in `content/catalog/` is files-only:

ancestries, building-kinds, commodities, goals, jobs, names, needs, setting, social, spells, traits.

There is no **business type**. A diner is a building kind; a diner-lead job points at that kind UUID. Two diners are two buildings of the same shell. There is no catalog row that means “this is a restaurant business” independent of the floorplan.

The ask: full catalog editors, plus business types, so the world can grow from the UI.

---

## 2. Goals

1. One editor per catalog collection listed above (plus garments when that catalog lands, plus business types).
2. Same JSON shape as the shipped files. Duplicate / edit / download / upload. Shipped rows are read-only.
3. A **business type** collection: commercial use (jobs, stock, hours, tags) bound to a building **kind** (the shell).
4. Kit builder then places businesses by type, not by copying job counts by hand — or keeps both; ask Q1.

---

## 3. Non-goals

- Catalog **MCP** (still a later spec). UI + JSON files this pass.
- Rewriting shipped Fenwick in git from the UI.
- Node-graph interior designer (layouts stay JSON; a simple room list + footprint is enough to add a kind).
- Generating new portraits or lore with an LLM from the editor.
- Per-town catalog becoming a second kit format.

---

## 4. Where editors live

**Start screen (no town loaded) — Library.**  
Catalog tab next to kit builder. Lists collections. Edits custom JSON on the server. This is how you invent a new ancestry or a clinic **before** generating a ward.

**Live town — Overlay.**  
Town tab today has a stub kinds/jobs adder. Replace it with the same field editors, writing `DefsOverlay` on **this** town (insert / patch / `removedIds`). Overlay wins at runtime. Does not mutate Library files.

Two stores, one form component.

Shipped Fenwick catalog: duplicate-to-custom in Library, then edit. Live overlay can still patch a shipped id for that town only.

---

## 5. Editors (one form per collection)

UUID is assigned on create, never edited. Slug is authoring-only. Label is required. Ages < 18 rejected on any ancestry/job/name path.

| Collection | Fields the form covers (this pass) |
|---|---|
| ancestries | label, slug, note, mark, `mundane` (human = mundane; others conceal by default per scene spec Q4) |
| building-kinds | label, names, footprint, stories, rooms, tags, layouts (JSON textarea ok), stockDefaults, furniturePlan |
| commodities | label, tags, price |
| goals | label, treeId, considerations |
| jobs | label, workplace (kind **or** business type — Q1), hours, wage, produces/consumes, palette |
| names | firstF, firstM, surnames (lists) |
| needs | label, decayPerHour, critical |
| setting | label, line, bible |
| social | label, effects |
| spells | label, cost, notes |
| traits | label, notes |
| garments | when scene spec lands: slot, layer, label |
| **business types** | §6 |

Validate with the existing `custom.ts` rules (extend them; don’t fork). Import JSON must be UUID-valid and 18+.

Trees stay in the visual BT editor. Setting bible is a textarea, not a rich doc.

---

## 6. Business types

**Building kind** = the shell (footprint, rooms, furniture).  
**Business type** = what occupies a shell (who works there, what it stocks, when it is open, eat/shop tags).

```
BusinessType {
  id, slug, label
  buildingKindId     // shell
  jobs: [{ jobId, countPerInstance }]
  stockDefaults?     // commodity UUID → amount; merges over the kind’s
  tags: ["shop","eat","work",…]
  hours?: { startHour, endHour }  // display / later AI; jobs still have shifts
}
```

Fenwick migration (no behavior change until you add rows):

- Each current work/shop kind gets a matching business type (Diner, Night bakery, Night market, Sign shop, Grid station, Parish, Watch house, Wash).
- Kit `buildings[]` for those kinds can stay as-is **or** move to `businesses: [{ typeId, count }]`. Ask Q1.

New content (this is the expansion): add business types that **reuse** a generic shop/hall kind instead of cloning a floorplan per shop. Example: one `shopfront` kind, business types Tailor / Pawn / Books. Roster jobs point at the **business type** (or keep pointing at the kind — ask Q1).

A generated building instance stores `kindId` (shell) and `businessTypeId` (use). Interior comes from the kind. Stock and job assignment come from the business type.

Kit People slider does **not** scale business counts (scene spec Q5: homes only). You author diner count in the kit.

PC home is a kind, not a business.

---

## 7. Questions

Number your answers.

**Q1. Job workplace.** Today `JobDef.workplace` is a building-kind UUID (or `sys:*`). After business types: (A) workplace is a **business type** UUID, buildings of that business hire that job; (B) workplace stays a **kind**, business type is only a kit spawn helper; (C) allow either.

**Q2. Kit spawn.** (A) add `kit.businesses[]` and stop listing shop kinds in `kit.buildings[]`; (B) keep `buildings[]` as the source of truth and derive businesses; (C) both, kit builder shows businesses and writes both.

**Q3. First new Fenwick businesses this pass.** Proposed shells+types if you want content now (all 18+): Tailor, Pawn, Bookshop, Clinic, Bar (separate from diner). Or: **editors only**, no new Fenwick rows until you pick them. Which?

**Q4. Live overlay vs Library.** Proposed: **both**, same forms. Alternative: Library only (start screen); live town stays kinds/jobs stub.

---

## 8. Acceptance (after lock)

1. Start screen Catalog: duplicate Human ancestry, rename, save custom JSON, generate a town that can pick it.
2. Live Town overlay: add a job; it exists only in that town’s overlay; Library files unchanged.
3. Cannot save an ancestry/job/kit row with age < 18.
4. A business type “Diner” on the diner kind still produces two diner buildings from Fenwick counts and hires diner-leads into them.
5. Download/upload round-trips a custom catalog file.
