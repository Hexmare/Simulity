import type {
  AncestryDef,
  BtNode,
  BtTree,
  BuildingKind,
  BuildingKindDef,
  Consideration,
  Defs,
  GoalDef,
  JobDef,
  NeedDef,
  RelDelta,
  SocialActionDef,
  SpellDef,
  TraitDef,
} from "./types";

type Nested =
  | { seq: Nested[]; label?: string }
  | { sel: Nested[]; label?: string }
  | { inv: Nested; label?: string }
  | { cond: string; p?: Record<string, string | number | boolean>; label?: string }
  | { act: string; p?: Record<string, string | number | boolean>; label?: string };

function compileTree(id: string, name: string, nested: Nested): BtTree {
  const nodes: Record<string, BtNode> = {};
  let n = 0;
  const add = (node: Nested): string => {
    const nid = `${id}.${++n}`;
    if ("seq" in node) {
      const children = node.seq.map(add);
      nodes[nid] = { id: nid, type: "sequence", children, label: node.label ?? "Sequence" };
    } else if ("sel" in node) {
      const children = node.sel.map(add);
      nodes[nid] = { id: nid, type: "selector", children, label: node.label ?? "Selector" };
    } else if ("inv" in node) {
      const child = add(node.inv);
      nodes[nid] = { id: nid, type: "inverter", child, label: node.label ?? "Inverter" };
    } else if ("cond" in node) {
      nodes[nid] = {
        id: nid,
        type: "condition",
        cond: node.cond,
        params: node.p,
        label: node.label ?? node.cond,
      };
    } else {
      nodes[nid] = {
        id: nid,
        type: "action",
        action: node.act,
        params: node.p,
        label: node.label ?? node.act,
      };
    }
    return nid;
  };
  return { id, name, root: add(nested), nodes };
}

export const NEEDS: NeedDef[] = [
  { id: "hunger", label: "Hunger", decayPerHour: 4.2, criticalBelow: 22 },
  { id: "energy", label: "Energy", decayPerHour: 3.4, criticalBelow: 18 },
  { id: "social", label: "Company", decayPerHour: 3.8, criticalBelow: 20 },
  { id: "fun", label: "Spirit", decayPerHour: 2.6, criticalBelow: 18 },
  { id: "hygiene", label: "Clean", decayPerHour: 2.2, criticalBelow: 16 },
  { id: "comfort", label: "Comfort", decayPerHour: 1.6, criticalBelow: 20 },
  { id: "status", label: "Standing", decayPerHour: 0.8, criticalBelow: 12 },
  { id: "thirst", label: "Thirst", decayPerHour: 0, criticalBelow: 22 },
];

export const TRAITS: Record<string, TraitDef> = {
  gregarious: {
    id: "gregarious",
    label: "Gregarious",
    modifiers: { needDecay: { social: 1.25 }, socialHit: { chat: 2, joke: 2 }, utility: { socialize: 0.15 } },
  },
  loner: {
    id: "loner",
    label: "Loner",
    modifiers: { needDecay: { social: 0.7 }, socialHit: { chat: -1 }, utility: { socialize: -0.12 } },
  },
  glutton: {
    id: "glutton",
    label: "Glutton",
    modifiers: { needDecay: { hunger: 1.35 }, utility: { eat: 0.1 } },
  },
  industrious: {
    id: "industrious",
    label: "Industrious",
    modifiers: { utility: { work: 0.18 } },
  },
  kind: {
    id: "kind",
    label: "Kind",
    modifiers: { socialHit: { comfort: 3, praise: 2, insult: -3 } },
  },
  irritable: {
    id: "irritable",
    label: "Irritable",
    modifiers: { socialHit: { insult: 3, argue: 2, joke: -1 } },
  },
  romantic: {
    id: "romantic",
    label: "Romantic",
    modifiers: { socialHit: { flirt: 3 } },
  },
  devout: {
    id: "devout",
    label: "Devout",
    modifiers: { utility: { worship: 0.2 } },
  },
  lazy: {
    id: "lazy",
    label: "Lazy",
    modifiers: { utility: { work: -0.16, relax: 0.12 }, needDecay: { energy: 1.15 } },
  },
  cheerful: {
    id: "cheerful",
    label: "Cheerful",
    modifiers: { socialHit: { joke: 2, chat: 1 } },
  },
};

