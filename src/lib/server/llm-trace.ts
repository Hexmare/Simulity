export interface LlmTraceMessage {
  role: string;
  content: string;
}

export interface LlmTraceEntry {
  id: string;
  at: number;
  agent: "director" | "character" | "other";
  label: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: LlmTraceMessage[];
  response: string | null;
  ok: boolean;
  error: string | null;
  latencyMs: number | null;
  // JSON-safe payload (acts, beat, or null). Kept loose for the
  // TanStack Start serializability check on the /debug server fn.
  parsed: Record<string, any> | { acts: { id: string; guidance: string; why?: string }[] } | null;
}

type G = typeof globalThis & { __simulityLlmTrace?: LlmTraceEntry[] };

const MAX_ENTRIES = 100;

function store(): LlmTraceEntry[] {
  const g = globalThis as G;
  if (!g.__simulityLlmTrace) g.__simulityLlmTrace = [];
  return g.__simulityLlmTrace;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export function recordLlmTrace(input: Omit<LlmTraceEntry, "id" | "at">): LlmTraceEntry {
  const entry: LlmTraceEntry = {
    ...input,
    messages: input.messages.map((m) => ({ role: m.role, content: truncate(String(m.content ?? ""), 12000) })),
    response: input.response == null ? null : truncate(input.response, 12000),
    id: crypto.randomUUID(),
    at: Date.now(),
  };
  const list = store();
  list.push(entry);
  while (list.length > MAX_ENTRIES) list.shift();
  return entry;
}

export function getLlmTrace(): LlmTraceEntry[] {
  return [...store()].reverse();
}

export function clearLlmTrace(): void {
  store().length = 0;
}
