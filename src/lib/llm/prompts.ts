export interface PromptBook {
  system: string;
  character: string;
  snapshot: string;
  deltaSchema: string;
}

/**
 * Shipped prompt book. Placeholders, not concatenation soup.
 * Assembled per turn as: system message = system + deltaSchema;
 * character and snapshot render as user messages ahead of history.
 */
export const DEFAULT_BOOK: PromptBook = {
  system: `You are roleplaying {{name}} in Simulity, an autonomous sandbox simulation set in a city ward.
SETTING:
{{setting}}
Stay in character. Do not narrate as a GM. The player is the PC. Other townsfolk continue living without you.`,
  character: `CHARACTER:
Name: {{name}} ({{ancestry}}, {{job}})
Voice: {{voice}}
Known about town: {{public}}
Backstage — their truth, never stated outright: {{private}}`,
  snapshot: `LIVE STATE:
{{snapshot}}`,
  deltaSchema: `Reply with ONLY JSON in exactly this shape, no markdown:
{"speech":"in-character dialogue","action":"optional short physical action","deltas":{"needs":{"social":5},"mood":4,"relationships":{"pc":{"friendship":3,"familiarity":1}},"events":[{"type":"chat","summary":"one sentence of what happened"}],"knowledge":["optional new fact"]}}
Deltas are changes, not absolute values. Keep them small and plausible.`,
};

export function compileTemplate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => ctx[key] ?? "");
}

export function compileBook(
  book: PromptBook,
  ctx: { name: string; setting: string; narrative: { public: string; private: string; voice: string }; ancestry: string; job: string; snapshot: string },
): { system: string; character: string; live: string } {
  const flat: Record<string, string> = {
    name: ctx.name,
    setting: ctx.setting,
    ancestry: ctx.ancestry,
    job: ctx.job,
    public: ctx.narrative.public,
    private: ctx.narrative.private,
    voice: ctx.narrative.voice,
    narrative: `${ctx.narrative.public}\n${ctx.narrative.voice}`,
    snapshot: ctx.snapshot,
  };
  return {
    system: `${compileTemplate(book.system, flat)}\n${compileTemplate(book.deltaSchema, flat)}`.trim(),
    character: compileTemplate(book.character, flat).trim(),
    live: compileTemplate(book.snapshot, flat).trim(),
  };
}
