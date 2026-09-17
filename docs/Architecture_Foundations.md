# Architecture Foundations

## 1. High-Level Philosophy

This system is built around **extensibility and data-driven design** rather than traditional game AI patterns. The core belief is that a rich, long-term simulation emerges from well-designed, composable, and runtime-modifiable systems rather than from deeply hardcoded logic.

The architecture supports a **hybrid model**:
- An autonomous simulation layer (Utility Goal Selection + data-driven Behavior Trees) runs continuously for all NPCs when the player is not directly interacting with them. This layer generates needs decay, routines, decisions, history, mood, and world state.
- When the player (as PC) engages one or more NPCs in roleplay, an LLM Roleplay Layer temporarily assumes control of only those involved NPCs. The LLM receives a complete, authoritative snapshot of simulation state (Blackboard + relevant event history) so it can roleplay with full knowledge of the NPC’s current needs, mood, past events, relationships, and desires. Non-involved NPCs continue autonomous execution without pause.
- On interaction end, the LLM returns structured state deltas that are validated and reconciled back into the Blackboard by the autonomous layer. The autonomous systems remain the single source of truth.

Key architectural drivers:
- Runtime creation and modification of content via LLM/MCP (for both world content and NPC roleplay context)
- Visual authoring of behavior
- Layered decision making (Goal Selection → Execution) with clean hand-off points for LLM roleplay
- Strong separation between data, autonomous execution logic, and LLM roleplay consumption
- Blackboard as the authoritative bridge between autonomous systems and LLM roleplay

## 2. Core Layers

### 2.1 Data / Definition Layer

- All major entities are defined as **catalog rows in files** (`content/catalog/*.json`, `content/trees/*.json`, `content/kits/*.json`), not as TypeScript literals.
- Primary collections: Needs, Traits, Commodities, Jobs, Building kinds, Ancestries, Spells, Goals, Social actions, Behavior Trees, Name lists, Setting bible, Generation kits.
- Every catalog row has a **UUID v4 primary id**. `slug` and `label` are authoring/display fields. World instances (`bb.jobId`, `Building.kind`, stock keys, goal considerations) store UUIDs. Renaming a diner does not rewrite the world.
- Engine-only destinations use `sys:*` tokens (`sys:home`, `sys:work`, `sys:plaza`, `sys:bed`, `sys:drink`, `sys:target`, `sys:wander`). Those are interpreter vocabulary, not catalog rows.
- Closed unions of kind slugs (`BuildingKind = "tavern" | "cottage" | …`) are forbidden.
- Runtime overlay (`DefsOverlay` on the town save) merges on UUID: insert, patch, or explicit `removedIds`. Editor and future MCP tools write this shape.
- Full rules: `docs/Data_Driven_Catalog.md`. First shipped kit: `docs/Urban_Fantasy_Default_World.md`.

### 2.2 Goal Selection Layer (Utility AI)
- Responsible for deciding *what* high-level goal an NPC should pursue while under autonomous control.
- Uses a Utility-based scoring system that considers:
  - Current Needs values
  - Time of day / Schedule
  - Current context (location, recent events, relationships)
  - Job requirements
- Should be configurable through data (considerations and scoring rules defined externally).
- Outputs a single winning goal that is passed to the Behavior Tree layer.
- Inactive for NPCs currently under LLM roleplay control.

### 2.3 Behavior Tree Execution Layer
- Executes the goal chosen by the Goal Selection layer for NPCs under autonomous control.
- Behavior Trees are **data-driven** (loaded from serialized format, not hardcoded).
- Supports visual editing.
- Uses a **Blackboard** for shared state.
- Designed to be interruptible and resumable (to support clean pause when LLM roleplay takes over an NPC).
- On interaction start, the relevant NPC’s Behavior Tree execution is paused; on reconciliation, it resumes from updated Blackboard state.
- Tree **params that name content** (workplace, destination kind) store catalog UUIDs or `sys:*` tokens. Action/condition *names* (`eat`, `hasFood`) stay engine verbs.

