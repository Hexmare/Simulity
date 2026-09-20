# Simulation Time and Daily Routines

**Status:** [spec_index.md](spec_index.md). Landed; `src/sim/time.test.ts`.  
**Depends on:** Architecture Foundations, Data-Driven Catalog  
**Saves:** Time constants change. Existing towns remain loadable; in-progress `waitTicks` / `goalLock` values will complete faster in sim-time (acceptable). No migration.  
**Non-negotiable:** Adults 18+ only. No Grok/xAI branding. No illegal-activity systems.

---

## 1. Problem

Observed on `main` at 1×:

1. The clock advances **5 sim minutes per tick**. 1× is unwatchable: a sim hour is ~3 real seconds, a sim day ~72 real seconds.
2. NPCs wake, go to eat, and **finish the meal at night**. They never fit wash → eat → work → eat → work → eat → recreation → sleep into one day.

Both are the same class of bug: **sim time, travel time, and action duration are not calibrated to a human day.**

---

## 2. Diagnosis (current `main`)

Constants in `src/sim/types.ts`:

```
TICKS_PER_HOUR = 12
MINUTES_PER_TICK = 5
TICKS_PER_DAY = 288
```

The canvas loop (`SimCanvas.tsx`) fires `world.step()` every **0.25 real seconds** at 1×. Combined:

| Quantity | Current 1× |
|---|---|
| Sim minutes per real second | 20 |
| Sim hour | 3 real seconds |
| Sim day | 72 real seconds |
| Clock display | jumps 00, 05, 10, 15… |

### 2.1 Travel is the day-eater

NPC path following lives in `world.animate(dt)` (real-time, `NPC_WALK = 1.65` tiles/sec). Goal/BT logic lives in `world.step()` (5 sim min/tick). Arrival is **not** a function of sim time.

A ~20-tile diner trip:

- Real time ≈ 12 s at 1×
- Sim time ≈ 12 / 0.25 × 5 min ≈ **4 hours**

The eat tree (`content/trees/eat.json`) is: eat carried food if any, else walk to the diner, buy, eat. Most souls spawn with `food: 0` or `1`. The player watches “eating” which is actually a cross-town walk whose sim duration is hours. By arrival, `timeBand` 21–06 has fired and sleep wins.

### 2.2 Action pulses were authored in ticks, not minutes

Engine verbs apply burst restores and `waitTicks` as small integers. Those integers meant “a couple of 5-minute ticks.” They are **not** hour-normalized (unlike `decayPerHour`).

| Action | Current pulse | Sim duration now | Effect |
|---|---|---|---|
| `eat` | 1 tick, +42 hunger | 5 min | Instant meal after a 4-hour walk |
| `sleep` | +14 energy, `waitTicks` 1–2, loop until 88 | ~15 min to fill a night | Night is a nap |
| `work` | `waitTicks` 3, then **success** (wage + produce) | 20 min/cycle | Economy is per-tick, not per-hour |
| `wash` | 1 tick, +38 hygiene | 5 min | OK-ish, too short |
| `wait` (relax) | params `ticks` 5–6 | 25–30 min | Accidental, not designed |
| `wait` (worship) | params `ticks` 8 | 40 min | Accidental |
| `goalLock` | 10 ticks | 50 min | Hides flicker; also traps a bad goal |
| Ward cooldown | 48 ticks | 4 hours | Magic number |
| Social cooldown | 8 ticks | 40 min | Magic number |
| Partner promotion | `24 * 12` ticks | 1 day | Hardcoded day length |
| Work log throttle | 48 ticks | 4 hours | Magic number |

Need **decay** is already per-hour (`needs.json` `decayPerHour`) and will scale correctly when `TICKS_PER_HOUR` changes. Restore, wait, cooldown, wage, and travel will not.

### 2.3 Night-shift vs global sleep band

Sleep goal has `{ kind: "timeBand", startHour: 21, endHour: 6, weight: 0.45 }`. Work has `{ kind: "schedule", weight: 0.95 }`.

At 21:00, energy ~40:

- Sleep ≈ `inverse_quadratic(40) * 1.3 + 0.45` ≈ **0.92**
- Work ≈ `0.95 - 0.3 * inverse(energy)` ≈ **0.77**