export const JOBS: Record<string, JobDef> = {
  farmer: { id: "farmer", label: "Farmer", workplace: "farmhouse", startHour: 6, endHour: 17, palette: 0, produces: { grain: 1 }, wage: 1 },
  baker: { id: "baker", label: "Baker", workplace: "bakery", startHour: 5, endHour: 14, palette: 1, consumes: { flour: 1 }, produces: { bread: 1, food: 2 }, wage: 2 },
  innkeeper: { id: "innkeeper", label: "Innkeeper", workplace: "tavern", startHour: 11, endHour: 23, palette: 2, consumes: { grain: 1 }, produces: { ale: 2, food: 1 }, wage: 2 },
  merchant: { id: "merchant", label: "Merchant", workplace: "market", startHour: 8, endHour: 17, palette: 3, consumes: { goods: 1 }, produces: { coin: 4 }, wage: 2 },
  carpenter: { id: "carpenter", label: "Carpenter", workplace: "workshop", startHour: 8, endHour: 17, palette: 4, consumes: { wood: 1 }, produces: { goods: 1 }, wage: 2 },
  miller: { id: "miller", label: "Miller", workplace: "mill", startHour: 7, endHour: 16, palette: 5, consumes: { grain: 1 }, produces: { flour: 1 }, wage: 1 },
  priest: { id: "priest", label: "Priest", workplace: "temple", startHour: 7, endHour: 19, palette: 6, wage: 1 },
  guard: { id: "guard", label: "Guard", workplace: "guardhouse", startHour: 8, endHour: 20, palette: 7, wage: 1 },
  laborer: { id: "laborer", label: "Laborer", workplace: "plaza", startHour: 8, endHour: 17, palette: 8, wage: 1 },
  homemaker: { id: "homemaker", label: "Homemaker", workplace: "home", startHour: 8, endHour: 16, palette: 9, consumes: { grain: 1 }, produces: { food: 2 }, wage: 1 },
  child: { id: "child", label: "Child", workplace: "plaza", startHour: 10, endHour: 16, palette: 10 },
  elder: { id: "elder", label: "Elder", workplace: "temple", startHour: 10, endHour: 15, palette: 11, wage: 1 },
};

const needC = (needId: string, weight: number, curve: Consideration["curve"] = "inverse_quadratic"): Consideration => ({
  kind: "need",
  needId,
  weight,
  curve,
});

export const GOALS: GoalDef[] = [
  { id: "eat", label: "Eat", treeId: "tree.eat", considerations: [needC("hunger", 1.25)] },
  {
    id: "sleep",
    label: "Sleep",
    treeId: "tree.sleep",
    considerations: [needC("energy", 1.3), { kind: "timeBand", startHour: 21, endHour: 6, weight: 0.45 }],
  },
  { id: "drink", label: "Drink", treeId: "tree.drink", considerations: [needC("thirst", 1.35)] },
  {
    id: "ward",
    label: "Ward",
    treeId: "tree.ward",
    considerations: [needC("comfort", 0.35), { kind: "constant", value: 0.05, weight: 1 }],
  },
  {
    id: "work",
    label: "Work",
    treeId: "tree.work",
    considerations: [
      { kind: "schedule", weight: 0.95 },
      needC("hunger", -0.35, "inverse"),
      needC("energy", -0.3, "inverse"),
    ],
  },
  {
    id: "socialize",
    label: "Socialize",
    treeId: "tree.socialize",
    considerations: [needC("social", 1.05), { kind: "nearbyPeople", weight: 0.28 }],
  },
  { id: "hygiene", label: "Wash", treeId: "tree.hygiene", considerations: [needC("hygiene", 0.9)] },
  { id: "relax", label: "Unwind", treeId: "tree.relax", considerations: [needC("fun", 0.85), needC("comfort", 0.4)] },
  { id: "worship", label: "Worship", treeId: "tree.worship", considerations: [{ kind: "constant", value: 0.04, weight: 1 }] },
  { id: "wander", label: "Wander", treeId: "tree.wander", considerations: [{ kind: "constant", value: 0.07, weight: 1 }] },
];