### 2.4 Blackboard
- Central per-NPC state container and the **single source of truth** for both autonomous systems and LLM roleplay.
- Contains current Needs, active Goal, location, knowledge, relationships, mood, recent history/events, and any temporary working data.
- Acts as the communication layer between Goal Selection, Behavior Trees, and the LLM Roleplay Layer.
- Must support:
  - Efficient snapshot extraction for LLM consumption (read-only view of relevant keys + event history).
  - Structured delta application from LLM roleplay scenes (validated changes to needs, mood, relationships, location, knowledge).
- Prevents direct mutation by the LLM; all LLM output goes through a reconciliation/validation step in the autonomous layer.
- Snapshot should include slug/label for UUID fields so the LLM reads “Night baker”, not a raw UUID.

### 2.5 Simulation Core
- Handles time progression (tick-based)
- Needs decay
- Navigation system (staged/hierarchical)
- World state (roads, buildings as containers, entrances)
- Relationship and memory systems (future)
- Interaction management: tracks which NPCs are currently under LLM roleplay control, pauses/resumes their autonomous execution, and coordinates state reconciliation after player scenes end.
- World generation consumes a **kit** (building counts, job roster, home kinds). It does not embed a specific ward’s slugs.

### 2.6 LLM Roleplay Layer
- Activated only when the PC initiates interaction with one or more specific NPCs.
- Receives a clean, read-only snapshot of the involved NPC(s)’ Blackboard(s) plus relevant recent event history so the LLM has full knowledge of mood, needs, wants, desires, past events, and relationships.
- Responsible for in-character dialogue, actions, reactions, and social behavior during the player scene.
- Non-involved NPCs continue normal autonomous tick execution with zero impact.
- On scene conclusion, the LLM returns structured state deltas (changes to needs, mood, relationships, location, knowledge, new events). These deltas are validated against simulation rules and applied back to the Blackboard(s) by the autonomous layer before autonomous execution resumes for the involved NPC(s).
- The LLM never directly writes to the core simulation state or bypasses the Blackboard reconciliation protocol.

## 3. Key Design Decisions

### 3.1 Hybrid Decision Architecture
- **Utility AI** (or configurable goal scoring) sits above Behavior Trees for autonomous NPCs.
- Utility AI selects the current high-level goal.
- Behavior Trees handle the execution of that goal.
- This separation allows the system to remain responsive while still supporting longer-term goals.
- When an NPC enters LLM roleplay, autonomous goal selection and BT execution are paused for that NPC only.

### 3.2 Data-Driven Everything
- New jobs, needs, kinds, commodities, and kits are added by writing catalog JSON or overlay rows — not by shipping a TypeScript change.
- Behavior Trees must be serializable and loadable at runtime.
- Goal scoring considerations should be definable in data.
- LLM roleplay context snapshots and reconciliation deltas must also be defined through data contracts (Blackboard schema).
- New *engine verbs* (a new BT action implementation, a new tile primitive) still require code. That line is intentional.

### 3.3 Navigation as Containers + Entrances
- Buildings are treated as containers.
- Movement between city and building interiors happens through defined entrances.
- Navigation is staged (e.g., "Exit Apartment" → "Exit Building" → "Travel to Destination" → "Enter Building" → "Reach Target").

### 3.4 Visual Behavior Tree Editor
- The editor is a first-class part of the system from the beginning.
- Trees are stored in a format that both the editor and the runtime can use.
- The editor should support debugging (stepping, breakpoints, blackboard inspection).
- Trees must support clean pause/resume semantics for LLM hand-off.
- Editor pickers show slug/label; persisted params store UUID or `sys:*`.

### 3.5 Interaction Hand-off and State Reconciliation Protocol
- Clear, explicit protocol required for transitioning an NPC between autonomous control and LLM roleplay.
- On interaction start: Autonomous systems provide a consistent snapshot; BT execution for involved NPC(s) is paused.
- During interaction: LLM operates on the snapshot; non-involved NPCs continue normal simulation.
- On interaction end: LLM returns structured deltas → autonomous layer validates and applies deltas to Blackboard → resumes BT execution from the new state.
- This protocol must preserve simulation invariants and prevent desynchronization between player-facing scenes and background world state.

