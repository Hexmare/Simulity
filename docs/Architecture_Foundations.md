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
- All major entities are defined as data (JSON/YAML or similar).
- Primary data types include:
  - **Needs**
  - **Jobs** (with associated tasks and schedules)
  - **Locations** (with entrance definitions)
  - **Behavior Trees** (serialized format)
  - **Tasks / Actions**
- This layer must support hot-reloading / runtime addition of new definitions via MCP tools.

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

### 2.4 Blackboard
- Central per-NPC state container and the **single source of truth** for both autonomous systems and LLM roleplay.
- Contains current Needs, active Goal, location, knowledge, relationships, mood, recent history/events, and any temporary working data.
- Acts as the communication layer between Goal Selection, Behavior Trees, and the LLM Roleplay Layer.
- Must support:
  - Efficient snapshot extraction for LLM consumption (read-only view of relevant keys + event history).
  - Structured delta application from LLM roleplay scenes (validated changes to needs, mood, relationships, location, knowledge).
- Prevents direct mutation by the LLM; all LLM output goes through a reconciliation/validation step in the autonomous layer.

### 2.5 Simulation Core
- Handles time progression (tick-based)
- Needs decay
- Navigation system (staged/hierarchical)
- World state (roads, buildings as containers, entrances)
- Relationship and memory systems (future)
- Interaction management: tracks which NPCs are currently under LLM roleplay control, pauses/resumes their autonomous execution, and coordinates state reconciliation after player scenes end.

### 2.6 LLM Roleplay Layer (New)
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
- New job types, needs, behaviors, and locations should be addable without recompiling code.
- Behavior Trees must be serializable and loadable at runtime.
- Goal scoring considerations should be definable in data.
- LLM roleplay context snapshots and reconciliation deltas must also be defined through data contracts (Blackboard schema).

### 3.3 Navigation as Containers + Entrances
- Buildings are treated as containers.
- Movement between city and building interiors happens through defined entrances.
- Navigation is staged (e.g., "Exit Apartment" → "Exit Building" → "Travel to Destination" → "Enter Building" → "Reach Target").

### 3.4 Visual Behavior Tree Editor
- The editor is a first-class part of the system from the beginning.
- Trees are stored in a format that both the editor and the runtime can use.
- The editor should support debugging (stepping, breakpoints, blackboard inspection).
- Trees must support clean pause/resume semantics for LLM hand-off.

### 3.5 Interaction Hand-off and State Reconciliation Protocol (New)
- Clear, explicit protocol required for transitioning an NPC between autonomous control and LLM roleplay.
- On interaction start: Autonomous systems provide a consistent snapshot; BT execution for involved NPC(s) is paused.
- During interaction: LLM operates on the snapshot; non-involved NPCs continue normal simulation.
- On interaction end: LLM returns structured deltas → autonomous layer validates and applies deltas to Blackboard → resumes BT execution from the new state.
- This protocol must preserve simulation invariants and prevent desynchronization between player-facing scenes and background world state.

## 4. Major Challenges & Risks

- **Runtime Extensibility**: Adding new definitions while the simulation is running is complex and risky. Requires strong validation and safe update mechanisms.
- **Visual Editor Complexity**: Building a good visual Behavior Tree editor is a significant undertaking. Scope must be carefully managed in early phases.
- **Data Model Evolution**: As the system grows, the data schemas will need to evolve. This must be planned for.
- **Performance vs Flexibility**: Highly dynamic systems can have performance costs. We must monitor this as complexity increases.
- **State Synchronization Between Layers (New)**: The hand-off between autonomous simulation and LLM roleplay introduces risk of desync or invariant violation if reconciliation is not strictly validated. The Blackboard and reconciliation protocol must enforce clear boundaries so the LLM cannot corrupt core simulation rules.

## 5. Guiding Questions for Future Decisions

When making architectural decisions, we should regularly ask:
- Does this keep the system data-driven and extensible at runtime?
- Can this be created or modified via MCP/LLM without code changes?
- Does this support visual editing where appropriate?
- Is the separation between Goal Selection and Execution clear?
- Will this scale toward long-term autonomous NPC behavior?
- Does this maintain clear separation of concerns so the LLM Roleplay Layer consumes state via defined snapshots and returns validated deltas without bypassing or corrupting the autonomous simulation invariants?

## 6. Current Assumptions

- 2D top-down world
- Tick-based simulation on the backend
- Bun + TypeScript
- Server-authoritative (frontend is a thin client)
- Behavior Trees will be the primary execution mechanism for goals under autonomous control
- Utility-based scoring (or similar) for goal selection under autonomous control
- LLM roleplay is used exclusively for player-facing interactions with specific NPCs. It receives state via defined Blackboard snapshots and event history. It is external to the core tick loop. Only involved NPCs have their autonomous execution paused during a player scene; all other NPCs continue uninterrupted. State changes from LLM scenes are reconciled through the Blackboard protocol rather than applied directly by the LLM.
