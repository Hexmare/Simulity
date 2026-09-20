import { compileBook, type PromptBook } from "./prompts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PackBudget {
  contextTokens: number;
  maxHistoryTurns: number;
  maxSnapshotChars: number;
}

export interface PackedTurn {
  messages: ChatMessage[];
  usedChars: number;
  budgetChars: number;
  historyUsed: number;
}

/** Rough estimate until a real tokenizer hurts: 4 chars per token. */
export const CHARS_PER_TOKEN = 4;

const msgChars = (m: ChatMessage) => m.content.length;

/**
 * Build Chat Completions messages[] under the token budget.
 * Keep order: system+bible, narrative, live snapshot, then history
 * newest-first (oldest dropped). History is the only part ever cut.
 *
 * The trailing `message` is the latest player line. When that line is already
 * the last beat of `history` (the normal Speak path — the line is pushed to
 * the scene thread first), it is NOT appended again. Retry rebuilds the same
 * history, so the pack is identical across attempts.
 */
export function buildMessages(args: {
  book: PromptBook;
  name: string;
  setting: string;
  narrative: { public: string; private: string; voice: string };
  ancestry: string;
  job: string;
  liveJson: string;
  history: ChatTurn[];
  message?: string;
  budget: PackBudget;
}): PackedTurn {
  const budgetChars = Math.max(1024, args.budget.contextTokens * CHARS_PER_TOKEN);
  const snapshot = args.liveJson.slice(0, Math.max(256, args.budget.maxSnapshotChars));
  const compiled = compileBook(args.book, {
    name: args.name,
    setting: args.setting,
    narrative: args.narrative,
    ancestry: args.ancestry,
    job: args.job,
    snapshot,
  });
  const system: ChatMessage = { role: "system", content: compiled.system };
  const character: ChatMessage = { role: "user", content: compiled.character };
  const live: ChatMessage = { role: "user", content: compiled.live };
  const fixed = [system, character, live];
  // Latest player line: skip when it is already the last history beat.
  let current: ChatMessage | null =
    args.message != null && args.message.trim() ? { role: "user", content: args.message } : null;
  const capped = args.history.slice(-Math.max(1, args.budget.maxHistoryTurns));
  if (current && capped.length > 0 && capped[capped.length - 1]!.content === current.content) {
    current = null;
  }
  const fixedChars = fixed.reduce((n, m) => n + msgChars(m), 0) + (current ? msgChars(current) : 0);
  // Newest first: fill until the budget runs out, then restore order.
  const kept: ChatMessage[] = [];
  let used = fixedChars;
  for (let i = capped.length - 1; i >= 0; i--) {
    const h = capped[i]!;
    const m: ChatMessage = { role: h.role, content: h.content };
    if (used + msgChars(m) > budgetChars) break;
    kept.unshift(m);
    used += msgChars(m);
  }
  const messages = current ? [...fixed, ...kept, current] : [...fixed, ...kept];
  return {
    messages,
    usedChars: messages.reduce((n, m) => n + msgChars(m), 0),
    budgetChars,
    historyUsed: kept.length,
  };
}

/** "~N / M tokens" estimate line for the settings pane. */
export function usageLine(usedChars: number, contextTokens: number): string {
  return `~${Math.round(usedChars / CHARS_PER_TOKEN)} / ${contextTokens} tokens`;
}