Sleep beats the start of a night shift. Night bakers / diner leads / watch go to bed at clock-in. Day workers are fine at 07:00 if energy is high, which is why the visible failure mode is “wake → eat-walk → night.”

### 2.4 What is *not* the bug

- Utility AI as a layer. Keep it.
- `decayPerHour` itself (rates are in a plausible band; meals/sleep must match them).
- Job `startHour` / `endHour` on the catalog rows (those windows are already a human day).

---

## 3. Goals

1. **One tick = one sim minute.** Clock displays `HH:MM` advancing one minute at a time.
2. **1× is watchable.** One real second at 1× = one sim minute. A sim day is 24 real minutes at 1×; 3× / 8× remain for skipping.
3. **A day-shift adult can complete a human day in 24 sim hours:** wake, wash, breakfast, commute, work, lunch, work, dinner, recreation, sleep. Night-shift jobs invert that around their catalog hours.
4. **Travel, actions, cooldowns, and wages are in sim minutes / hours**, never in raw tick literals.
5. Durations stay **data-driven** (tree params + catalog). Engine verbs interpret minutes; they do not hardcode “3 ticks.”

## 4. Non-goals

- Persistence / save versioning.
- Visual fidelity, 3D, path-smoothing beyond tick-authoritative movement.
- Rebalancing every trait/ancestry modifier (they are multipliers; they ride the new rates).
- LLM roleplay timing (scenes are already outside the tick loop).
- Changing job hours, building layouts, or the Fenwick roster.
- Performance work for large populations (1440 ticks/day × current ward size is in budget).

---

## 5. Time model

### 5.1 Canonical constants (`src/sim/types.ts`)

```
MINUTES_PER_TICK = 1
TICKS_PER_HOUR   = 60
TICKS_PER_DAY    = 24 * TICKS_PER_HOUR   // 1440
```

`World.time()` already derives `hour` / `minute` / `hourFloat` from these. After the change, `minute` is `tick % 60`.

**Invariant:** no file outside `types.ts` may mention `12` or `288` as a day/hour length. Use `TICKS_PER_HOUR` / `TICKS_PER_DAY` / `MINUTES_PER_TICK`.

### 5.2 Wall-clock 1× (`REAL_SECONDS_PER_TICK`)

New named constant, used by the canvas accumulator (today’s literal `0.25`):

```
REAL_SECONDS_PER_TICK = 1
```

At 1×: 1 real second → 1 tick → 1 sim minute.  
At 3×: 3 sim minutes / real second. Day in 8 real minutes.  
At 8×: 8 sim minutes / real second. Day in 3 real minutes.

The speed buttons stay `[1, 3, 8]`. Do not add more in this work.

Catch-up guard in `SimCanvas` (`guard++ < 8`) must scale: at 8× and a long frame, 8 ticks is only 8 sim minutes. Raise the guard to **32** so a stutter cannot freeze the clock relative to movement. Cap remains a safety valve, not a design rate.

### 5.3 Tick vs presentation

| Clock | Authority |
|---|---|
| `World.tickIndex` / `World.time()` | Sim |
| Need decay, BT, utility, wages, cooldowns | `World.step()` |
| NPC path progress and arrival | `World.step()` (new) |
| Visual interpolation, player WASD | `World.animate` / `movePlayer` (real-time) |

`advanceAlongPath` for **autonomous** NPCs moves into `step()`, with distance = `walkSpeed(npc) * (MINUTES_PER_TICK / 1)` tiles. Because 1× couples 1 real second to 1 sim minute, `NPC_WALK = 1.65` tiles/sec is also **1.65 tiles per sim minute**.

A 20-tile diner trip ≈ **12 sim minutes**. A 40-tile cross-ward walk ≈ 24 sim minutes. That is a neighborhood, not a commute to another city.

`animate()` may lerp leftover sub-tile for smoothness. It must not be the thing that decides `moveTo` success. Tests that currently `step()` without `animate()` must still arrive.

Player locomotion stays real-time (WASD). Player is not on the autonomous clock.

---

## 6. Target day (acceptance shape)

Day-shift example: superintendent `startHour: 7`, `endHour: 18`. Energy/hunger start the morning in a normal post-sleep band (energy ≥ 85, hunger ~60–75).