function rel(
  friendship = 0,
  rest: RelDelta = {},
): RelDelta {
  return { friendship, familiarity: 1, ...rest };
}

export const SOCIAL: Record<string, SocialActionDef> = {
  greet: {
    id: "greet",
    label: "Greet",
    dc: 6,
    tags: ["light"],
    socialRestore: 6,
    targetSocial: 4,
    outcomes: {
      great: rel(4, { mood: 4, targetMood: 4, trust: 1 }),
      success: rel(2, { mood: 2, targetMood: 2 }),
      fail: rel(0, { mood: -1 }),
      critFail: rel(-1, { mood: -2, targetMood: -1 }),
    },
  },
  chat: {
    id: "chat",
    label: "Chat",
    dc: 8,
    tags: ["talk"],
    socialRestore: 16,
    targetSocial: 12,
    outcomes: {
      great: rel(6, { mood: 6, targetMood: 5, trust: 2 }),
      success: rel(3, { mood: 3, targetMood: 3, trust: 1 }),
      fail: rel(-1, { mood: -2, targetMood: -1 }),
      critFail: rel(-3, { mood: -4, targetMood: -3, grudge: 2 }),
    },
  },
  joke: {
    id: "joke",
    label: "Joke",
    dc: 10,
    tags: ["talk", "fun"],
    socialRestore: 14,
    targetSocial: 10,
    outcomes: {
      great: rel(7, { mood: 8, targetMood: 8 }),
      success: rel(3, { mood: 5, targetMood: 4 }),
      fail: rel(-2, { mood: -3, targetMood: -2 }),
      critFail: rel(-4, { mood: -5, targetMood: -4, grudge: 2 }),
    },
  },
  insult: {
    id: "insult",
    label: "Insult",
    dc: 9,
    tags: ["hostile"],
    requires: { maxGrudge: 80 },
    socialRestore: 8,
    targetSocial: -6,
    outcomes: {
      great: rel(-8, { mood: 4, targetMood: -10, grudge: 8, trust: -4 }),
      success: rel(-5, { mood: 1, targetMood: -7, grudge: 5, trust: -2 }),
      fail: rel(-2, { mood: -3, targetMood: -2, grudge: 2 }),
      critFail: rel(-3, { mood: -6, targetMood: 1, grudge: 1 }),
    },
  },
  comfort: {
    id: "comfort",
    label: "Comfort",
    dc: 9,
    tags: ["kind"],
    socialRestore: 12,
    targetSocial: 14,
    outcomes: {
      great: rel(8, { mood: 5, targetMood: 10, trust: 4 }),
      success: rel(4, { mood: 3, targetMood: 6, trust: 2 }),
      fail: rel(0, { mood: -1, targetMood: -1 }),
      critFail: rel(-2, { mood: -3, targetMood: -4 }),
    },
  },
  flirt: {
    id: "flirt",
    label: "Flirt",
    dc: 12,
    tags: ["romance"],
    requires: { minFamiliarity: 8 },
    socialRestore: 12,
    targetSocial: 10,
    outcomes: {
      great: rel(4, { romance: 8, mood: 8, targetMood: 8 }),
      success: rel(2, { romance: 4, mood: 4, targetMood: 3 }),
      fail: rel(-1, { romance: -1, mood: -3, targetMood: -1 }),
      critFail: rel(-3, { romance: -3, mood: -6, targetMood: -4, grudge: 2 }),
    },
  },
  vow: {
    id: "vow",
    label: "Vow",
    dc: 11,
    tags: ["romance", "ceremony"],
    requires: { minFriendship: 40, minFamiliarity: 20 },
    socialRestore: 10,
    targetSocial: 10,
    outcomes: {
      great: rel(8, { romance: 6, mood: 10, targetMood: 10, trust: 6 }),
      success: rel(5, { romance: 4, mood: 6, targetMood: 6, trust: 4 }),
      fail: rel(0, { mood: -2, targetMood: -1 }),
      critFail: rel(-2, { romance: -2, mood: -4, targetMood: -3 }),
    },
  },
  ask: {
    id: "ask",
    label: "Ask",
    dc: 10,
    tags: ["feed", "ask"],
    requires: { minFamiliarity: 5 },
    socialRestore: 4,
    targetSocial: 2,
    outcomes: {
      great: rel(3, { mood: 3, targetMood: 4, trust: 3 }),
      success: rel(2, { mood: 2, targetMood: 2, trust: 2 }),
      fail: rel(-1, { mood: -2, targetMood: -1 }),
      critFail: rel(-2, { mood: -4, targetMood: -2, grudge: 2 }),
    },
  },
  feed: {
    id: "feed",
    label: "Feed",
    dc: 11,
    tags: ["feed"],
    socialRestore: 4,
    targetSocial: 0,
    outcomes: {
      great: rel(1, { mood: 6 }),
      success: rel(0, { mood: 4 }),
      fail: rel(-2, { mood: -3, targetMood: -2, grudge: 3 }),
      critFail: rel(-4, { mood: -6, targetMood: -6, grudge: 8 }),
    },
  },
  part: {
    id: "part",
    label: "Part ways",
    dc: 8,
    tags: ["romance"],
    requires: { minFamiliarity: 10 },
    socialRestore: 4,
    targetSocial: 2,
    outcomes: {
      great: rel(-4, { romance: -10, mood: -2, targetMood: -4, trust: -2 }),
      success: rel(-6, { romance: -12, mood: -4, targetMood: -4, trust: -3, grudge: 2 }),
      fail: rel(-3, { romance: -6, mood: -6, targetMood: -2, grudge: 3 }),
      critFail: rel(-8, { romance: -8, mood: -8, targetMood: -8, grudge: 6, trust: -4 }),
    },
  },
  argue: {
    id: "argue",
    label: "Argue",
    dc: 10,
    tags: ["hostile"],
    requires: { minFamiliarity: 6 },
    socialRestore: 10,
    targetSocial: 6,
    outcomes: {
      great: rel(-2, { mood: 2, targetMood: -4, trust: -1, grudge: 3 }),
      success: rel(-4, { mood: -1, targetMood: -3, grudge: 4, trust: -2 }),
      fail: rel(-3, { mood: -4, targetMood: -2, grudge: 2 }),
      critFail: rel(-6, { mood: -6, targetMood: -5, grudge: 6, trust: -3 }),
    },
  },
  praise: {
    id: "praise",
    label: "Praise",
    dc: 8,
    tags: ["kind"],
    socialRestore: 10,
    targetSocial: 12,
    outcomes: {
      great: rel(6, { mood: 4, targetMood: 8, trust: 2 }),
      success: rel(3, { mood: 2, targetMood: 5 }),
      fail: rel(0, { mood: -1 }),
      critFail: rel(-2, { mood: -2, targetMood: -3 }),
    },
  },
};