### 3.6 Persistence
- The server is the single source of truth for boroughs and LLM settings. The browser is a view. Nothing is stored in localStorage as an active store.
- Default backend is **file-backed PGLite** at `./data/pglite`. `npm install && npm run dev` is enough — no `DATABASE_URL` required.
- When `DATABASE_URL` is set, the same schema runs on Neon/Postgres so any machine talking to that server sees the same towns and settings.
- Schema lives in `migrations/*.sql` and is applied automatically on PGLite boot (and by `scripts/migrate.mjs` on Neon).
- `src/sim/persist.ts` still has a memory/test KeyStore used by unit tests. Production reads and writes go through `src/lib/server/store.ts` + TanStack server functions.
- A one-time lift may copy leftover Fenwick localStorage keys onto the server and then delete them. After that lift, localStorage is unused.
- Shipped catalog files are read from disk at boot. Town overlay is persisted with the town row.

### 3.7 Catalog identity
- UUID is identity. Slug is a handle. Label is a name.
- Shipped UUIDs are pinned in git (`docs/Urban_Fantasy_Default_World.md` §2).
- Instance ids for NPCs and placed buildings should also be UUIDs for new worlds.
- See `docs/Data_Driven_Catalog.md`.

## 4. Major Challenges & Risks

- **Runtime Extensibility**: Adding new definitions while the simulation is running is complex and risky. Requires strong validation and safe update mechanisms.
- **Visual Editor Complexity**: Building a good visual Behavior Tree editor is a significant undertaking. Scope must be carefully managed in early phases.
- **Data Model Evolution**: As the system grows, the data schemas will need to evolve. This must be planned for.
- **Performance vs Flexibility**: Highly dynamic systems can have performance costs. We must monitor this as complexity increases.
- **State Synchronization Between Layers**: The hand-off between autonomous simulation and LLM roleplay introduces risk of desync or invariant violation if reconciliation is not strictly validated. The Blackboard and reconciliation protocol must enforce clear boundaries so the LLM cannot corrupt core simulation rules.
- **UUID readability**: Raw UUIDs are hostile in diffs and LLM prompts. Indexes by slug and snapshot label-mapping are mandatory, not optional polish.

## 5. Guiding Questions for Future Decisions

When making architectural decisions, we should regularly ask:
- Does this keep the system data-driven and extensible at runtime?
- Can this be created or modified via MCP/LLM without code changes?
- Does this support visual editing where appropriate?
- Is the separation between Goal Selection and Execution clear?
- Will this scale toward long-term autonomous NPC behavior?
- Does this maintain clear separation of concerns so the LLM Roleplay Layer consumes state via defined snapshots and returns validated deltas without bypassing or corrupting the autonomous simulation invariants?
- Is the thing we are adding a **catalog row** (UUID + file) or an **engine verb** (code)? Do not mix them.

## 6. Current Assumptions

- 2D top-down world
- Tick-based simulation on the backend
- Bun + TypeScript
- Server-authoritative (frontend is a thin client). Towns and LLM settings persist in server Postgres (file-backed PGLite locally, Neon when DATABASE_URL is set). Browser localStorage is not a store.
- Behavior Trees will be the primary execution mechanism for goals under autonomous control
- Utility-based scoring (or similar) for goal selection under autonomous control
- LLM roleplay is used exclusively for player-facing interactions with specific NPCs. It receives state via defined Blackboard snapshots and event history. It is external to the core tick loop. Only involved NPCs have their autonomous execution paused during a player scene; all other NPCs continue uninterrupted. State changes from LLM scenes are reconciled through the Blackboard protocol rather than applied directly by the LLM.
- Shipped content is the Fenwick Ward urban-fantasy kit. Pastoral slugs (`tavern`, `farmer`, `cottage`) are retired.
- All NPCs are adults (18+). There is no child job or minor cast.
