import { createServerFn } from "@tanstack/react-start";
import { chatCompletions, type ChatConnection } from "./llm/chat";
import type { ChatMessage } from "./llm/packer";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type RoleplayDeltas = {
  needs?: Record<string, number>;
  mood?: number;
  relationships?: Record<string, Record<string, number>>;
  events?: { type: string; summary: string; targetId?: string }[];
  knowledge?: string[];
};

export type RoleplayResult =
  | { ok: true; speech: string; action?: string; deltas: RoleplayDeltas }
  | { ok: false; error: string };

/** Client asks whether a server-side env key exists (pre-XAI era fallback). */
export const llmServerInfo = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(async (): Promise<{ hasEnvKey: boolean }> => {
    return { hasEnvKey: !!process.env.XAI_API_KEY };
  });

function cleanConn(input: Partial<ChatConnection>): ChatConnection {
  return {
    baseUrl: String(input.baseUrl ?? "").trim(),
    path: String(input.path ?? "/v1/chat/completions").trim() || "/v1/chat/completions",
    apiKey: String(input.apiKey ?? ""),
    model: String(input.model ?? "testmodel").trim() || "testmodel",
    temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.8,
    maxOutputTokens: Math.max(1, Math.floor(Number(input.maxOutputTokens) || 400)),
  };
}

export const testConnection = createServerFn({ method: "POST" })
  .validator((input: { connection: Partial<ChatConnection> }) => input)
  .handler(async ({ data }): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> => {
    const conn = cleanConn(data.connection);
    if (!conn.baseUrl) return { ok: false, error: "Base URL is empty." };
    // One minimal turn: proves reachability, auth, model, and parse path.
    const res = await chatCompletions(conn, [{ role: "user", content: "ping" }], { maxTokens: 1, timeoutMs: 15000 });
    if (!res.ok) return res;
    return { ok: true, latencyMs: res.latencyMs };
  });

function parseReply(raw: string): RoleplayResult {
  const jsonText = raw.trim().replace(/^```json\s*|\s*```$/g, "");
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const speech = String((parsed as { speech?: unknown }).speech ?? "").slice(0, 800);
    if (!speech) return { ok: false, error: "Empty reply." };
    const d = ((parsed as { deltas?: unknown }).deltas ?? {}) as Record<string, unknown>;
    // Ignore anything outside the known delta shape.
    const deltas: RoleplayDeltas = {};
    if (d.needs && typeof d.needs === "object") deltas.needs = d.needs as Record<string, number>;
    if (typeof d.mood === "number") deltas.mood = d.mood;
    if (d.relationships && typeof d.relationships === "object") {
      deltas.relationships = d.relationships as Record<string, Record<string, number>>;
    }
    if (Array.isArray(d.events)) deltas.events = d.events.slice(0, 4) as RoleplayDeltas["events"];
    if (Array.isArray(d.knowledge)) deltas.knowledge = d.knowledge.filter((k): k is string => typeof k === "string").slice(0, 6);
    const action = (parsed as { action?: unknown }).action;
    return { ok: true, speech, action: typeof action === "string" ? action.slice(0, 200) : undefined, deltas };
  } catch {
    return { ok: true, speech: raw.slice(0, 800), deltas: {} };
  }
}

export const roleplayTurn = createServerFn({ method: "POST" })
  .validator(
    (input: { messages: ChatMessage[]; connection: Partial<ChatConnection>; useEnvKey: boolean }) => input,
  )
  .handler(async ({ data }): Promise<RoleplayResult> => {
    if (!Array.isArray(data.messages) || data.messages.length === 0) {
      return { ok: false, error: "Nothing to send." };
    }
    const conn = cleanConn(data.connection);
    if (!conn.baseUrl) return { ok: false, error: "Roleplay is offline — no provider configured." };
    if (!conn.apiKey && data.useEnvKey && process.env.XAI_API_KEY) {
      conn.apiKey = process.env.XAI_API_KEY;
    }
    const res = await chatCompletions(conn, data.messages);
    if (!res.ok) return res;
    return parseReply(res.text);
  });