const TREES: BtTree[] = [
  compileTree("tree.eat", "Eat", {
    sel: [
      { seq: [{ cond: "hasFood", label: "Has food" }, { act: "eat", label: "Eat" }], label: "Eat on hand" },
      {
        seq: [
          { act: "moveTo", p: { where: "tavern" }, label: "Go to tavern" },
          { act: "buyFood", label: "Buy food" },
          { act: "eat", label: "Eat" },
        ],
        label: "Buy a meal",
      },
    ],
  }),
  compileTree("tree.sleep", "Sleep", {
    seq: [
      { act: "moveTo", p: { where: "bed" }, label: "Go to bed" },
      { act: "sleep", label: "Sleep" },
    ],
  }),
  compileTree("tree.drink", "Drink", {
    seq: [
      { act: "moveTo", p: { where: "drink" }, label: "Find vitae" },
      { act: "drink", label: "Drink" },
    ],
  }),
  compileTree("tree.ward", "Ward", {
    seq: [
      { act: "moveTo", p: { where: "home" }, label: "Go home" },
      { act: "ward", label: "Redraw the sign" },
    ],
  }),
  compileTree("tree.work", "Work", {
    seq: [
      { cond: "isWorkHours", label: "On shift" },
      { act: "moveTo", p: { where: "work" }, label: "Go to work" },
      { act: "work", label: "Do the job" },
    ],
  }),
  compileTree("tree.socialize", "Socialize", {
    seq: [
      { act: "findSocial", label: "Find someone" },
      { cond: "hasTarget", label: "Has a target" },
      { act: "moveTo", p: { where: "target" }, label: "Walk over" },
      { act: "social", label: "Social action" },
    ],
  }),
  compileTree("tree.hygiene", "Wash", {
    seq: [
      { act: "moveTo", p: { where: "well" }, label: "Go to well" },
      { act: "wash", label: "Wash" },
    ],
  }),
  compileTree("tree.relax", "Unwind", {
    sel: [
      {
        seq: [
          { act: "moveTo", p: { where: "tavern" }, label: "Go to tavern" },
          { act: "wait", p: { ticks: 6 }, label: "Sit a while" },
        ],
        label: "Tavern",
      },
      {
        seq: [
          { act: "moveTo", p: { where: "plaza" }, label: "Go to plaza" },
          { act: "wait", p: { ticks: 5 }, label: "Loiter" },
        ],
        label: "Plaza",
      },
    ],
  }),
  compileTree("tree.worship", "Worship", {
    seq: [
      { act: "moveTo", p: { where: "temple" }, label: "Go to temple" },
      { act: "wait", p: { ticks: 8 }, label: "Pray" },
    ],
  }),
  compileTree("tree.wander", "Wander", { act: "wander", label: "Wander" }),
];

