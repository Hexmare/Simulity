import type { Rng } from "./rng.ts";

export const MAP_W = 56;
export const MAP_H = 56;
export const TICKS_PER_HOUR = 60;
export const MINUTES_PER_TICK = 1; // one sim tick is one in-world minute
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
/** Real seconds the canvas accumulates before advancing one sim tick, at speed 1.0. */
export const REAL_SECONDS_PER_TICK = 1;
export const NPC_WALK = 1.65;
export const PLAYER_WALK = 3.4;

export type TileKind =
  | "grass"
  | "dirt"
  | "road"
  | "plaza"
  | "water"
  | "tree"
  | "wall"
  | "floor"
  | "door"
  | "bed"
  | "counter"
  | "altar"
  | "stairs"
  | "hearth"
  | "table"
  | "rug"
  | "crate"
  | "shelf"
  | "pew"
  | "anvil"
  | "window";

/** Building.kind is a catalog UUID (or town-overlay UUID) — never a slug. */
export type Layer = "city" | "interior";
export type Control = "autonomous" | "llm" | "player";
export type Sex = "f" | "m";
export type DoorSide = "n" | "s" | "e" | "w";
export type Orientation = "hetero" | "homo" | "bi" | "ace";
export type BondStatus = "none" | "friend" | "sweetheart" | "partner" | "spouse";

/** Interpreter vocabulary — the only non-UUID references allowed at runtime. */
export const SYS_TOKENS = [
  "sys:home",
  "sys:work",
  "sys:plaza",
  "sys:bed",
  "sys:drink",
  "sys:target",
  "sys:wander",
] as const;

export interface Loc {
  layer: Layer;
  buildingId?: string;
  floor?: number;
  x: number;
  y: number;
}

export type Waypoint = Loc;

export interface NeedDef {
  id: string;
  slug: string;
  label: string;
  decayPerHour: number;
  criticalBelow: number;
}

export interface TraitDef {
  id: string;
  slug: string;
  label: string;
  /** Keys are need / social-action / goal UUIDs. */
  modifiers: {
    needDecay?: Record<string, number>;
    socialHit?: Record<string, number>;
    utility?: Record<string, number>;
  };
}

/** Commodity rows drive stock keys, prices and work verbs. */
export interface CommodityDef {
  id: string;
  slug: string;
  label: string;
  price?: number;
  /** Past-tense verb for work logs ("baked bread"). Missing = "made {label}". */
  verb?: string;
}

/**
 * JobDef.workplace is a kind UUID, or the tokens `sys:home` / `sys:plaza`.
 * produces/consumes keys are commodity UUIDs. `coin` slug = currency.
 */
export interface JobDef {
  id: string;
  slug: string;
  label: string;
  workplace: string;
  startHour: number;
  endHour: number;
  palette: number;
  produces?: Record<string, number>;
  consumes?: Record<string, number>;
  wage?: number;
}

export type AncestryMark = "none" | "halo" | "horns" | "fangs";

export interface AncestryDef {
  id: string;
  slug: string;
  label: string;
  plural: string;
  /** Added to the soul's palette index for canvas tint. */
  paletteBias: number;
  mark: AncestryMark;
  /** Roster weighting when picking a random ancestry (relative). */
  weight: number;
  /** Short lore line used in narrative + LLM snapshots. */
  note?: string;
  /** Multipliers on need decay, keyed by need UUID. */
  needModifiers: Record<string, number>;
  resource?: string;
  /** Optional thirst: decay per hour + the commodity UUID that slakes it. */
  thirst?: { good: string; decayPerHour: number };
  essenceCap: number;
  essenceRegen: number;
  tags: string[];
}

export interface SpellDef {
  id: string;
  slug: string;
  label: string;
  school: string;
  cost: number;
  tags: string[];
  effect: string;
}

export interface RoomTemplate {
  kind: string;
  name?: string;
}

/** Interior recipe cells (data, not code): rooms and v/h splits. */
export interface RoomCell {
  t: "room";
  kind: string;
  name?: string;
}

export interface SplitCell {
  /** v = vertical split (left/right), h = horizontal split (top/bottom). */
  t: "v" | "h";
  /** Omitted = random position. */
  at?: number;
  a: InteriorCell;
  b: InteriorCell;
}

export type InteriorCell = RoomCell | SplitCell;

/** One explicit floor layout variant. Omitted w/h fall back to def footprint. */
export interface FloorLayout {
  w?: number;
  h?: number;
  ground?: InteriorCell;
  upper?: InteriorCell;
}

