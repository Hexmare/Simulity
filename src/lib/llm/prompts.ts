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
Stay in character. Do not narrate as a GM. The player is the PC. Other townsfolk continue living without you.
Presence: {{presence}}. If called, you are not physically in the room — no handing objects, no walking the floor.`,
  character: `CHARACTER:
Name: {{name}} ({{ancestry}}, {{job}})
Voice: {{voice}}
Known about town: {{public}}
Backstage — their truth, never stated outright: {{private}}
Director guidance (private, obey): {{guidance}}`,
  snapshot: `LIVE STATE:
{{snapshot}}
PC: {{pcCard}}
OTHERS: {{roster}}`,
  deltaSchema: `Reply with ONLY JSON in exactly this shape, no markdown:
{"speech":"in-character dialogue or empty","action":"optional short physical action","deltas":{"needs":{"social":5},"mood":4,"relationships":{"pc":{"friendship":3,"familiarity":1}},"events":[{"type":"chat","summary":"one sentence of what happened"}],"knowledge":["optional new fact"]}}
Deltas are changes, not absolute values. Keep them small and plausible. Do not emit a location delta.
If you are going to another room or building, set "move": {"buildingId":"...","room":"Dining"}. Speech first, then you walk. You do not move anyone else.
To bring a distant soul into the scene, set "call": {"npcId":"..."}. They join as a called voice; their body stays.
To leave them a message after the scene, set "task": {"steps":[{"op":"move","to":{"npcId":"..."}},{"op":"tell","targetId":"...","content":"..."}]} for yourself only.`,
};

export const DIRECTOR_BOOK: PromptBook = {
  system: `You are the Director of a roleplay scene in Simulity. You never speak in the thread. You never emit deltas.
SETTING:
{{setting}}
Pick which CURRENT PARTICIPANTS act in response to the player's line, in order, with short private guidance for each.
Only use ids from the roster. Do not invent souls. Do not include the PC. Empty acts means silence (nobody answers).
If this is pass 2, only name ids listed as not-yet-acted.`,
  character: `PC: {{pcCard}}
ROSTER: {{roster}}
ALREADY ACTED: {{alreadyActed}}
PASS: {{pass}}`,
  snapshot: `THREAD:
{{snapshot}}`,
  deltaSchema: `Reply with ONLY JSON, no markdown:
{"acts":[{"id":"npc-id","guidance":"one sentence of private direction","why":"short reason"}],"add":[{"id":"npc-id","how":"here or call"}],"remove":["npc-id"]}
"add" brings souls in (use "here" only for someone in the PC's room, else "call"). "remove" releases souls who are leaving. Unknown or just-removed ids are dropped.`,
};

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
    ...extra,
  };
  return {
    system: `${compileTemplate(book.system, flat)}\n${compileTemplate(book.deltaSchema, flat)}`.trim(),
    character: compileTemplate(book.character, flat).trim(),
    live: compileTemplate(book.snapshot, flat).trim(),
  };
}