| Window | Goal | Sim duration |
|---|---|---|
| 22:00–06:30 | Sleep | 8–9 h |
| 06:30–06:45 | Wash | 10–15 min |
| 06:45–07:15 | Eat | 20–30 min (home or diner) |
| 07:15–07:30 | Commute | 5–15 min |
| 07:30–12:00 | Work | until lunch interrupt |
| 12:00–12:40 | Eat | 20–40 min |
| 12:40–18:00 | Work | until shift end |
| 18:00–18:40 | Eat | 20–40 min |
| 18:40–21:30 | Relax / social / wander | remainder |
| 21:30–22:00 | Travel home | 5–15 min |
| 22:00–06:30 | Sleep | 8–9 h |

Night-shift (night baker 21–07, diner lead 18–04, night watch 20–06, stall broker 16–02, runner 18–03): sleep in the **off-shift** block, not on `timeBand` 21–06. Meals still interrupt work when hunger is low.

A single Eat goal, once selected, must **finish in under 60 sim minutes** including travel, except when pathfinding fails (then fail the tree, do not walk until dusk).

---

## 7. Need rates (keep decay, retune restore)

Decay stays in `content/catalog/needs.json` (per hour). Expected awake-16h drain:

| Need | decayPerHour | 16h drain | Critical |
|---|---|---|---|
| hunger | 4.2 | 67 | 22 |
| energy | 3.4 | 54 | 18 |
| social | 3.8 | 61 | 20 |
| fun | 2.6 | 42 | 18 |
| hygiene | 2.2 | 35 | 16 |
| comfort | 1.6 | 26 | 20 |
| status | 0.8 | 13 | 12 |
| thirst | 0 (vampires 5 via ancestry) | — | 22 |

Three meals of **~28–35 hunger** cover a waking day with a little leftover. Overnight decay (~8 h × 4.2 ≈ 34) is why they wake hungry. Keep that.

Sleep must restore **~8–10 energy per hour** so an 8-hour night takes energy from ~20–40 up to ~90–100. Naps (day, energy < 55) are allowed but must not outrank on-shift work.

---

## 8. Action contract (engine + data)

### 8.1 Minutes, not ticks, in tree params

Rename the wait param in trees from `ticks` to `durationMinutes`. Interpreter accepts `durationMinutes` only. One tick = one minute, so `waitTicks` on the blackboard is “minutes remaining.” Keep the field name `waitTicks` on `Blackboard` (it is already “ticks left”); do not bikeshed a save-shape rename.

Every duration action reads `params.durationMinutes` with an engine default from the table below. Trees **must** set the param explicitly so content is inspectable.

### 8.2 Shipped defaults

| Action | `durationMinutes` | Restore / cost | Success when |
|---|---|---|---|
| `eat` | 25 | hunger +32, comfort +4 (applied at start of the sit) | duration elapsed |
| `drink` | 5 | thirst +55 (bottled) / +25 (ration) | duration elapsed |
| `wash` | 12 | hygiene +40 | duration elapsed |
| `sleep` | *(open-ended)* | energy **+0.16 / minute** (~9.6/h), comfort +0.05/min | energy ≥ 90, **or** off-night and energy ≥ 72 |
| `work` | 30 | energy −0.8, fun −0.4 over the 30 min; one `doWork` production/wage at the end of each 30 min | duration elapsed (tree re-enters while `isWorkHours`) |
| `wait` | from params (relax 40, worship 25) | fun +0.4/min, comfort +0.15/min | duration elapsed |
| `wander` | 8 after arriving at a wander point | — | duration elapsed |
| `social` | 10 | existing social restore; cooldown **20** minutes | duration elapsed |
| `ward` | 8 | existing essence cost / comfort; cooldown **4 hours** (`4 * TICKS_PER_HOUR`) | duration elapsed |

Eat restore is **once per meal**, not per minute. If the tree is interrupted, the meal is still consumed (food already decremented) — same as today. Do not invent leftovers in this spec.

Sleep is a **rate**. It stays `running` until the success condition. Do not use a huge `durationMinutes` and hope. Dawn does not hard-eject a critically exhausted soul (energy < 30); they sleep in.