export interface FurniturePlanItem {
  tile: TileKind;
  roomKind: string;
  count?: number;
  tags?: string[];
}

export interface BuildingKindDef {
  id: string;
  slug: string;
  label: string;
  names: string[];
  footprint: { w: number; h: number };
  /** Preferred roof tint index. Omitted = random. */
  roof?: number;
  stories: 1 | 2;
  ground: RoomTemplate[];
  upper?: RoomTemplate[];
  /** Street-door rule: which map side faces the road. `any` = nearest road. */
  doorSide?: DoorSide | "any";
  tags: string[];
  /** Explicit layout variants (rng-picked); no clamping of given w/h. */
  layouts?: FloorLayout[];
  /** Extra furniture beyond per-room-kind defaults, compiled from data. */
  furniturePlan?: FurniturePlanItem[];
  /** Starting stock by commodity UUID when the building is generated. */
  stockDefaults?: Record<string, number>;
}

export interface Consideration {
  kind: "need" | "schedule" | "timeBand" | "constant" | "nearbyPeople";
  needId?: string;
  weight: number;
  curve?: "inverse" | "inverse_quadratic" | "linear";
  startHour?: number;
  endHour?: number;
  value?: number;
}

export interface GoalDef {
  id: string;
  slug: string;
  label: string;
  treeId: string;
  considerations: Consideration[];
}

export interface RelDelta {
  friendship?: number;
  romance?: number;
  trust?: number;
  grudge?: number;
  familiarity?: number;
  mood?: number;
  targetMood?: number;
}

export interface SocialActionDef {
  id: string;
  slug: string;
  label: string;
  dc: number;
  tags: string[];
  requires?: {
    minFriendship?: number;
    maxGrudge?: number;
    minFamiliarity?: number;
  };
  socialRestore: number;
  targetSocial?: number;
  outcomes: {
    great: RelDelta;
    success: RelDelta;
    fail: RelDelta;
    critFail: RelDelta;
  };
}

export type BtNodeType = "sequence" | "selector" | "inverter" | "condition" | "action";

export interface BtNode {
  id: string;
  type: BtNodeType;
  children?: string[];
  child?: string;
  cond?: string;
  action?: string;
  params?: Record<string, string | number | boolean>;
  label?: string;
}

export interface BtTree {
  id: string;
  slug: string;
  name: string;
  root: string;
  nodes: Record<string, BtNode>;
}

export interface Rel {
  familiarity: number;
  friendship: number;
  romance: number;
  trust: number;
  grudge: number;
}

export interface Bond {
  a: string;
  b: string;
  status: BondStatus;
  sinceTick: number;
}

/** Consent record: donor allows drinker to feed. Directional. */
export interface Donor {
  donor: string;
  drinker: string;
  sinceTick: number;
}

export interface Blackboard {
  needs: Record<string, number>;
  mood: number;
  traits: string[];
  jobId: string;
  homeId: string;
  workId: string | null;
  householdId: string;
  food: number;
  essence: number;
  spells: string[];
  goalId: string | null;
  goalLock: number;
  treeId: string | null;
  btCursor: Record<string, number>;
  runningNodeId: string | null;
  lastStatus: string | null;
  control: Control;
  path: Waypoint[] | null;
  pathI: number;
  destKey: string | null;
  socialCooldown: number;
  lastSocialTarget: string | null;
  waitTicks: number;
  knowledge: string[];
}

export interface Npc {
  id: string;
  name: string;
  kind: "npc" | "pc";
  sex: Sex;
  age: number;
  orientation: Orientation;
  parentIds: string[];
  spouseId?: string;
  ancestryId: string;
  narrative: { public: string; private: string; voice: string };
  palette: number;
  portrait?: string;
  /** Coin on the soul. Earned via wages, spent on meals. */
  coin: number;
  loc: Loc;
  px: number;
  py: number;
  facing: number;
  speed: number;
  bb: Blackboard;
  relationships: Record<string, Rel>;
}

export interface Room {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ownerId?: string;
  ownerIds?: string[];
}

export interface FurnitureItem {
  id: string;
  kind: TileKind;
  x: number;
  y: number;
  floor: number;
  ownerId?: string;
  allowsTwo?: boolean;
}

export interface Stair {
  x: number;
  y: number;
  toFloor: number;
  toX: number;
  toY: number;
}

