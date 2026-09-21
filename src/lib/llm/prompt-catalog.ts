// Shipped prompt books (docs/Prompt_Templates_and_Agents.md).
// Static JSON imports — same pattern as src/sim/defs.ts. No glob at runtime.

import director from "../../../content/prompts/director.json" with { type: "json" };
import character from "../../../content/prompts/character.json" with { type: "json" };
import narrator from "../../../content/prompts/narrator.json" with { type: "json" };
import summarizer from "../../../content/prompts/summarizer.json" with { type: "json" };
import worldState from "../../../content/prompts/world_state.json" with { type: "json" };
import creator from "../../../content/prompts/creator.json" with { type: "json" };
import editor from "../../../content/prompts/editor.json" with { type: "json" };
import memory from "../../../content/prompts/memory.json" with { type: "json" };
import visual from "../../../content/prompts/visual.json" with { type: "json" };
import help from "../../../content/prompts/help.json" with { type: "json" };
import tts from "../../../content/prompts/tts.json" with { type: "json" };

export const AGENT_IDS = [
  "director",
  "character",
  "narrator",
  "summarizer",
  "world_state",
  "creator",
  "editor",
  "memory",
  "visual",
  "help",
  "tts",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export type AgentStatus = "active" | "registered";

export interface PromptBook {
  system: string;
  character: string;
  snapshot: string;
  deltaSchema: string;
}

export interface NamedTemplate {
  id: string;
  label: string;
  description: string;
  book: PromptBook;
}

export interface AgentPromptDef {
  id: AgentId;
  label: string;
  description: string;
  status: AgentStatus;
  placeholders: string[];
  book: PromptBook;
  templates?: Record<string, NamedTemplate>;
}

const rows: AgentPromptDef[] = [
  director,
  character,
  narrator,
  summarizer,
  worldState,
  creator,
  editor,
  memory,
  visual,
  help,
  tts,
].map((row) => row as unknown as AgentPromptDef);

const byId = Object.fromEntries(rows.map((r) => [r.id, r])) as Record<AgentId, AgentPromptDef>;

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

export function shippedAgents(): AgentPromptDef[] {
  return AGENT_IDS.map((id) => byId[id]);
}

export function shippedDef(id: AgentId): AgentPromptDef {
  return byId[id];
}

export function shippedBook(id: AgentId): PromptBook {
  const book = byId[id].book;
  return { system: book.system, character: book.character, snapshot: book.snapshot, deltaSchema: book.deltaSchema };
}

/** Named template, or the agent's default book when templateId is omitted / "default". */
export function getPromptTemplate(agentId: AgentId, templateId?: string): PromptBook {
  if (!templateId || templateId === "default") return shippedBook(agentId);
  const named = byId[agentId].templates?.[templateId];
  if (!named) return shippedBook(agentId);
  const book = named.book;
  return { system: book.system, character: book.character, snapshot: book.snapshot, deltaSchema: book.deltaSchema };
}
