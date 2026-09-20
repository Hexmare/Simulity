# People Slider Is Total Souls

**Status:** [spec_index.md](spec_index.md).
**Depends on:** [Scene Time / Kits](Scene_Time_Prompts_Appearance_and_Kits.md), [Catalog Editors and Business Types](Catalog_Editors_and_Business_Types.md)
**Non-negotiable:** Adults 18+ only. Client has zero sim logic.

## Decision

The Start screen **People** slider is the total NPC headcount (`world.npcs.length`).
Asking for 6 gives 6 souls, not 6 plus all shop staff. Shops may stand
unstaffed in tiny cities — that is fine.

- Default People for a kit = roster sum + authored staff across the kit's
  typed buildings (Shadows Veil ≈ 58, not 28).
- Labels say `People (N souls)`. No "souls + staff".
- Generation scales **both** staff slots and roster rows to hit the requested
  total (proportional mix, largest-remainder per row, exact total).
- Home-kind building counts scale with the same ratio. Typed work/gather
  building counts stay as authored; only how many staff slots get filled
  scales. The Player's rooms stays exactly one.

## Acceptance

- `new World(seed, undefined, { population: 6 }).npcs.length === 6`.
- Default `new World(seed)` NPC count equals roster + staff.
- `npm test` and `npm run typecheck` green.
