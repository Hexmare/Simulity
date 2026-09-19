import { DEFAULT_BOOK, DIRECTOR_BOOK, type PromptBook } from "./prompts.ts";
import { defaultSettings, withDefaults, type LlmSettings } from "./settings.ts";

export type AgentId = "director" | "character";

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
  };
}

export function defaultBundle(): LlmBundle {
  const p = profileFromSettings(defaultSettings());
  return {
    profiles: [p],
    agents: {
      director: { agentId: "director", profileId: "default", overrides: {}, prompts: { ...DIRECTOR_BOOK } },
      character: { agentId: "character", profileId: "default", overrides: {}, prompts: { ...DEFAULT_BOOK } },
    },
  };
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
    binding.profileId === "default"
      ? def
      : (bundle.profiles.find((p) => p.id === binding.profileId) ?? def);
  if (!base) throw new Error("No connection profile.");
  const merged: ConnectionProfile = { ...base, ...binding.overrides, isDefault: base.isDefault, id: base.id, name: base.name };
  return { ...merged, prompts: binding.prompts };
}

export function maskBundle(bundle: LlmBundle): LlmBundle {
  return {
    ...bundle,
    profiles: bundle.profiles.map((p) => ({
      ...p,
      apiKey: p.apiKey ? `••••${p.apiKey.slice(-4)}` : "",
    })),
    agents: {
      director: {
        ...bundle.agents.director,
        overrides: {
          ...bundle.agents.director.overrides,
          apiKey: bundle.agents.director.overrides.apiKey ? "••••" : undefined,
        },
      },
      character: {
        ...bundle.agents.character,
        overrides: {
          ...bundle.agents.character.overrides,
          apiKey: bundle.agents.character.overrides.apiKey ? "••••" : undefined,
        },
      },
    },
  };
}

export function asBundle(raw: unknown): LlmBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as LlmBundle;
  if (!Array.isArray(b.profiles) || !b.agents?.director || !b.agents?.character) return null;
  return b;
}
