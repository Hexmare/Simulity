import { DEFAULT_BOOK, type PromptBook } from "./prompts";

export interface LlmSettings {
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
  prompts: PromptBook;
}

/** Legacy browser key — lifted onto the server once, then discarded. */
export const SETTINGS_KEY = "fenwick.v1.llm";

export const CONTEXT_OPTIONS = [4096, 8192, 16384, 32768];

let cache: LlmSettings | null = null;

export function defaultSettings(): LlmSettings {
  return {
    enabled: true,
    baseUrl: "http://192.168.88.12:8002",
    path: "/v1/chat/completions",
    apiKey: "",
    model: "testmodel",
    temperature: 0.8,
    maxOutputTokens: 400,
    contextTokens: 8192,
    maxHistoryTurns: 20,
    maxSnapshotChars: 4000,
    prompts: { ...DEFAULT_BOOK },
  };
}

/** Merge a partial (e.g. from storage) over defaults. Pure — safe to test. */
export function withDefaults(partial: Partial<LlmSettings> & { prompts?: Partial<PromptBook> }): LlmSettings {
  const d = defaultSettings();
  return {
    ...d,
    ...partial,
    prompts: { ...d.prompts, ...(partial.prompts ?? {}) },
    temperature: Number.isFinite(Number(partial.temperature)) ? Number(partial.temperature) : d.temperature,
    maxOutputTokens: Math.max(1, Math.floor(Number(partial.maxOutputTokens) || d.maxOutputTokens)),
    contextTokens: CONTEXT_OPTIONS.includes(Number(partial.contextTokens)) ? Number(partial.contextTokens) : d.contextTokens,
    maxHistoryTurns: Math.max(1, Math.min(100, Math.floor(Number(partial.maxHistoryTurns) || d.maxHistoryTurns))),
    maxSnapshotChars: Math.max(256, Math.floor(Number(partial.maxSnapshotChars) || d.maxSnapshotChars)),
  };
}

export function peekSettings(): LlmSettings {
  return cache ?? defaultSettings();
}

export function rememberSettings(s: LlmSettings): LlmSettings {
  cache = withDefaults(s);
  return cache;
}

/** Sync cache read. Server pull happens via persistence-client.loadSettings. */
export function loadSettings(): LlmSettings {
  return peekSettings();
}

/** Sync cache write. Server persist happens via persistence-client.saveSettings. */
export function saveSettings(s: LlmSettings): void {
  rememberSettings(s);
}
