# Project Instructions

## Project Name
**Simulity**

## Project Location
https://github.com/Hexmare/Simulity

## Paramount rule
This is a roleplay simulation system. This contains only adult characters. Never under any circumstances even in testing generate child or minor characters.
All NPC's even in testing will be adults (18+)

## Spec index (required, keep current)

**`docs/spec_index.md` is the only status source.** One row per spec file. Statuses: `not started` | `in progress` | `completed` | `blocked`.

- Read `docs/spec_index.md` first. Do not scan `docs/*.md` to reconstruct status.
- Open a spec only when implementing or changing that spec.
- Same change that adds / finishes / blocks a spec **must** update the index. Blocked notes name the blocker.
- New work gets a new spec file + a new index row. Do not grow Architecture Foundations into a dump.

## Core Vision
Data-driven 2D sim. NPCs live autonomous lives (utility goals + behavior trees). Player is a PC in the ward. LLM roleplay is server-side, Director + Character agents, only for scene participants. Client is a view. Server is source of truth.

## Non-negotiable
- Data-driven first. Catalog UUID rows vs engine verbs — do not mix.
- Runtime overlay for content; catalog **authoring** MCP is not specified yet.
- Visual BT editor is first-class.
- Hybrid: utility selects, trees execute, LLM only during player scenes, validated deltas/tools only.
- Server owns World, tick, nav, roleplay, persist. Client sends intents, paints deltas. Zero sim logic in `src/components/**`.
- Staged nav: city → building → interior.
- Adults 18+ only.

## Current layout (as of main)

**Play chrome** (`src/components/game/SimulityApp.tsx`): resizable You | canvas | Ledger. Conversation slides up from the bottom. Sizes in `localStorage` only.

| Surface | Job |
|---|---|
| Start screen | list / create / load / import towns |
| You | PC name, narrative, job, home, eat affinity |
| Canvas | 2D ward + interiors; paints server poses |
| Ledger | Person / Building / Town / Chronicle / Tree; PeoplePicker |
| Conversation | group scene, Add (Here) / Call (not Here), Speak |
| Settings | connection profiles + Director/Character bindings |
| `/debug` | LLM traces |

**Server:** one live `Session` (`src/lib/server/session.ts`). Tick, intents, LangGraph orchestrator. WebSocket `/ws`. MCP HTTP `/mcp` (`list_souls`, `list_places`, `move_soul`, `call_soul`, `assign_task`). PGLite persist.

**Client:** `SessionClient` hydrates a view World from snapshot + deltas. No `World.step`.

**Content:** `content/catalog`, `content/trees`, `content/kits`. Shipped kit: Fenwick Ward.

**Time:** 1 tick = 1 sim minute. 1× = 1 real second/tick. Speeds 1 / 3 / 8.

## Non-goals (still)
- High-fidelity / 3D
- Catalog authoring MCP (no spec yet)
- Summon (no spec yet)
- Client-side prediction (no spec yet)
- Per-NPC agent bindings
- LLM writing World directly

## How to work
- Spec first. Index row first. Then code.
- Constraints, non-goals, acceptance in the spec.
- `npm test` and `npm run typecheck` green.
- Be direct. Do not restate every spec in chat — point at the index, then the one file.