export const ANCESTRIES: Record<string, AncestryDef> = {
  human: {
    id: "human", label: "Human", plural: "Humans", paletteBias: 0, mark: "none",
    needModifiers: {}, essenceCap: 100, essenceRegen: 2, tags: [],
  },
  demon: {
    id: "demon", label: "Demon", plural: "Demons", paletteBias: 3, mark: "horns",
    needModifiers: { hunger: 0.8, energy: 0.85 }, resource: "ember",
    essenceCap: 120, essenceRegen: 3, tags: ["kindred"],
  },
  angel: {
    id: "angel", label: "Angel", plural: "Angels", paletteBias: 6, mark: "halo",
    needModifiers: { hunger: 0.7, comfort: 0.8 }, resource: "grace",
    essenceCap: 120, essenceRegen: 3, tags: ["kindred"],
  },
  vampire: {
    id: "vampire", label: "Vampire", plural: "Vampires", paletteBias: 9, mark: "fangs",
    needModifiers: { hunger: 0.4, energy: 0.7 }, resource: "vitae",
    thirst: { good: "vitae", decayPerHour: 5 },
    essenceCap: 110, essenceRegen: 2, tags: ["kindred", "night"],
  },
};

export const SPELLS: Record<string, SpellDef> = {
  threshold: { id: "threshold", label: "Threshold Sign", school: "ward", cost: 15, tags: ["ward", "home"], effect: "Redraws the home threshold; the house rests easier." },
  hearthlit: { id: "hearthlit", label: "Hearthlit", school: "hearth", cost: 10, tags: ["hearth", "comfort"], effect: "Coaxes a cold hearth warm without wood." },
  kindle: { id: "kindle", label: "Kindspark", school: "charm", cost: 10, tags: ["charm", "social"], effect: "Warms a conversation; courtesy comes easier." },
  namesign: { id: "namesign", label: "Name Sign", school: "sign", cost: 12, tags: ["sign", "ward"], effect: "Marks a door with the household's sign." },
  quietus: { id: "quietus", label: "Quietus", school: "bloodless vitae", cost: 20, tags: ["vitae", "calm"], effect: "Stills a racing pulse with a measured rite." },
};