export interface Floor {
  index: number;
  name: string;
  w: number;
  h: number;
  tiles: TileKind[];
  rooms: Room[];
  door?: { x: number; y: number };
  stairs: Stair[];
  beds: { x: number; y: number }[];
  spots: { x: number; y: number }[];
  furniture: FurnitureItem[];
}

export interface Building {
  id: string;
  /** Catalog kind UUID (or town-overlay kind UUID) — never a slug. */
  kind: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  entrance: { x: number; y: number };
  doorSide: DoorSide;
  roof: number;
  floors: Floor[];
  /** Goods on the shelves, keyed by commodity UUID. */
  stock: Record<string, number>;
  /** The till. Wages come out of it; sales go into it. */
  coffer: number;
}

/** Furnishing kit entry (defaults per room kind; see interiors.ts FURNITURE_CATALOG). */
export interface FurnitureDef {
  id: string;
  label: string;
  tile: TileKind;
  roomKinds: string[];
  tags: string[];
  allowsTwo?: boolean;
}

export interface MapGrid {
  w: number;
  h: number;
  tiles: TileKind[];
  blocked: Uint8Array;
}

export interface ChronicleEvent {
  id: number;
  tick: number;
  type: string;
  actorId: string;
  targetId?: string;
  buildingId?: string;
  summary: string;
  source: "sim" | "llm";
}

export interface RoleplayDeltas {
  needs?: Record<string, number>;
  mood?: number;
  relationships?: Record<string, Partial<Rel>>;
  location?: Loc;
  events?: { type: string; summary: string; targetId?: string }[];
  knowledge?: string[];
}

export interface NamesCollection {
  firstF: string[];
  firstM: string[];
  surnames: string[];
}

/** Setting row: flavor line + world bible for LLM prompts. */
export interface SettingRow {
  id: string;
  slug?: string;
  label?: string;
  line: string;
  bible: string;
}

/**
 * Generation kit (content/kits/*.json): what a fresh town builds and who lives in it.
 * All references are UUIDs from the catalog.
 */
export interface KitBuildingEntry {
  kindId: string;
  count: number;
}

export interface KitRosterEntry {
  jobId: string;
  count: number;
  /** Age range for roster members. Omitted = adult default. */
  ages?: [number, number];
}

export interface Kit {
  id: string;
  slug: string;
  label: string;
  settingId?: string;
  buildings: KitBuildingEntry[];
  /** Kind UUIDs that receive residents (must be home-tagged). */
  homes: string[];
  roster: KitRosterEntry[];
  /** Fallback job for the PC, new villagers and reassignments. */
  defaultPcJobId: string;
  pcAge: number;
  unnamedHomePattern: string;
}

export interface Defs {
  needs: NeedDef[];
  /** Commodity rows by id (stock keys / price & verb lookups). Slug→id via the GOOD map. */
  commodities: Record<string, CommodityDef>;
  traits: Record<string, TraitDef>;
  jobs: Record<string, JobDef>;
  buildingKinds: Record<string, BuildingKindDef>;
  ancestries: Record<string, AncestryDef>;
  spells: Record<string, SpellDef>;
  goals: GoalDef[];
  social: Record<string, SocialActionDef>;
  trees: Record<string, BtTree>;
  names: NamesCollection;
  /** Active setting (kit.settingId, else the first shipped row). */
  setting: SettingRow;
}

/** Town-authored overrides. Later wins on the same UUID; deletion is explicit. */
export interface OverlayRows<T> {
  rows: Record<string, T>;
  removedIds: string[];
}

export interface DefsOverlay {
  jobs: OverlayRows<JobDef>;
  buildings: OverlayRows<BuildingKindDef>;
  ancestries: OverlayRows<AncestryDef>;
  spells: OverlayRows<SpellDef>;
}

export interface WorldTime {
  tick: number;
  day: number;
  hour: number;
  minute: number;
  hourFloat: number;
  period: "night" | "dawn" | "day" | "dusk";
}

export interface SimHost {
  defs: Defs;
  map: MapGrid;
  buildings: Building[];
  bonds: Bond[];
  donors: Donor[];
  rng: Rng;
  events: ChronicleEvent[];
  townPurse: number;
  /** Display name of this town (e.g. "Fenwick Ward"). */
  townName: string;
  npc(id: string): Npc | undefined;
  building(id?: string): Building | undefined;
  people(): Npc[];
  time(): WorldTime;
  log(e: Omit<ChronicleEvent, "id" | "tick">): void;
}
