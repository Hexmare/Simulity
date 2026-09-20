# Strict JSON Roleplay + Larger Context Windows

**Status:** [spec_index.md](spec_index.md).
**Depends on:** [Roleplay Agent Runtime](Roleplay_Agent_Runtime.md), [Connection Profiles and Agents](Connection_Profiles_and_Agents.md)
**Non-negotiable:** Adults 18+ only. Server is the source of truth. LLM never writes the sim directly.

## Decisions

1. Context window choices: 4k, 8k, 16k, 32k, **64k, 128k, 256k**.
   Existing saved values keep working.
2. Character + Director completions request **JSON object mode**
   (`response_format: { type: "json_object" }`) on OpenAI-compatible
   endpoints. Providers that reject the field fall back to a plain retry
   without it (one retry, then the normal parse path).
3. Shipped prompt books say, verbatim-adjacent: reply with ONLY a single
   JSON object; no prose, no `Name:` prefix, no markdown, no fences.
   Dialogue lives ONLY in the `speech` string. A `speech` that looks like
   JSON or carries a `Name:` prefix is a parse failure, never a beat.
4. The parser rejects prose replies (like `Sybil Hawke: Now, you don't…`)
   as `parseError` — they never reach the thread as dialogue.

## Acceptance

- Settings shows 64k / 128k / 256k options.
- A prose `Name: dialogue…` reply parses as `parseError: true` with empty speech.
- `npm test` and `npm run typecheck` green.