export const SETTING_BIBLE = `Fenwick is a borough where the veil is thin. Humans keep most of the shops, but demons mend carts beside them, angels walk the night watch, and vampires hold honest trades and drink bottled vitae like anyone else's supper.

Magic is uncommon but not secret. Threshold signs chalked over doors, hearths coaxed lit without wood, small charms traded over counters — the street has seen it all and mostly nods along. Nobody duels in the square; signs are for homes and work, not for war.

Two institutions hold the line. The temple keeps the rites, rations vitae to those who thirst, and marries whoever asks. The night market moves everything else: salt, candles, bottled vitae under the counter, and gossip by the pound.

What the borough knows about anyone is common talk. What they keep backstage — their fears, their appetites, the exact terms of an old vow — stays theirs unless they choose to speak it.`;

export const SETTING_LINE = "Fenwick — a borough where the veil is thin.";

export function createDefs(): Defs {
  const trees: Record<string, BtTree> = {};
  for (const t of TREES) trees[t.id] = structuredClone(t);
  return {
    needs: NEEDS.map((n) => ({ ...n })),
    traits: structuredClone(TRAITS),
    jobs: structuredClone(JOBS),
    buildingKinds: shippedKindDefs(),
    ancestries: structuredClone(ANCESTRIES),
    spells: structuredClone(SPELLS),
    goals: structuredClone(GOALS),
    social: structuredClone(SOCIAL),
    trees,
  };
}

/** City footprints per shipped kind. Custom kinds carry their own footprint. */
export const FOOTPRINT: Record<string, { w: number; h: number }> = {
  cottage: { w: 4, h: 3 },
  tavern: { w: 7, h: 5 },
  bakery: { w: 5, h: 4 },
  market: { w: 6, h: 5 },
  temple: { w: 6, h: 6 },
  workshop: { w: 5, h: 4 },
  mill: { w: 5, h: 5 },
  farmhouse: { w: 5, h: 4 },
  guardhouse: { w: 4, h: 4 },
  well: { w: 2, h: 2 },
};

export const SHIPPED_KINDS: BuildingKind[] = [
  "cottage",
  "tavern",
  "bakery",
  "market",
  "temple",
  "workshop",
  "mill",
  "farmhouse",
  "guardhouse",
  "well",
];

const KIND_LABEL: Record<string, string> = {
  cottage: "Cottage",
  tavern: "Tavern",
  bakery: "Bakery",
  market: "Market",
  temple: "Temple",
  workshop: "Workshop",
  mill: "Mill",
  farmhouse: "Farmhouse",
  guardhouse: "Guardhouse",
  well: "Well",
};

const KIND_TAGS: Record<string, string[]> = {
  cottage: ["home"],
  tavern: ["work", "shop", "gather"],
  bakery: ["work", "shop"],
  market: ["work", "shop", "gather"],
  temple: ["work", "worship", "gather"],
  workshop: ["work"],
  mill: ["work"],
  farmhouse: ["home", "work"],
  guardhouse: ["work"],
  well: ["gather"],
};

const KIND_STORIES: Record<string, 1 | 2> = {
  cottage: 2,
  tavern: 2,
  bakery: 2,
  market: 1,
  temple: 1,
  workshop: 1,
  mill: 2,
  farmhouse: 2,
  guardhouse: 2,
  well: 1,
};

