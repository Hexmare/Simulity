# Prompt Templates and Agent Registry

**Status:** [spec_index.md](spec_index.md).  
**Depends on:** [Architecture Foundations](Architecture_Foundations.md) §2.6 / §3.2, [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md), [Connection Profiles and Agents](Connection_Profiles_and_Agents.md), [Strict JSON Roleplay](Strict_Json_Roleplay.md), [Scene Time, Prompts, Appearance, and Kits](Scene_Time_Prompts_Appearance_and_Kits.md)  
**Saves:** Shipped books live in `content/prompts/`. Operator edits of a binding's book persist on the server LLM bundle (same as today). Extra named templates are shipped-only this pass.  
**Non-negotiable:** Adults 18+ only. No Grok/xAI branding. No illegal-activity systems. Server is the source of truth. LLM never writes World directly. Prompts are data, not TypeScript string literals. Agent overrides stay per **agent type**, never per NPC.

---

## 1. Why this is its own spec

Shipped Director and Character books lived in `src/lib/llm/prompts.ts`. That violates **data-driven first**. Editing a prompt required a code change. Adding a third agent meant forking the TypeScript union and pasting more string literals.

Talemate's agent prompts are outstanding because they are **data**: named templates per agent, shared fragments, a hard role split (director is not in the scene; conversation only acts as one character), recency of acting notes, and explicit output contracts. We take those **techniques**, not their text, and store Simulity's books as JSON next to the catalog.

This spec:

1. Moves every shipped prompt book out of `src/` into `content/prompts/`.
2. Reworks Director and Character books (same JSON contracts, stronger acting rules).
3. Registers the rest of the agent types Talemate proved useful, each with a shipped book (and extra named templates where the job has more than one task).
4. Does **not** wire new LangGraph nodes this pass. The round protocol stays Director → Character → (optional Director-2) → Character. New agents are **registered**: bindings, books, Settings, `getPromptTemplate`. Nodes come in a later spec.

---

## 2. What we took from Talemate (techniques, not copies)

