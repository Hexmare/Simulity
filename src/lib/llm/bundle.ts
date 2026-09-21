import { DEFAULT_BOOK, type PromptBook } from "./prompts.ts";
import { AGENT_IDS, shippedBook, type AgentId } from "./prompt-catalog.ts";
import { defaultSettings, withDefaults, type LlmSettings } from "./settings.ts";

export type { AgentId } from "./prompt-catalog.ts";
export { AGENT_IDS } from "./prompt-catalog.ts";

export interface ConnectionProfile {
  id: string;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  baseUrl: string;
  path: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  contextTokens: number;
  maxHistoryTurns: number;
  maxSnapshotChars: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface AgentBinding {
  agentId: AgentId;
  profileId: string | "default";
  overrides: Partial<
    Pick<
      ConnectionProfile,
      | "baseUrl"
      | "path"
      | "apiKey"
      | "model"
      | "temperature"
      | "maxOutputTokens"
      | "contextTokens"
      | "maxHistoryTurns"
      | "maxSnapshotChars"
      | "timeoutMs"
      | "maxRetries"
      | "enabled"
    >
  >;
  prompts: PromptBook;
}

export interface LlmBundle {
  profiles: ConnectionProfile[];
  agents: Record<AgentId, AgentBinding>;
}

function profileFromSettings(s: LlmSettings, id = crypto.randomUUID()): ConnectionProfile {
  return {
    id,
    name: "Default",
    isDefault: true,
    enabled: s.enabled,
    baseUrl: s.baseUrl,
    path: s.path,
    apiKey: s.apiKey,
    model: s.model,
    temperature: s.temperature,
    maxOutputTokens: s.maxOutputTokens,
    contextTokens: s.contextTokens,
    maxHistoryTurns: s.maxHistoryTurns,
    maxSnapshotChars: s.maxSnapshotChars,
    timeoutMs: 45000,
    maxRetries: 2,
  };
}

function bindingFor(id: AgentId): AgentBinding {
  return { agentId: id, profileId: "default", overrides: {}, prompts: { ...shippedBook(id) } };
}

export function defaultBundle(): LlmBundle {
  const p = profileFromSettings(defaultSettings());
  const agents = {} as Record<AgentId, AgentBinding>;
  for (const id of AGENT_IDS) agents[id] = bindingFor(id);
  return { profiles: [p], agents };
}

export function liftSettings(s: LlmSettings): LlmBundle {
  const p = profileFromSettings(withDefaults(s));
  const b = defaultBundle();
  b.profiles = [p];
  b.agents.character.prompts = { ...DEFAULT_BOOK, ...s.prompts };
  return b;
}

export function resolveEffective(bundle: LlmBundle, agentId: AgentId): ConnectionProfile & { prompts: PromptBook } {
  const binding = bundle.agents[agentId];
  const def = bundle.profiles.find((p) => p.isDefault) ?? bundle.profiles[0];
  const base =
    binding.profileId === "default" ? def : (bundle.profiles.find((p) => p.id === binding.profileId) ?? def);
  if (!base) throw new Error("No connection profile.");
  const merged: ConnectionProfile = { ...base, ...binding.overrides, isDefault: base.isDefault, id: base.id, name: base.name };
  return { ...merged, prompts: binding.prompts };
}

function maskKey(value: string | undefined): string | undefined {
  if (!value) return value;
  return "••••";
}

export function maskBundle(bundle: LlmBundle): LlmBundle {
  const agents = {} as Record<AgentId, AgentBinding>;
  for (const id of AGENT_IDS) {
    const a = bundle.agents[id];
    agents[id] = {
      ...a,
      overrides: {
        ...a.overrides,
        apiKey: a.overrides.apiKey ? maskKey(a.overrides.apiKey) : undefined,
      },
    };
  }
  return {
    ...bundle,
    profiles: bundle.profiles.map((p) => ({
      ...p,
      apiKey: p.apiKey ? `••••${p.apiKey.slice(-4)}` : "",
    })),
    agents,
  };
}

function asBook(raw: unknown, fallback: PromptBook): PromptBook {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const p = raw as Partial<PromptBook>;
  return {
    system: typeof p.system === "string" ? p.system : fallback.system,
    character: typeof p.character === "string" ? p.character : fallback.character,
    snapshot: typeof p.snapshot === "string" ? p.snapshot : fallback.snapshot,
    deltaSchema: typeof p.deltaSchema === "string" ? p.deltaSchema : fallback.deltaSchema,
  };
}

export function asBundle(raw: unknown): LlmBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as LlmBundle;
  if (!Array.isArray(b.profiles) || !b.agents?.director || !b.agents?.character) return null;
  for (const p of b.profiles) {
    if (typeof p.timeoutMs !== "number" || !Number.isFinite(p.timeoutMs)) p.timeoutMs = 45000;
    if (typeof p.maxRetries !== "number" || !Number.isFinite(p.maxRetries)) p.maxRetries = 2;
  }
  const agents = {} as Record<AgentId, AgentBinding>;
  for (const id of AGENT_IDS) {
    const existing = b.agents[id];
    const shipped = shippedBook(id);
    if (!existing) {
      agents[id] = bindingFor(id);
      continue;
    }
    agents[id] = {
      agentId: id,
      profileId: existing.profileId || "default",
      overrides: existing.overrides ?? {},
      prompts: asBook(existing.prompts, shipped),
    };
  }
  return { profiles: b.profiles, agents };
}