Work production once per 30 sim minutes keeps wages in the same order of magnitude as today’s 20-minute pulse (1–2 coin). Do not pay per tick.

### 8.3 Tree JSON changes (shipped)

`content/trees/*.json` — set `durationMinutes` on the duration actions. No new node types.

- `eat.json` — both `eat` nodes: `"params": { "durationMinutes": 25 }`.
- `hygiene.json` — `wash`: 12.
- `drink.json` — `drink`: 5.
- `work.json` — `work`: 30.
- `relax.json` — diner wait 40, plaza wait 40 (replace `ticks`).
- `worship.json` — wait 25 (replace `ticks`).
- `sleep.json` — no duration param; engine open-ended rate.
- `wander.json` — wander 8.
- `socialize.json` — social 10.
- `ward.json` — ward 8.

`wait` action: read `durationMinutes`, fall back to `4` if missing.

### 8.4 Goal data changes

`content/catalog/goals.json`, sleep row: add a negative on-shift term so night jobs actually go to work.

```
{ "kind": "schedule", "weight": -1.15 }
```

Keep the 21–06 `timeBand` at **0.35** (slightly down from 0.45) as a nudge for off-shift souls, not a veto of work.

Eat weight stays 1.25 inverse-quadratic. Work’s negative hunger/energy terms stay so lunch can interrupt a shift when hunger is actually low (~< 35), not when they just woke at 70.

`goalLock` on new goal: **8 minutes** (8 ticks). Long enough to finish a doorway transition, short enough to drop a completed eat.

Hysteresis (`bestS < curS * 1.18 + 0.04`) stays.

---

## 9. Hardcoded tick literals to replace

| Location | Today | Replace with |
|---|---|---|
| `src/sim/types.ts` `TICKS_PER_HOUR` | 12 | 60 |
| `src/sim/types.ts` `MINUTES_PER_TICK` | 5 | 1 |
| `SimCanvas.tsx` accumulator `step = 0.25` | 0.25 | `REAL_SECONDS_PER_TICK` (1) |
| `SimCanvas.tsx` catch-up `guard < 8` | 8 | 32 |
| `ai.ts` `goalLock = 10` | 10 | `GOAL_LOCK_MINUTES` (8) |
| `ai.ts` sleep `waitTicks` 1–2 | pulse hack | rate loop, no pulse |
| `ai.ts` work `waitTicks = 3` | 3 | `durationMinutes` (30) |
| `ai.ts` socialCooldown 8 / 4 | 8, 4 | 20, 10 |
| `ai.ts` ward cooldown 48 | 48 | `4 * TICKS_PER_HOUR` |
| `ai.ts` wander `waitTicks = 2` | 2 | `durationMinutes` (8) |
| `economy.ts` `shouldLog(..., every = 48)` | 48 | `4 * TICKS_PER_HOUR` |
| `kin.ts` partner delay `24 * 12` | 288 | `TICKS_PER_DAY` |

Search the repo for `\b12\b` / `\b48\b` / `\b288\b` next to time words before merging. Do not “fix” map sizes, palettes, or zoom.

---

## 10. Utility / routine rules (so the day actually happens)

1. **On-shift work beats sleep** unless energy < `criticalBelow` (18). The new sleep `schedule` weight of −1.15 is the mechanism. Add an acceptance assertion for a night baker at 21:30 with energy 45: winning goal is Work, not Sleep.
2. **Eat beats work** only when hunger is actually low. With current weights this is roughly hunger ≲ 32. Do not raise eat’s weight.
3. **One meal does not re-select eat.** +32 hunger from ~30 → ~62. inverse-quadratic at 62 is low. `goalLock` 8 min covers the sit. After success, work (if on shift) or relax wins.
4. **Sleep fills a night, not a coffee break.** 8 h × 0.16/min = 76.8 energy. A soul who went to bed at 25 wakes at 100 (clamped) around 06:30–07:00 if they started at 22:00.
5. **Wash once in the morning is enough.** +40 hygiene vs 2.2/h ≈ 18 h. Do not send them to the kiosk three times a day unless hygiene was dumped by a future system.
6. **Travel is 5–20 minutes**, not hours. If a `moveTo` path is longer than 45 sim minutes of walking, that is a nav bug — log and fail the action. Do not let them walk from dawn to dusk. *(Implemented in `ai.ts` as an accurate per-segment walking-distance estimate across city + interior spaces — a door/floor/stair hop counts as a short fixed cost, never a large coordinate jump — with a ~120 sim-minute threshold (`MAX_WALK_MINUTES`) so legitimate cross-town commutes (even for slow elders) pass while any multi-hour route is logged and failed.)*

