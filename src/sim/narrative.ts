import type { Npc } from "./types.ts";
import type { Rng } from "./rng.ts";
import { pick } from "./rng.ts";

const OPENERS = [
  "Keeps a tidy house and a tidier ledger of who owes whom a favor.",
  "Laughs loudest at the market and means most of it.",
  "Walks the long way round to avoid the well after dark, and won't say why.",
  "Remembers every birth and burial in the street for twenty years.",
  "Sings while working and pretends not to notice when others join in.",
  "Counts change twice and trusts people once.",
];

const HABITS = [
  "Mends nets nobody asked them to mend.",
  "Leaves bread out for the crows and denies it.",
  "Polishes the threshold sign every first-day.",
  "Knows which diner bench creaks and sits there anyway.",
  "Trades gossip for gossip and calls it even.",
  "Feeds the stray cats behind the bakehouse.",
];

const WANTS = [
  "Wants a house with a loft and a door that shuts true.",
  "Wants to be remembered kindly by at least three streets.",
  "Wants one winter without counting coins.",
  "Wants to learn a sign properly, not just the motions.",
  "Wants the night market to know their name.",
  "Wants to see the river freeze all the way across, once.",
];

const SECRETS = [
  "Once shorted a till and paid it back with interest nobody noticed.",
  "Writes letters they never send, kept in a crate under the bed.",
  "Heard something answer back from the cellar once. Never went down alone again.",
  "Knows exactly who slipped the last cask of wine into the chancery, and would take that to the grave.",
  "Is afraid of their own temper and counts to twelve because of it.",
  "Keeps a second name for the night market.",
];

const VOICES = [
  "dry, old-fashioned, never swears",
  "warm, quick, talks with their hands",
  "quiet, careful, says little and means it",
  "brisk, practical, no patience for dawdling",
  "lilting, fond of proverbs, laughs mid-sentence",
  "gravelly, slow, fond of long pauses",
];

export interface Narrative {
  public: string;
  private: string;
  voice: string;
}

export function makeNarrative(
  rng: Rng,
  opts: { name: string; ancestryNote?: string; job: string; traits: string[]; home: string },
): Narrative {
  const opener = pick(rng, OPENERS);
  const habit = pick(rng, HABITS);
  const want = pick(rng, WANTS);
  const secret = pick(rng, SECRETS);
  const voice = pick(rng, VOICES);
  const first = opts.name.split(" ")[0] ?? opts.name;
  const note = opts.ancestryNote ? ` ${opts.ancestryNote}` : "";
  const pub = `${opts.name}, ${opts.job.toLowerCase()} of ${opts.home}.${note} ${opener} ${habit} ${want}`;
  const priv = `${first} thinks in lists and keeps the short ones close. ${secret} Puts on ${voice.split(",")[0]} manners for company and drops them at home.`;
  return { public: pub.slice(0, 600), private: priv.slice(0, 600), voice };
}

export function ensureNarrative(n: Npc, rng: Rng, job: string, home: string): void {
  if (n.narrative && n.narrative.public) return;
  n.narrative = makeNarrative(rng, {
    name: n.name,
    job,
    traits: n.bb.traits,
    home,
  });
}
