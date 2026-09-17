import type { Rng } from "./rng";

export const MAP_W = 56;
export const MAP_H = 56;
export const TICKS_PER_HOUR = 12;
export const MINUTES_PER_TICK = 5;
export const TICKS_PER_DAY = 24 * TICKS_PER_HOUR;
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

export type BuildingKind =
  | "cottage"
  | "tavern"
  | "bakery"
  | "market"
  | "temple"
  | "workshop"
  | "mill"
  | "farmhouse"
  | "guardhouse"
  | "well";

export type Layer = "city" | "interior";
export type Control = "autonomous" | "llm" | "player";
export type Sex = "f" | "m";
export type DoorSide = "n" | "s" | "e" | "w";
export type Orientation = "hetero" | "homo" | "bi" | "ace";
export type BondStatus = "none" | "friend" | "sweetheart" | "partner" | "spouse";

export interface Loc {
  layer: Layer;
  buildingId?: string;
  floor?: number;
  x: number;
  y: number;
}

export interface Waypoint extends Loc {}

export interface NeedDef {
  id: string;
  label: string;
  decayPerHour: number;
  criticalBelow: number;
}

export interface TraitDef {
  id: string;
  label: string;
  modifiers: {
    needDecay?: Record<string, number>;
    socialHit?: Record<string, number>;
    utility?: Record<string, number>;
  };
}

export interface JobDef {
  id: string;
  label: string;
  workplace: string;
  startHour: number;
  endHour: number;
  palette: number;
  /** Wave 5 economy hooks. Stored now, inert until Wave 5. */
  produces?: Record<string, number>;
  consumes?: Record<string, number>;
  wage?: number;
}

export type AncestryMark = "none" | "halo" | "horns" | "fangs";

export interface AncestryDef {
  id: string;
  label: string;
  plural: string;
  /** Added to the soul's palette index for canvas tint. */
  paletteBias: number;
  mark: AncestryMark;
  /** Multipliers on need decay (e.g. demons hunger slower). */
  needModifiers: Record<string, number>;
  /** Extra resource id reserved for later (vitae | grace | ember). */
  resource?: string;
  /** Vampire-only for now: thirst decay per hour + the good that slakes it. */
  thirst?: { good: string; decayPerHour: number };
  essenceCap: number;
  essenceRegen: number;
  tags: string[];
  overlay?: boolean;
}

export interface SpellDef {
  id: string;
  label: string;
  school: string;
  cost: number;
  tags: string[];
  effect: string;
  overlay?: boolean;
}

export interface RoomTemplate {
  kind: string;
  name: string;
}

export interface BuildingKindDef {
  id: string;
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
  /** True for borough-authored (overlay) kinds; shipped kinds are first-class. */
  overlay?: boolean;
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

export interface FurnitureDef {
  id: string;
  label: string;
  tile: TileKind;
  roomKinds: string[];
  tags: string[];
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
  /** Goods on the shelves. `food` = servable meals, same unit as carried `bb.food`. */
  stock: Record<string, number>;
  /** The till. Wages come out of it; sales go into it. */
  coffer: number;
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

export interface Defs {
  needs: NeedDef[];
  traits: Record<string, TraitDef>;
  jobs: Record<string, JobDef>;
  buildingKinds: Record<string, BuildingKindDef>;
  ancestries: Record<string, AncestryDef>;
  spells: Record<string, SpellDef>;
  goals: GoalDef[];
  social: Record<string, SocialActionDef>;
  trees: Record<string, BtTree>;
}

/** Overlay defs live on the town save so custom kinds/jobs survive reload. */
export interface DefsOverlay {
  jobs: Record<string, JobDef>;
  buildings: Record<string, BuildingKindDef>;
  ancestries: Record<string, AncestryDef>;
  spells: Record<string, SpellDef>;
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
  npc(id: string): Npc | undefined;
  building(id?: string): Building | undefined;
  people(): Npc[];
  time(): WorldTime;
  log(e: Omit<ChronicleEvent, "id" | "tick">): void;
}
