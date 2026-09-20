import type { ClothingItem, ClothingSlot, Defs, GarmentLayer, Npc } from "./types.ts";

/** Torso stack, outermost first. A worn overcoat hides the jacket in presented dress. */
const TORSO_STACK: ClothingSlot[] = [
  "overcoat",
  "coat",
  "jacket",
  "sweater",
  "shirt",
  "undershirt",
  "underwearTop",
  "underwear",
];

/** Slots never named in presented dress unless they are the outermost visible piece. */
const INTIMATE: ReadonlySet<ClothingSlot> = new Set(["underwear", "underwearTop", "hosiery"]);

const LAYER_RANK: Record<GarmentLayer, number> = { under: 0, inner: 1, mid: 2, outer: 3 };

function article(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}

function itemNoun(defs: Defs, item: ClothingItem): string {
  const label = (item.label ?? defs.garments[item.defId]?.label ?? "garment").trim() || "garment";
  return label;
}

/** Items this soul is wearing, outermost-first by layer then slot order. */
export function wornItems(defs: Defs, clothing: ClothingItem[], npc: Npc): ClothingItem[] {
  const byId = new Map(clothing.map((c) => [c.id, c]));
  const out: ClothingItem[] = [];
  for (const slot of Object.keys(npc.worn ?? {}) as ClothingSlot[]) {
    const id = npc.worn[slot];
    if (!id) continue;
    const item = byId.get(id);
    if (item && item.wornBy === npc.id) out.push(item);
  }
  const rank = (c: ClothingItem) => LAYER_RANK[defs.garments[c.defId]?.layer ?? "inner"] ?? 1;
  out.sort((a, b) => rank(b) - rank(a));
  return out;
}

/**
 * One descriptive line for prompts — visible layers only, not a slot dump.
 * `Wearing: a charcoal overcoat over a white shirt, dark trousers, and scuffed boots; wire glasses.`
 */
export function describeWorn(defs: Defs, clothing: ClothingItem[], npc: Npc): string {
  const worn = wornItems(defs, clothing, npc);
  if (!worn.length) return "Wearing: nothing notable.";
  const slotOf = new Map<ClothingItem, ClothingSlot>();
  for (const [slot, id] of Object.entries(npc.worn ?? {}) as [ClothingSlot, string | null][]) {
    if (!id) continue;
    const item = worn.find((c) => c.id === id);
    if (item) slotOf.set(item, slot);
  }
  const noun = (c: ClothingItem) => `${article(itemNoun(defs, c))} ${itemNoun(defs, c)}`;
  // Torso: outermost visible piece, plus the outermost inner piece joined with "over".
  const torso = TORSO_STACK.map((s) => worn.find((c) => slotOf.get(c) === s)).filter(
    (c): c is ClothingItem => !!c,
  );
  const parts: string[] = [];
  if (torso.length) {
    const top = torso[0]!;
    const topLayer = LAYER_RANK[defs.garments[top.defId]?.layer ?? "inner"] ?? 1;
    const under = torso.find((c) => (LAYER_RANK[defs.garments[c.defId]?.layer ?? "inner"] ?? 1) < topLayer);
    parts.push(under ? `${noun(top)} over ${noun(under)}` : noun(top));
  }
  const legs = worn.find((c) => slotOf.get(c) === "legs");
  const hosiery = worn.find((c) => slotOf.get(c) === "hosiery");
  // Intimate layers are omitted unless the outermost visible piece (no trousers on).
  if (legs) parts.push(noun(legs));
  else if (hosiery) parts.push(noun(hosiery));
  const feet = worn.find((c) => slotOf.get(c) === "feet");
  const socks = worn.find((c) => slotOf.get(c) === "socks");
  if (feet) parts.push(noun(feet));
  else if (socks && !feet) parts.push(noun(socks));
  const extras = worn.filter((c) => {
    const s = slotOf.get(c);
    return s === "hat" || s === "glasses" || s === "belt";
  });
  let line: string;
  if (parts.length === 0 && extras.length === 0) {
    // Only intimate layers worn: name nothing.
    return "Wearing: nothing notable.";
  }
  if (parts.length <= 1) line = parts.join("");
  else if (parts.length === 2) line = `${parts[0]}, and ${parts[1]}`;
  else line = `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  let out = `Wearing: ${line}.`;
  if (extras.length) out += ` ${extras.map((c) => noun(c)).join("; ")}.`;
  return out;
}

/**
 * Unworn items lying in the soul's current building.
 * `Here, not worn: Mara's overcoat in Dining.`
 */
export function describeUnwornInRoom(
  defs: Defs,
  clothing: ClothingItem[],
  npc: Npc,
  roomLabel: string | null,
  ownerNameOf: (ownerId: string) => string | null,
): string | null {
  const buildingId = npc.loc.buildingId;
  if (npc.loc.layer !== "interior" || !buildingId) return null;
  const mine = npc.name.split(" ")[0] ?? npc.name;
  const bits: string[] = [];
  for (const item of clothing) {
    if (item.wornBy || item.stored) continue;
    if (!item.loc || item.loc.buildingId !== buildingId) continue;
    const noun = itemNoun(defs, item).toLowerCase();
    const owner = ownerNameOf(item.ownerId);
    const whose = owner && owner !== npc.name ? `${owner.split(" ")[0]}'s ${noun}` : owner ? `your ${noun}` : `${article(noun)} ${noun}`;
    void mine;
    bits.push(whose);
  }
  if (!bits.length) return null;
  const where = roomLabel ? ` in ${roomLabel}` : "";
  return `Here, not worn: ${bits.join(", ")}${where}.`;
}

/** Empty worn map for a fresh soul. */
export function emptyWorn(): Record<ClothingSlot, string | null> {
  return {
    feet: null,
    socks: null,
    legs: null,
    underwear: null,
    underwearTop: null,
    undershirt: null,
    shirt: null,
    sweater: null,
    jacket: null,
    coat: null,
    overcoat: null,
    belt: null,
    hat: null,
    glasses: null,
    hosiery: null,
  };
}