Talemate ([vegu-ai/talemate](https://github.com/vegu-ai/talemate)) stores Jinja2 templates under `src/talemate/prompts/templates/{agent}/` and one agent class per role. We do **not** import Jinja, Focal, or their XML extractors. We keep Simulity's `{{placeholder}}` compiler and JSON-object replies.

Borrowed **ideas**:

| Technique | How Simulity uses it |
|---|---|
| Role split | Director never speaks. Character **ONLY ACTS AS** `{{name}}`. Narrator never writes dialogue. |
| Acting notes vs script | Director `guidance` is WHAT to convey, not exact lines. Character writes their own speech. |
| Recency | Acting notes and the output contract sit in `system` + trailing `deltaSchema` so they stay near the model's end of context. |
| Natural speech | Character / Editor: contractions, informal register, no purple prose, no clinical self-report. |
| Concrete look | Narrator look: observable detail, no time progress, no metaphor-as-content. |
| Examine, don't theme | World State: facts a click would reveal, not symbolism. |
| Unslop | Editor rewrites robotic / overwrought beats in place. |
| Compress history | Summarizer turns a thread slice into chronicle / memory text. |
| Content as data | Books are JSON. Runtime loads them the same way it loads needs and jobs. |

Not borrowed: Talemate's decensor boilerplate, XML `<GUIDANCE>` extractors, prepared-response prefills, image generation, TTS synthesis, or any Talemate-specific UI links.

---

## 3. On-disk shape

```
content/prompts/
  director.json
  character.json
  narrator.json
  summarizer.json
  world_state.json
  creator.json
  editor.json
  memory.json
  visual.json
  help.json
  tts.json
```

One file per agent type. Loader: `src/lib/llm/prompt-catalog.ts` — static JSON imports, same pattern as `src/sim/defs.ts`. No glob at runtime. Adding an agent is: new JSON file + one import + one `AGENT_IDS` row.

### 3.1 File schema

```
AgentPromptFile
  id             AgentId          // filename stem; must match
  label          string           // Settings tab label
  description    string           // one-line role, shown under the picker
  status         "active" | "registered"
  placeholders   string[]         // documented {{keys}} this book expects
  book           PromptBook       // default book used by the binding
  templates?     { [id]: NamedTemplate }
```

```
PromptBook
  system         string   // identity + standing rules
  character      string   // packed cards / who (not always a soul)
  snapshot       string   // live / volatile block
  deltaSchema    string   // output contract; compileBook appends this to system
```

```
NamedTemplate
  id             string
  label          string
  description    string
  book           PromptBook
```

`status: "active"` = the LangGraph round already calls this agent (Director, Character).  
`status: "registered"` = shipped + bound + editable; **no node this pass**. Completions must not be invented by the client.

Placeholders stay `{{word}}`. Compiler is `compileTemplate` / `compileBook` in `src/lib/llm/prompts.ts`. Unknown keys become `""`. Extra string keys on the compile context are passed through (appearance, wearing, secrets, instruction, focus, query, text, timePassed, …).

### 3.2 Why JSON, not Jinja

- Operators already edit the four book fields in Settings. JSON is the same four strings.
- Catalog, trees, and kits are JSON. Prompts belong in that family.
- Jinja includes and token-budget gymnastics are a later compiler if we need them. Not this pass.
- MCP / runtime addition of a book is a JSON write, not a template engine.

---

## 4. Agent registry

Pinned **agent type ids** (engine tokens, not catalog UUIDs — the orchestrator keys on them):

| id | Label | Status | Job |
|---|---|---|---|
| `director` | Director | active | Router. Who acts, add/remove. Never speaks. Extra templates: `guide`, `choices`. |
| `character` | Character | active | In-character beat for whichever soul the Director named. |
| `narrator` | Narrator | registered | Look / time / entry / exit / progress / sensory / query. No soul dialogue. |
| `summarizer` | Summarizer | registered | Thread slice → chronicle summary or factual list. Extra: `facts`, `tags`. |
| `world_state` | World State | registered | Examine snapshot of people / items / places as a **delta**. Sim validates. Extra: `development`, `reinforcements`. |
| `creator` | Creator | registered | Character / content sheets for kit and MCP authoring. Adults 18+ only. Extra: `description`, `attributes`, `voice`, `goals`. |
| `editor` | Editor | registered | Unslop / rewrite a beat. Same JSON shape in and out. Extra: `unslop`, `rewrite`. |
| `memory` | Memory | registered | Extract memory lines; formulate retrieval queries against `bb.memory`. Extra: `query`, `extract`. |
| `visual` | Visual | registered | **Text** image-prompt for a later portrait/scene pipeline. Does not generate pixels. Extra: `portrait`, `scene`. |
| `help` | Help | registered | Operator assistant for Simulity itself (settings, MCP, layout). Not in-scene. |
| `tts` | Voice markup | registered | Tag speech for a later TTS pipeline. Does not synthesize audio. |

Closed list this pass. A new type is: JSON file + `AGENT_IDS` row + (later) a LangGraph node. No per-NPC bindings. No Summon agent until Occupancy says so.

**Cut from Talemate and not registered:** Focal (we already use JSON fields as tools), third-party custom agent slots, Talemate Help deep-links.

### 4.1 Binding lift

`defaultBundle()` creates one `AgentBinding` per `AGENT_IDS` row: profile `"default"`, empty overrides, prompts = shipped `book`.

`asBundle` on a saved blob:

- Still requires `profiles[]`, `agents.director`, `agents.character` or it is not a bundle.
- Any **missing** registered agent is filled from the shipped file.
- Partial `prompts` on a binding merge over the shipped book (same as today's character lift).

Changing a shipped JSON file does **not** rewrite an already-saved binding. Settings **Reset to shipped defaults** copies the current shipped book onto that binding. In-flight rounds keep the book they compiled with.

### 4.2 Extra templates

`getPromptTemplate(agentId, templateId)` returns that named book, or the default `book` if `templateId` is omitted / `"default"`. Bindings do not store extra templates this pass. When a future node needs `narrator/time`, it loads the shipped template (or a later overlay). Settings still edits only the default four fields.

---

## 5. Reworked Director and Character books

Contracts **do not change**. Parser, tools, occupancy, and Strict JSON Roleplay stay.

### 5.1 Character (was `DEFAULT_BOOK`)

Add / strengthen:

- **ONLY ACT AS `{{name}}`.** Other lines are context. Never continue as them. Never write another soul's dialogue, thoughts, or reactions as if you control them.
- Tense and perspective match the thread. Do not switch `{{name}}` to first person just because it is their turn.
- One beat, one utterance. Informal, contracted, spontaneous speech unless Voice says otherwise. No purple prose. No clinical self-report. Do not always end on a question.
- Spoken words live **only** in `"speech"`. Physical business lives in `"action"`. No `*asterisk*` stage directions in speech. No `"Name:"` prefix.
- Presence `{{presence}}`: called = not in the room (can still speak; no handing objects, no walking the floor).
- Director `{{guidance}}` is private acting notes: obey the WHAT, write your own lines.
- Self pack includes `{{appearance}}`, `{{wearing}}`, `{{secrets}}` (filled from `snapshotNpc` on the Character call). Other souls never receive secrets or concealed ancestry (`compactCard` still owns that).
- Adults 18+ only. Do not invent minors.
- Output: one JSON object. Deltas are changes. `move` / `call` / `task` / `clothing` as today. Location deltas ignored.

### 5.2 Director (was `DIRECTOR_BOOK`)

Add / strengthen:

- You are **not** in the scene. You never speak. You never emit deltas.
- Usually one or two souls, not the whole table. Prefer who the player addressed. Empty `acts` is silence (legal).
- Called souls may answer if addressed; do not pick them to walk the floor.
- Pass 2: only not-yet-acted ids.
- `guidance`: WHAT to convey, plus any manner or memory the Character writer needs this beat. One sentence, notepad-terse. No scripted dialogue.
- `add` / `remove` as Occupancy. No Summon, End, move, or assign-task.
- Output: one JSON object `{ acts, add, remove }`.

---

## 6. Registered-agent contracts (for when nodes land)

Every registered book still uses the four-field PromptBook and JSON-object replies. Shapes:

| Agent | Primary JSON out |
|---|---|
| narrator | `{ "prose": "…", "kind": "look"\|"time"\|"entry"\|"exit"\|"progress" }` |
| summarizer | `{ "summary": "…", "kind": "narrative"\|"facts" }` |
| world_state | `{ "characters": {}, "items": {}, "places": {}, "location": "…" }` — merge delta; `null` drops |
| creator | `{ "name", "age", "appearance", "narrative": {public, private, voice}, "secrets", "job", "…" }` age ≥ 18 |
| editor | same Character beat shape it was given, rewritten |
| memory | `{ "queries": ["…"], "extract": [{ "who", "fact" }] }` |
| visual | `{ "prompt": "…", "kind": "portrait"\|"scene" }` text only |
| help | `{ "reply": "markdown", "hints": ["…"] }` |
| tts | `{ "markup": "…tagged speech…" }` |

The autonomous layer **validates** these the same way it validates Character deltas. A registered agent that is not yet in the graph is never called. Do not stub fake completions.

Visual and TTS are **prompt systems** for later pipelines. This pass does not generate images, video, or audio.

---

## 7. Runtime / UI

- `src/lib/llm/prompts.ts` is the **compiler** (`PromptBook`, `compileTemplate`, `compileBook`). It re-exports `DEFAULT_BOOK` / `DIRECTOR_BOOK` as aliases of the shipped Character / Director books so existing imports keep working.
- `src/lib/llm/prompt-catalog.ts` is the **registry**. `AGENT_IDS` is the closed list.
- `AgentId` in `bundle.ts` is that same union. `defaultBundle` / `maskBundle` / `asBundle` iterate `AGENT_IDS`.
- Settings **Agents** tab: picker for every registered type, profile, overrides, four book fields, reset. Scroll or select — eleven tabs must not overflow the pane on a 390px viewport (select is the control).
- Packer / orchestrator still only **complete** Director and Character. Character `compileBook` now fills `{{appearance}}` / `{{wearing}}` / `{{secrets}}` from the self snapshot. No new provider calls.
- MCP may later `list_prompt_books` / `get_prompt_book`; not this pass.

---

## 8. Non-goals

- LangGraph nodes for registered agents.
- Jinja2 / includes / token-budget placement.
- Per-NPC books.
- Generating portraits, scene images, video, or speech audio.
- Copying Talemate template text or AGPL source into this tree.
- Catalog authoring MCP, Summon, client prediction.

---

## 9. Acceptance

1. `content/prompts/*.json` exists for every `AGENT_IDS` row. No Director/Character book text remains as a string literal in `src/lib/llm/prompts.ts`.
2. `compileBook(shippedBook("character"), …)` and `compileBook(shippedBook("director"), …)` still produce `system` / `character` / `live`. Character system contains `ONLY ACT AS`. Director system contains that it never speaks.
3. `defaultBundle().agents` has every `AGENT_IDS` key. `asBundle` of an old two-agent save fills the rest from shipped files.
4. Settings Agents picker lists every agent. Reset copies the shipped book. Changing a registered agent's book does not affect an in-flight Director/Character round.
5. `getPromptTemplate("narrator", "time")` returns the time-passage book. `getPromptTemplate("director")` returns the default Director book.
6. Orchestrator still only completes Director and Character. No new provider calls.
7. `npm test` / `npm run typecheck` green. Prompt catalog tests: every file parses, four fields non-empty, ids match filenames, placeholders listed are used, Character deltaSchema still shows the `speech` / `deltas` contract (including `social` / `chat` as example keys).

---

## 10. Decisions (locked)

**T1. Prompts are JSON under `content/prompts/`.** Not TypeScript. Not Jinja.  
**T2. Four-field PromptBook stays.** `system` + `character` + `snapshot` + `deltaSchema`. Extra work is named templates on the same shape.  
**T3. Registry now, nodes later.** Eleven agent types ship as data. The round graph does not grow this pass.  
**T4. Original books, Talemate techniques.** No vendored Talemate text.  
**T5. Visual and TTS are text contracts.** They do not generate media this pass.
