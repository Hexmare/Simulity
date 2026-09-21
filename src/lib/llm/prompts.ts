import { shippedBook, type PromptBook } from "./prompt-catalog.ts";

export type { PromptBook } from "./prompt-catalog.ts";

/** Alias of the shipped Character book. Existing imports keep working. */
export const DEFAULT_BOOK: PromptBook = shippedBook("character");

/** Alias of the shipped Director book. Existing imports keep working. */
export const DIRECTOR_BOOK: PromptBook = shippedBook("director");

export function compileTemplate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => ctx[key] ?? "");
}

export function compileBook(
  book: PromptBook,
  ctx: {
    name?: string;
    setting?: string;
    narrative?: { public: string; private: string; voice: string };
    ancestry?: string;
    job?: string;
    snapshot?: string;
    [key: string]: unknown;
  },
): { system: string; character: string; live: string } {
  const narrative = ctx.narrative ?? { public: "", private: "", voice: "" };
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === "string") extra[k] = v;
  }
  const flat: Record<string, string> = {
    name: ctx.name ?? "",
    setting: ctx.setting ?? "",
    ancestry: ctx.ancestry ?? "",
    job: ctx.job ?? "",
    public: narrative.public,
    private: narrative.private,
    voice: narrative.voice,
    narrative: `${narrative.public}\n${narrative.voice}`,
    snapshot: typeof ctx.snapshot === "string" ? ctx.snapshot : "",
    guidance: typeof ctx.guidance === "string" ? ctx.guidance : "",
    presence: typeof ctx.presence === "string" ? ctx.presence : "here",
    pcCard: typeof ctx.pcCard === "string" ? ctx.pcCard : "",
    roster: typeof ctx.roster === "string" ? ctx.roster : "",
    alreadyActed: typeof ctx.alreadyActed === "string" ? ctx.alreadyActed : "",
    pass: typeof ctx.pass === "string" ? ctx.pass : "1",
    appearance: typeof ctx.appearance === "string" ? ctx.appearance : "",
    wearing: typeof ctx.wearing === "string" ? ctx.wearing : "",
    secrets: typeof ctx.secrets === "string" ? ctx.secrets : "",
    instruction: typeof ctx.instruction === "string" ? ctx.instruction : "",
    focus: typeof ctx.focus === "string" ? ctx.focus : "",
    query: typeof ctx.query === "string" ? ctx.query : "",
    text: typeof ctx.text === "string" ? ctx.text : "",
    timePassed: typeof ctx.timePassed === "string" ? ctx.timePassed : "",
    ...extra,
  };
  return {
    system: `${compileTemplate(book.system, flat)}\n${compileTemplate(book.deltaSchema, flat)}`.trim(),
    character: compileTemplate(book.character, flat).trim(),
    live: compileTemplate(book.snapshot, flat).trim(),
  };
}