---

## 11. Tests (required)

New file `src/sim/time.test.ts` (or extend `ai.test.ts` / `acceptance.test.ts`):

1. **Constants.** `MINUTES_PER_TICK === 1`, `TICKS_PER_HOUR === 60`, `TICKS_PER_DAY === 1440`. `time()` at `tickIndex = 8 * 60 + 7` is day 1, 08:07.
2. **Decay scale.** One hour of `step()` (60 ticks, no restore) drops hunger by ≈ 4.2 (±0.15).
3. **Meal window.** Place an NPC at the diner with `food >= 1`, force Eat, `step()` until the eat tree is not running: elapsed ticks ∈ [20, 40]. Hunger rose by ~32. World hour did not jump to night.
4. **Sleep night.** Energy 30 at 22:00, force Sleep at bed, run until energy ≥ 90: elapsed ticks ∈ [6 * 60, 10 * 60].
5. **Day-shift shape.** Superintendent (or any `startHour` 6–10 / `endHour` 16–20), seed energy 90 / hunger 65 / food 1 at 06:30 at home. Run 18 sim hours. Chronicle/goals must include Eat before 09:00, Work during 09:00–11:00, Eat again between 11:00–15:00 **or** 17:00–20:00, and Sleep after 21:00. Work must occupy ≥ 4 hours of the shift window.
6. **Night-shift shape.** Night baker, energy 50, 21:15: `selectGoal` returns Work. Running 2 hours must not select Sleep unless energy < 18.
7. **Travel bound.** `moveTo` across ~20 city tiles completes in < 25 ticks when `step()` is the mover (no `animate()`).
8. **No magic day length.** `kin.ts` partner promotion uses `TICKS_PER_DAY`. Grep test: `24 * 12` is absent.

Existing tests that loop `TICKS_PER_HOUR * 24` stay correct (they use the constant). Tests that assume 288 steps is “a few minutes” must be updated.

A full 1440-tick day on the default ward must stay well under a few seconds of CPU in unit tests (sanity, not a perf target).

---

## 12. Implementation order

1. Constants + `REAL_SECONDS_PER_TICK` + canvas accumulator + catch-up guard.
2. Move autonomous `advanceAlongPath` into `World.step()`. Confirm travel-bound test.
3. Replace tick literals (kin, economy, ward, social cooldown, goalLock).
4. Action duration/rate rewrite in `runAction` (`ai.ts`) per §8.2.
5. Tree JSON `durationMinutes` + sleep schedule weight.
6. Tests §11. Adjust restore numbers only if a test fails by a small margin; do not retune by eye in the canvas first.
7. Architecture Foundations §6 + this spec marked Implemented.

Do not ship (1) without (4)–(6). A 1-minute tick with the old +14-energy sleep pulse fills a night in ~20 minutes and the bug gets worse.

---

## 13. Acceptance

Done when:

- Clock at 1× advances one sim minute per real second.
- A day-shift NPC, watched or tested over 24 sim hours, eats three times or two plus leftover, works the bulk of their catalog shift, and sleeps 7–9 hours at night.
- A night-shift NPC clocks in at `startHour` instead of going to bed.
- Eat (including a diner walk) is done in under an hour of sim time.
- `npm test` / `src/sim/*.test.ts` pass, including the new time tests.
- No new Grok/xAI branding. No minor characters.

---

## 14. Open questions (do not block)

- Should 1× be even slower (2 real seconds per tick)? Not unless 1 s/min still feels rushed after the retune. Change `REAL_SECONDS_PER_TICK` only.
- Carried `food` stock vs always dining out: out of scope. Seeding `food: 1` more often would hide travel bugs; do not do that as a substitute for §5.3.
- Per-job sleep windows (sleep 08–16 for bakers) would be nicer than `offShift + night band`. Future catalog work; negative `schedule` weight is enough now.
