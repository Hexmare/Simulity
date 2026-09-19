# Connection Profiles and Agents

**Status:** Implemented. P1–P2 locked 2026-09-19.  
**Depends on:** [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md), Architecture Foundations §2.6  
**Saves:** Replaces the single `llm_settings` blob. Profiles and agent bindings persist on the server. Existing settings lift into one Default profile + two agent bindings (Director, Character).  
**Non-negotiable:** Adults 18+ only. No Grok/xAI branding. Keys never shipped to the client in full (mask in the UI). Agent overrides are **per agent type**, never per NPC.

---

## 1. What this is

Today, before this spec landed, there was one `LlmSettings` object: URL, key, model, temperature, token knobs, and the prompt book, all glued together. Every future completion used that one blob (`peekSettings()`).

That cannot express:

- a Default connection every agent starts from
- more than one connection (local OpenAI-compatible box vs a second host)
- Director wants 10k max output tokens while Character stays on the Default 4k
- a third agent next month, with its own book and knobs, without forking Settings again

Split the blob.

| Thing | Is | Is not |
|---|---|---|
| **Connection profile** | How we talk to a model: base URL, path, key, model name, temperature, token limits | A character, a prompt, an NPC |
| **Agent type** | A role in the runtime: Director, Character, later Summon / Memory / … | A specific villager |
| **Agent binding** | This agent type uses profile P, plus optional overrides of P's knobs, plus its prompt book | Per-NPC config |

**Overrides are global to the agent type.** The Character agent running for Ava and the Character agent running for Tom are the same agent. They share one profile selection and one override set. There is no “Ava uses GPT-4, Tom uses the local box.” If that is ever wanted, it is a different spec.

---

## 2. Connection profile

```
Profile
  id            uuid
  name          "Default" | user label
  isDefault     exactly one profile is default
  enabled       bool
  baseUrl       string
  path          "/v1/chat/completions"
  apiKey        string   (server-only; UI shows last-4)
  model         string
  temperature   number
  maxOutputTokens
  contextTokens
  maxHistoryTurns
  maxSnapshotChars
```

The shipped Default profile is today's `defaultSettings()` connection half (current box at `baseUrl`, model `testmodel`, etc.). Prompt fields do **not** live here.

Rules:

- At least one profile always exists. It is Default.
- Deleting Default is not allowed; you can rename it and edit it.
- Deleting a non-default profile retargets any agent still pointing at it to Default.
- `testConnection` runs against a profile id (resolved server-side, key never round-tripped for the test beyond what the server already holds).

UI (Settings, new **Profiles** tab): list, add, edit, mark default. Same fields as today's Connection tab, minus prompts.

---

## 3. Agent types and bindings

Shipped agent types (closed list in code this pass, data-shaped so a new type is one registry row + one LangGraph node later):

| id | Runs | Prompt book |
|---|---|---|
| `director` | Router. No thread speech. No deltas. | Director book |
| `character` | In-character beat for **whatever NPC the orchestrator named**. Same binding for every NPC. | Character book (today's `DEFAULT_BOOK`) |

Each has one **binding**:

```
AgentBinding
  agentId       "director" | "character" | …
  profileId     uuid | "default"   ("default" follows whichever profile isDefault)
  overrides     partial Profile knobs (only the connection/model fields)
  prompts       PromptBook for this agent type
```

Resolution at call time:

```
effective = {
  ...profiles[binding.profileId === "default" ? defaultId : binding.profileId],
  ...binding.overrides,          // only defined keys
  prompts: binding.prompts
}
```

Example: Default profile `maxOutputTokens = 4000`. Director binding `overrides.maxOutputTokens = 10000`. Character binding has no override. Director completions allow 10k; every Character completion (Ava, Tom, Mara) allows 4k.

Empty override object = pure profile. Selecting a different `profileId` and also overriding is legal (profile B, but temperature 0.2).

**Not in overrides:** `isDefault`, `name`, `id`. **Not per NPC:** anything.

UI (Settings, **Agents** tab): for each agent type, profile picker (Default / a named profile), override fields (blank = inherit), prompt editor (today's Prompts tab, split by agent).

---

## 4. Lift from current settings

On first boot after this lands:

1. Insert profile Default from current `llm_settings` connection fields.
2. Insert binding `character` → Default, prompts from current book, no overrides.
3. Insert binding `director` → Default, shipped Director book, no overrides (you add the 10k override in the UI when you want it).
4. Stop reading the old single-blob shape.

---

## 5. Future agents

The registry is how a new agent type appears:

1. Add a row (`summon`, `memory`, …).
2. Shipped default book + binding → Default profile.
3. Plug a LangGraph node into the orchestrator ([Roleplay Agent Runtime](Roleplay_Agent_Runtime.md) §6).

No NPC-level settings are introduced. If Summon ever runs “for” a soul, it still uses the Summon agent binding.

---

## 6. Decisions (locked 2026-09-19)

**P1. Prompt books on the binding, not the profile.** Locked. Prompts are the agent's job. Connection is the model's job.

**P2. `"default"` follows.** Locked. `profileId = "default"` always resolves to whichever profile currently has `isDefault`. Changing Default retargets every agent still on `"default"` without editing bindings. A binding that stored a concrete profile uuid does not move.

**P3. Per-town profiles?** Still no. Global, like today's settings. Towns do not carry keys. One live town (see [Server Authority](Server_Authority_and_Transport.md) §3) does not change that.