const KIND_ROOMS: Record<string, { ground: { kind: string; name: string }[]; upper?: { kind: string; name: string }[] }> = {
  cottage: { ground: [{ kind: "hall", name: "Front room" }, { kind: "bedroom", name: "Bedroom" }], upper: [{ kind: "loft", name: "Loft" }] },
  tavern: { ground: [{ kind: "taproom", name: "Taproom" }, { kind: "kitchen", name: "Kitchen" }], upper: [{ kind: "bedroom", name: "Rooms" }] },
  bakery: { ground: [{ kind: "shop", name: "Shop" }, { kind: "kitchen", name: "Bakehouse" }], upper: [{ kind: "loft", name: "Loft" }] },
  market: { ground: [{ kind: "shop", name: "Stalls" }] },
  temple: { ground: [{ kind: "sanctuary", name: "Nave" }, { kind: "office", name: "Vestry" }] },
  workshop: { ground: [{ kind: "workshop", name: "Shop floor" }, { kind: "office", name: "Office" }] },
  mill: { ground: [{ kind: "mill", name: "Mill floor" }], upper: [{ kind: "loft", name: "Grain loft" }] },
  farmhouse: { ground: [{ kind: "kitchen", name: "Kitchen" }, { kind: "hall", name: "Hearth room" }], upper: [{ kind: "bedroom", name: "Bedrooms" }] },
  guardhouse: { ground: [{ kind: "office", name: "Watch room" }], upper: [{ kind: "bunk", name: "Bunks" }] },
  well: { ground: [{ kind: "well", name: "Well court" }] },
};

function shippedKindDefs(): Record<string, BuildingKindDef> {
  const out: Record<string, BuildingKindDef> = {};
  for (const id of SHIPPED_KINDS) {
    const fp = FOOTPRINT[id] ?? { w: 5, h: 4 };
    out[id] = {
      id,
      label: KIND_LABEL[id] ?? id,
      names: [...(BUILDING_NAMES[id] ?? [])],
      footprint: { ...fp },
      stories: KIND_STORIES[id] ?? 1,
      ground: (KIND_ROOMS[id]?.ground ?? [{ kind: "hall", name: "Hall" }]).map((r) => ({ ...r })),
      upper: KIND_ROOMS[id]?.upper?.map((r) => ({ ...r })),
      doorSide: "any",
      tags: [...(KIND_TAGS[id] ?? [])],
    };
  }
  return out;
}

export const FIRST_NAMES_F = [
  "Mara", "Elise", "Rowan", "Ivy", "Nora", "Celia", "Willa", "Tessa", "Anwen", "Brigid",
  "Lila", "Sable", "Freya", "Juniper", "Odette", "Pia", "Rhea", "Signe", "Thea", "Una",
  "Vera", "Wren", "Ysolde", "Zora", "Agnes", "Beryl", "Clare", "Dora",
];
export const FIRST_NAMES_M = [
  "Tomas", "Ewan", "Gareth", "Bram", "Colm", "Dorian", "Ellis", "Finn", "Gideon", "Harlan",
  "Ivor", "Jules", "Kellan", "Leif", "Magnus", "Niall", "Owen", "Perrin", "Quill", "Rook",
  "Silas", "Torin", "Ulric", "Vesper", "Wynn", "Yorick", "Alden", "Bramble",
];
export const SURNAMES = [
  "Ash", "Bracken", "Crowe", "Dunne", "Elder", "Frost", "Grove", "Hawke", "Ivy", "Joss",
  "Kell", "Lark", "Moss", "Nettle", "Oak", "Pike", "Quill", "Reed", "Stone", "Thorn",
  "Underhill", "Vale", "Wain", "Yarrow", "Bell", "Cartwright", "Miller", "Baker",
];

export const BUILDING_NAMES: Record<string, string[]> = {
  tavern: ["The Ember Cup", "The Quiet Hart", "The Millstone"],
  bakery: ["Hearth Loaf", "Dawn Crust"],
  market: ["Fenwick Market"],
  temple: ["Saint Bramble", "The Low Chapel"],
  workshop: ["Oak & Iron", "Crowe Joinery"],
  mill: ["River Mill", "West Mill"],
  farmhouse: ["South Field", "Bracken Acre", "Nettle Farm"],
  guardhouse: ["Watch Post"],
  well: ["Town Well"],
  cottage: [],
};
