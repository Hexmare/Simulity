# Spec index

**This file is the only status source.** Do not scan other docs to learn what is done. Open a spec only when you are implementing or changing that spec.

Statuses: `not started` | `in progress` | `completed` | `blocked`.

If you add, finish, block, or reopen a spec: **update this table in the same change.**

| # | Spec | Status | Notes |
|---|---|---|---|
| 1 | [Architecture_Foundations.md](Architecture_Foundations.md) | completed | Living charter. Do not dump new work here — add a child spec and a row. |
| 2 | [Urban_Fantasy_Default_World.md](Urban_Fantasy_Default_World.md) | completed | Fenwick kit. Existing towns keep baked interiors (Occupancy Q9). |
| 3 | [Data_Driven_Catalog.md](Data_Driven_Catalog.md) | completed | UUID catalog + overlay. Catalog **authoring** MCP is not this file — no spec yet. |
| 4 | [Simulation_Time_and_Routines.md](Simulation_Time_and_Routines.md) | completed | 1 tick = 1 sim minute. |
| 5 | [Play_Layout_and_Conversation.md](Play_Layout_and_Conversation.md) | completed | You / canvas / Ledger / bottom Conversation. |
| 6 | [Roleplay_Agent_Runtime.md](Roleplay_Agent_Runtime.md) | completed | Director + Character, max 2 passes. Witness/retry/add-remove landed in Occupancy. |
| 7 | [Connection_Profiles_and_Agents.md](Connection_Profiles_and_Agents.md) | completed | Default profile + per-agent-type overrides. `timeoutMs` / `maxRetries` on the profile. |
| 8 | [Server_Authority_and_Transport.md](Server_Authority_and_Transport.md) | completed | One live town, N browsers. Client is a view. |
| 9 | [Occupancy_Conversation_Ledger_and_MCP.md](Occupancy_Conversation_Ledger_and_MCP.md) | completed | Furniture, eat affinity, retry, MCP `/mcp`, memory, tasks. Q1–Q10 locked. |
| 10 | [Scene_Time_Prompts_Appearance_and_Kits.md](Scene_Time_Prompts_Appearance_and_Kits.md) | not started | Draft. Q1–Q7 locked (incl. scale homes + PC home). |
| 11 | [Catalog_Editors_and_Business_Types.md](Catalog_Editors_and_Business_Types.md) | not started | Draft. Full catalog UI + business types. Q1–Q4 open. |

No blocked rows.

Follow-ons with **no spec file yet** (do not invent them in code): catalog authoring MCP, Summon, client-side prediction.
