import { advanceAlongPath, applyDeltas, decayNeeds, isAsleep, selectGoal, snapshotNpc, tickTree } from "./ai.ts";
import { ANCESTRY, GOOD, JOBS, buildDefs, FIRST_KIND, NEED, SHIPPED_BUSINESS_TYPE_IDS, SHIPPED_COMMODITY_IDS, SHIPPED_GARMENT_IDS, SHIPPED_GOAL_IDS, SHIPPED_JOB_IDS, SHIPPED_KIND_IDS, SHIPPED_NEED_IDS, SHIPPED_SOCIAL_IDS, SHIPPED_TRAIT_IDS, SYS } from "./defs.ts";
import { DEFAULT_KIT_ID, getKit, getKitSafe, getKitWithCustom } from "./kits.ts";
import { generateWorld, placeBuildingOnMap, PORTRAITS_F, PORTRAITS_M, uid, dressSoul, makeAppearance, makeSecrets } from "./gen.ts";
import { emptyWorn } from "./clothing.ts";
import { allBeds, floorOf, roomAt, stairAt, streetDoor } from "./interiors.ts";
import {
  KNOWN_TAGS,
  agesAdult,
  applyLibraryDefs,
  blankOverlay,
  buildingsMatchingWorkplace,
  hasWorkplace,
  homeKindIds,
  isUuidV4,
  kindLabel,
  knownWorkplaces,
  matchWorkplace,
  resolveWorkId,
  slugId,
  validateBusinessTypeDef,
  validateGarmentDef,
  validateJobDef,
  validateKindDef,
  validateKit,
  validateSimpleRow,
} from "./custom.ts";
import { ensureNarrative } from "./narrative.ts";
import { ensureBuildingEconomy, ensureSoulEconomy, priceOf, seedEconomy } from "./economy.ts";
import {
  addBasement as planAddBasement,
  addFloorAbove as planAddFloor,
  assignBedOwner as planAssignBed,
  assignRoomOwner as planAssignRoom,
  bedAssignmentOf as planBedOf,
  claimFreeBed as planClaimBed,
  deleteRoom as planDeleteRoom,
  ensureFurniture,
  linkStairPair as planLinkStairs,
  nearestWalkable,
  paintTile as planPaint,
  placeFurniture as planPlaceFurniture,
  removeFloor as planRemoveFloor,
  removeFurniture as planRemoveFurniture,
  renameRoom as planRenameRoom,
  setRoomRect as planSetRoom,
  setStreetDoor as planSetDoor,
  unassignSoulBeds as planUnassign,
  validateBuilding as planValidate,
  validateFloor as planValidateFloor,
} from "./plan.ts";
import {
  areBloodKin,
  clampAge,
  getBond,
  isRomanticStatus,
  normalizeSoul,
  pickAncestry,
  pickOrientation,
  setBond,
  soulsOf,
  walkSpeed,
} from "./kin.ts";
import { cityWalkable, idx, insideOf, interiorWalkable, locFromBody, planRoute, streetStand, trimLeadingWaypoints } from "./nav.ts";
import { chance, mulberry32, pick, randInt, shuffle, type Rng } from "./rng.ts";
import type { TownSave } from "./persist.ts";
import type {
  AncestryDef,
  Bond,
  BtTree,
  Building,
  BuildingKindDef,
  BusinessTypeDef,
  ChronicleEvent,
  ClothingItem,
  ClothingSlot,
  CommodityDef,
  Defs,
  DefsOverlay,
  Donor,
  GarmentDef,
  GoalDef,
  JobDef,
  Kit,
  Loc,
  MapGrid,
  NeedDef,
  Npc,
  Orientation,
  RoleplayDeltas,
  Sex,
  SimHost,
  SocialActionDef,
  SpellDef,
  Stair,
  TileKind,
  TraitDef,
  WorldTime,
} from "./types.ts";
import { MINUTES_PER_TICK, TICKS_PER_DAY, TICKS_PER_HOUR } from "./types.ts";

function emptyDefsOverlay(): DefsOverlay {
  return blankOverlay();
}

export class World implements SimHost {
  seed: number;
  rng: Rng;
  defs: Defs;
  /** Generation kit in use (content/kits/*). Catalog rows live in content/; kits only parameterize the town. */
  kitId: string = DEFAULT_KIT_ID;
  /** Ward-authored overlay defs (custom kinds/jobs, deletions of shipped rows). Merged into defs; persisted on the save. */
  defsOverlay: DefsOverlay = emptyDefsOverlay();
  map: MapGrid;
  buildings: Building[];
  npcs: Npc[];
  player: Npc;
  /** Physical clothing items: worn, in rooms, or stored in wardrobes. */
  clothing: ClothingItem[] = [];
  bonds: Bond[] = [];
  donors: Donor[] = [];
  events: ChronicleEvent[] = [];
  tickIndex = 8 * TICKS_PER_HOUR;
  /** Sim seconds since founding. Scene-live ticks add 1s; autonomous ticks add 60s. */
  simSeconds = 8 * 3600;
  /** True while any scene is open (Hide counts): 1 tick = 1 sim second. Session-only. */
  sceneClock = false;
  /** Sim minutes advanced per tick (SimHost): 1 autonomous, 1/60 while a scene is live. */
  minutesPerTick = 1;
  private lastDawnDay = 1;
  eventSeq = 0;
  townPurse = 100;
  /** Living-world bible for the active setting (LLM prompt context). */
  settingBible: string;
  speed = 1;
  paused = false;
  pendingEnter: string | null = null;
  pendingExit = false;
  pendingStair: Stair | null = null;
  pendingBuy: { x: number; y: number; floor: number } | null = null;
  transitLock = 0;
  townId: string;
  townName: string;
  createdAt: number;
  private npcMap = new Map<string, Npc>();
  private bMap = new Map<string, Building>();

  constructor(seed = 1742, kitId?: string, opts?: { population?: number; kit?: Kit; customCatalog?: Record<string, unknown[]> }) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    const kit = opts?.kit ?? getKitWithCustom(kitId ?? DEFAULT_KIT_ID, []);
    this.kitId = kit.id;
    this.defs = buildDefs(kit);
    if (opts?.customCatalog) applyLibraryDefs(this.defs, this.defsOverlay, opts.customCatalog, kit.settingId);
    this.townId = uid();
    this.townName = kit.label;
    this.settingBible = this.defs.setting.bible;
    this.createdAt = Date.now();
    const g = generateWorld(this.rng, this.defs, kit, opts?.population != null ? { population: opts.population } : undefined);
    this.map = g.map;
    this.buildings = g.buildings;
    this.npcs = g.npcs;
    this.player = g.player;
    this.clothing = g.clothing;
    this.bonds = g.bonds;
    this.townPurse = 100;
    seedEconomy(this);
    this.reindex();
    this.log({
      type: "dawn",
      actorId: "world",
      summary: `${this.townName} wakes. ${this.npcs.length} souls, ${this.buildings.length} buildings.`,
      source: "sim",
    });
  }

  /**
   * Scene clock (Scene spec §4): while any scene is open the whole live session
   * runs at 1 tick = 1 sim second; on End it returns to 1 minute/tick.
   * Queued BT waits are sim-minutes, so they are rescaled across the switch.
   */
  setSceneClock(on: boolean) {
    if (on === this.sceneClock) return;
    this.sceneClock = on;
    this.minutesPerTick = on ? 1 / 60 : 1;
    for (const n of [...this.npcs, this.player]) {
      if (n.bb.waitTicks > 0) {
        n.bb.waitTicks = on ? n.bb.waitTicks * 60 : Math.max(1, Math.ceil(n.bb.waitTicks / 60));
      }
      if (n.bb.goalLock > 0) {
        n.bb.goalLock = on ? n.bb.goalLock * 60 : Math.max(0, Math.ceil(n.bb.goalLock / 60));
      }
      if (n.bb.socialCooldown > 0) {
        n.bb.socialCooldown = on ? n.bb.socialCooldown * 60 : Math.max(0, Math.ceil(n.bb.socialCooldown / 60));
      }
    }
  }

  static fromSave(save: TownSave, opts?: { live?: boolean }): World {
    const w = Object.create(World.prototype) as World;
    w.seed = save.seed;
    w.rng = mulberry32(save.seed);
    if (typeof save.rngState === "number") w.rng.setState(save.rngState >>> 0);
    let kit;
    try {
      kit = getKit(typeof save.kitId === "string" && save.kitId ? save.kitId : DEFAULT_KIT_ID);
    } catch {
      kit = getKit(DEFAULT_KIT_ID); // Saved kit unknown (future content) — fall back to the default ward.
    }
    w.kitId = kit.id;
    w.defs = buildDefs(kit.id);
    if (save.trees) w.defs.trees = save.trees;
    w.settingBible = typeof save.settingBible === "string" && save.settingBible.trim() ? save.settingBible : w.defs.setting.bible;
    w.defsOverlay = emptyDefsOverlay();
    const ovIn = save.defsOverlay as unknown as Record<string, { rows?: Record<string, never>; removedIds?: string[] } | undefined> | undefined;
    const mergeRows = <T extends { id: string }>(col: keyof DefsOverlay, defsCol: Record<string, T>) => {
      for (const [id, row] of Object.entries(ovIn?.[col]?.rows ?? {})) {
        if (row && typeof (row as T).id === "string" && (row as T).id === id) {
          (defsCol as Record<string, T>)[id] = { ...(row as T) };
          ((w.defsOverlay[col] as unknown as { rows: Record<string, T> }).rows)[id] = { ...(row as T) };
        }
      }
    };
    mergeRows("jobs", w.defs.jobs);
    mergeRows("buildings", w.defs.buildingKinds);
    mergeRows("ancestries", w.defs.ancestries);
    mergeRows("spells", w.defs.spells);
    mergeRows("businessTypes", w.defs.businessTypes);
    mergeRows("garments", w.defs.garments);
    mergeRows("commodities", w.defs.commodities);
    mergeRows("traits", w.defs.traits);
    mergeRows("social", w.defs.social);
    {
      const needRows = (ovIn?.needs?.rows ?? {}) as Record<string, NeedDef>;
      const nextNeeds = w.defs.needs.filter((n) => !(ovIn?.needs?.removedIds ?? []).includes(n.id));
      for (const [id, row] of Object.entries(needRows)) {
        if (row && row.id === id) {
          const at = nextNeeds.findIndex((n) => n.id === id);
          if (at >= 0) nextNeeds[at] = { ...row };
          else nextNeeds.push({ ...row });
          w.defsOverlay.needs.rows[id] = { ...row };
        }
      }
      w.defs.needs = nextNeeds;
      for (const id of ovIn?.needs?.removedIds ?? []) {
        if (!w.defsOverlay.needs.removedIds.includes(id)) w.defsOverlay.needs.removedIds.push(id);
      }
    }
    {
      const goalRows = (ovIn?.goals?.rows ?? {}) as Record<string, GoalDef>;
      for (const [id, row] of Object.entries(goalRows)) {
        if (row && row.id === id) {
          const at = w.defs.goals.findIndex((g) => g.id === id);
          if (at >= 0) w.defs.goals[at] = { ...row };
          else w.defs.goals.push({ ...row });
          w.defsOverlay.goals.rows[id] = { ...row };
        }
      }
      const removedGoals = new Set(ovIn?.goals?.removedIds ?? []);
      if (removedGoals.size) w.defs.goals = w.defs.goals.filter((g) => !removedGoals.has(g.id));
      for (const id of removedGoals) {
        if (!w.defsOverlay.goals.removedIds.includes(id)) w.defsOverlay.goals.removedIds.push(id);
      }
    }
    // Deletion of shipped rows is explicit: removedIds wins over any overlaid row.
    const removedCols: Array<[keyof DefsOverlay, "jobs" | "buildingKinds" | "ancestries" | "spells" | "businessTypes" | "garments" | "commodities" | "traits" | "social"]> = [
      ["jobs", "jobs"],
      ["buildings", "buildingKinds"],
      ["ancestries", "ancestries"],
      ["spells", "spells"],
      ["businessTypes", "businessTypes"],
      ["garments", "garments"],
      ["commodities", "commodities"],
      ["traits", "traits"],
      ["social", "social"],
    ];
    for (const [ovCol, defsCol] of removedCols) {
      for (const id of ovIn?.[ovCol]?.removedIds ?? []) {
        delete (w.defs[defsCol] as Record<string, unknown>)[id];
        delete (w.defsOverlay[ovCol] as unknown as { rows: Record<string, unknown> }).rows[id];
        if (!(w.defsOverlay[ovCol] as unknown as { removedIds: string[] }).removedIds.includes(id)) {
          (w.defsOverlay[ovCol] as unknown as { removedIds: string[] }).removedIds.push(id);
        }
      }
    }
    w.townId = save.id;
    w.townName = save.name;
    w.createdAt = save.createdAt || Date.now();
    w.map = {
      w: save.map.w,
      h: save.map.h,
      tiles: save.map.tiles.slice(),
      blocked: Uint8Array.from(save.map.blocked),
    };
    w.buildings = save.buildings.map((b) => ({
      ...b,
      businessTypeId: typeof b.businessTypeId === "string" ? b.businessTypeId : null,
      floors: b.floors.map((f) => ({
        ...f,
        tiles: f.tiles.slice(),
        rooms: f.rooms.map((r) => ({ ...r })),
        stairs: f.stairs.map((s) => ({ ...s })),
        beds: f.beds.map((bed) => ({ ...bed })),
        spots: f.spots.map((s) => ({ ...s })),
        furniture: Array.isArray((f as { furniture?: unknown }).furniture)
          ? (f as unknown as { furniture: { id: string; kind: TileKind; x: number; y: number; floor: number; ownerId?: string }[] }).furniture.map((item) => ({ ...item }))
          : [],
      })),
    }));
    w.npcs = save.npcs.map((n) => ({
      ...n,
      appearance: typeof n.appearance === "string" ? n.appearance : "",
      secrets: typeof n.secrets === "string" ? n.secrets : "",
      concealed: typeof n.concealed === "boolean" ? n.concealed : !(w.defs.ancestries[n.ancestryId]?.mundane ?? false),
      worn: n.worn ?? emptyWorn(),
      bb: {
        ...n.bb,
        path: n.bb.path ?? null,
        pathI: n.bb.pathI ?? 0,
        destKey: n.bb.destKey ?? null,
        control: opts?.live ? n.bb.control : n.bb.control === "llm" ? "autonomous" : n.bb.control,
        usingId: (n.bb as unknown as { usingId?: string | null }).usingId ?? null,
        pose: ((n.bb as unknown as { pose?: string }).pose as "stand" | "sit" | "sleep") ?? "stand",
        memory: Array.isArray((n.bb as unknown as { memory?: unknown }).memory) ? ((n.bb as unknown as { memory: [] }).memory as []) : [],
        tasks: Array.isArray((n.bb as unknown as { tasks?: unknown }).tasks) ? ((n.bb as unknown as { tasks: [] }).tasks as []) : [],
      },
      relationships: { ...n.relationships },
      parentIds: Array.isArray(n.parentIds) ? n.parentIds.slice() : [],
    }));
    w.player = {
      ...save.player,
      appearance: typeof save.player.appearance === "string" ? save.player.appearance : "",
      secrets: typeof save.player.secrets === "string" ? save.player.secrets : "",
      concealed: typeof save.player.concealed === "boolean" ? save.player.concealed : false,
      worn: save.player.worn ?? emptyWorn(),
      bb: {
        ...save.player.bb,
        path: null,
        pathI: 0,
        destKey: null,
        control: "player",
        usingId: null,
        pose: "stand" as const,
        memory: [],
        tasks: [],
      },
      relationships: { ...save.player.relationships },
      parentIds: Array.isArray(save.player.parentIds) ? save.player.parentIds.slice() : [],
    };
    w.bonds = (save.bonds ?? []).map((b) => ({ ...b }));
    w.clothing = Array.isArray(save.clothing)
      ? save.clothing
          .filter((c) => c && typeof c.id === "string" && typeof c.defId === "string" && typeof c.ownerId === "string")
          .map((c) => ({ ...c }))
      : [];
    {
      // Drop worn pointers at missing items; missing fields default empty.
      const have = new Set(w.clothing.map((c) => c.id));
      for (const n of [...w.npcs, w.player]) {
        if (!n.worn) n.worn = emptyWorn();
        for (const slot of Object.keys(n.worn) as ClothingSlot[]) {
          const id = n.worn[slot];
          if (id && !have.has(id)) n.worn[slot] = null;
        }
      }
    }
    w.donors = Array.isArray((save as { donors?: unknown }).donors)
      ? ((save as { donors?: Donor[] }).donors ?? []).filter((d) => d && typeof d.donor === "string" && typeof d.drinker === "string").map((d) => ({ ...d }))
      : [];
    w.events = (save.events ?? []).slice();
    w.tickIndex = save.tickIndex ?? 0;
    w.simSeconds = typeof save.simSeconds === "number" && Number.isFinite(save.simSeconds) ? save.simSeconds : w.tickIndex * 60;
    w.sceneClock = false;
    w.minutesPerTick = 1;
    {
      const t = w.time();
      w.lastDawnDay = t.hour > 6 || (t.hour === 6 && t.minute > 0) ? t.day : t.day - 1;
    }
    w.eventSeq = save.eventSeq ?? w.events.length;
    w.townPurse = typeof save.purse === "number" && Number.isFinite(save.purse) ? Math.max(0, Math.floor(save.purse)) : 50;
    w.speed = 1;
    w.paused = false;
    w.pendingEnter = null;
    w.pendingExit = false;
    w.pendingStair = null;
    w.pendingBuy = null;
    w.transitLock = 0;
    w.npcMap = new Map();
    w.bMap = new Map();
    w.reindex();
    for (const b of w.buildings) ensureFurniture(b);
    for (const b of w.buildings) ensureBuildingEconomy(b);
    for (const n of [...w.npcs, w.player]) ensureSoulEconomy(n);
    const humanId = w.defs.ancestries[ANCESTRY.human]?.id ?? Object.keys(w.defs.ancestries)[0]!;
    for (const n of [w.player, ...w.npcs]) {
      if (!n.ancestryId || !w.defs.ancestries[n.ancestryId]) n.ancestryId = humanId;
      if (!Array.isArray(n.bb.spells)) n.bb.spells = [];
      if (typeof n.bb.essence !== "number" || !Number.isFinite(n.bb.essence)) n.bb.essence = 50;
      const jobLabel = w.defs.jobs[n.bb.jobId]?.label ?? w.defs.jobs[kit.defaultPcJobId]?.label ?? "Worker";
      ensureNarrative(n, w.rng, jobLabel, w.building(n.bb.homeId)?.name ?? w.townName);
    }
    const validJobs = new Set(Object.keys(w.defs.jobs));
    let normalized = 0;
    for (const n of [w.player, ...w.npcs]) {
      if (normalizeSoul(n, validJobs, kit.defaultPcJobId).grewUp) normalized++;
    }
    if (normalized > 0) {
      w.log({
        type: "data",
        actorId: "world",
        summary: `${w.townName} quietly tidies up — adults only, known trades.`,
        source: "sim",
      });
    }
    return w;
  }

  reindex() {
    this.npcMap.clear();
    for (const n of this.npcs) this.npcMap.set(n.id, n);
    this.npcMap.set(this.player.id, this.player);
    this.bMap.clear();
    for (const b of this.buildings) this.bMap.set(b.id, b);
  }

  npc(id: string) {
    return this.npcMap.get(id);
  }

  building(id?: string) {
    if (!id) return undefined;
    return this.bMap.get(id);
  }

  people(): Npc[] {
    return this.npcs;
  }

  time(): WorldTime {
    const tick = this.tickIndex;
    const secs = Math.max(0, Math.floor(this.simSeconds));
    const day = Math.floor(secs / 86400) + 1;
    const tod = secs % 86400;
    const hourFloat = tod / 3600;
    const hour = Math.floor(tod / 3600);
    const minute = Math.floor((tod % 3600) / 60);
    const period: WorldTime["period"] =
      hourFloat >= 21 || hourFloat < 5 ? "night" : hourFloat < 7 ? "dawn" : hourFloat >= 19 ? "dusk" : "day";
    return { tick, day, hour, minute, hourFloat, period };
  }

  log(e: Omit<ChronicleEvent, "id" | "tick">) {
    this.events.push({ id: ++this.eventSeq, tick: this.tickIndex, ...e });
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  step() {
    this.tickIndex++;
    // Scene-live ticks are sim seconds; autonomous ticks are sim minutes.
    this.simSeconds += this.sceneClock ? 1 : 60;
    const t = this.time();
    if (t.hour === 6 && t.minute === 0 && this.lastDawnDay !== t.day) {
      this.lastDawnDay = t.day;
      this.log({ type: "dawn", actorId: "world", summary: `Day ${t.day} dawns over ${this.townName}.`, source: "sim" });
    }
    for (const n of this.npcs) {
      if (n.bb.socialCooldown > 0) n.bb.socialCooldown--;
      decayNeeds(this, n, { asleep: isAsleep(this, n) });
      if (n.bb.control === "llm") {
        advanceAlongPath(n, MINUTES_PER_TICK);
        continue;
      }
      selectGoal(this, n);
      tickTree(this, n);
      if (n.bb.control === "autonomous") advanceAlongPath(n, MINUTES_PER_TICK);
    }
  }

  animate(dt: number) {
    // §1.2/§1.3: the sim clock in step() owns autonomous travel (one tick = one
    // minute, so positions update once per tick). This real-time hook only decays
    // the transit lock; it never advances paths, decides arrivals, or completes move-to.
    if (this.transitLock > 0) this.transitLock = Math.max(0, this.transitLock - dt);
  }

  nearEntrance(b: Building, radius = 1.2) {
    if (this.player.loc.layer !== "city") return false;
    return Math.hypot(this.player.px - (b.entrance.x + 0.5), this.player.py - (b.entrance.y + 0.5)) <= radius;
  }

  buildingAtTile(x: number, y: number) {
    return this.buildings.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
  }

  closestEntrance(radius = 1.25) {
    if (this.player.loc.layer !== "city") return undefined;
    const p = this.player;
    const fx = Math.cos(p.facing);
    const fy = Math.sin(p.facing);
    let best: Building | undefined;
    let bestScore = -Infinity;
    for (const b of this.buildings) {
      const d = Math.hypot(p.px - (b.entrance.x + 0.5), p.py - (b.entrance.y + 0.5));
      if (d > radius) continue;
      const bx = b.x + b.w / 2 - p.px;
      const by = b.y + b.h / 2 - p.py;
      const len = Math.hypot(bx, by) || 1;
      const facing = (bx / len) * fx + (by / len) * fy;
      const onStep = Math.floor(p.px) === b.entrance.x && Math.floor(p.py) === b.entrance.y ? 2 : 0;
      const score = onStep + facing - d * 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  doorPrompt(): { mode: "enter" | "leave" | "stairs"; name: string; id: string } | null {
    const p = this.player;
    if (p.loc.layer === "interior") {
      const b = this.building(p.loc.buildingId);
      if (!b) return null;
      const fl = floorOf(b, p.loc.floor ?? 0);
      const st = this.nearStair(b);
      if (st) {
        const dest = floorOf(b, st.toFloor);
        return { mode: "stairs", name: dest.name, id: b.id };
      }
      const room = roomAt(fl, Math.floor(p.px), Math.floor(p.py));
      return { mode: "leave", name: room ? `${b.name} · ${room.name}` : b.name, id: b.id };
    }
    const b = this.closestEntrance(1.15);
    if (!b) return null;
    return { mode: "enter", name: b.name, id: b.id };
  }

  nearStair(b: Building) {
    const p = this.player;
    const fl = floorOf(b, p.loc.floor ?? 0);
    const gx = Math.floor(p.px);
    const gy = Math.floor(p.py);
    const st = stairAt(fl, gx, gy);
    if (st) return st;
    for (const s of fl.stairs) {
      if (Math.hypot(p.px - (s.x + 0.5), p.py - (s.y + 0.5)) < 1.45) return s;
    }
    return undefined;
  }

  useStairs(b: Building, st: { toFloor: number; toX: number; toY: number }) {
    const p = this.player;
    p.loc = { layer: "interior", buildingId: b.id, floor: st.toFloor, x: st.toX, y: st.toY };
    p.px = st.toX + 0.5;
    p.py = st.toY + 0.5;
    p.bb.path = null;
    p.speed = 0;
    this.pendingEnter = null;
    this.pendingExit = false;
    this.pendingStair = null;
    this.pendingBuy = null;
    this.transitLock = 0.28;
  }

  interact() {
    const p = this.player;
    if (p.loc.layer === "interior") {
      const b = this.building(p.loc.buildingId);
      if (b) {
        const st = this.nearStair(b);
        if (st) {
          this.useStairs(b, st);
          return true;
        }
      }
      this.exitBuilding();
      return true;
    }
    const b = this.closestEntrance(1.25);
    if (!b) return false;
    this.enterBuilding(b.id);
    return true;
  }

  movePlayer(dx: number, dy: number, dt: number) {
    const len = Math.hypot(dx, dy);
    if (len < 0.01) {
      this.player.speed = 0;
      return;
    }
    this.player.bb.path = null;
    this.pendingEnter = null;
    this.pendingExit = false;
    this.pendingStair = null;
    this.pendingBuy = null;
    const nx = dx / len;
    const ny = dy / len;
    const step = 3.4 * Math.min(dt, 0.05);
    const p = this.player;
    const tx = p.px + nx * step;
    const ty = p.py + ny * step;
    p.facing = Math.atan2(ny, nx);
    p.speed = 3.4;
    if (p.loc.layer === "interior") {
      const b = this.building(p.loc.buildingId);
      if (!b) return;
      const fl = floorOf(b, p.loc.floor ?? 0);
      const gx = Math.floor(tx);
      const gy = Math.floor(ty);
      const door = streetDoor(b);
      const onGround = (p.loc.floor ?? 0) === 0;
      const fromDoor = onGround && Math.floor(p.px) === door.x && Math.floor(p.py) === door.y;
      const toDoor = onGround && gx === door.x && gy === door.y;
      if (toDoor && !fromDoor && this.transitLock <= 0) {
        this.exitBuilding();
        return;
      }
      const st = stairAt(fl, gx, gy);
      if (st && this.transitLock <= 0 && (Math.floor(p.px) !== st.x || Math.floor(p.py) !== st.y)) {
        this.useStairs(b, st);
        return;
      }
      if (interiorWalkable(b, gx, gy, p.loc.floor ?? 0) && !toDoor) {
        p.px = tx;
        p.py = ty;
        p.loc.x = gx;
        p.loc.y = gy;
      }
      return;
    }
    const gx = Math.floor(tx);
    const gy = Math.floor(ty);
    if (this.transitLock <= 0) {
      const hit = this.buildingAtTile(gx, gy);
      if (hit && Math.floor(p.px) === hit.entrance.x && Math.floor(p.py) === hit.entrance.y) {
        this.enterBuilding(hit.id);
        return;
      }
    }
    if (cityWalkable(this.map, gx, gy)) {
      p.px = tx;
      p.py = ty;
      p.loc.x = gx;
      p.loc.y = gy;
    }
  }

  occupants(buildingId: string, floor?: number) {
    return this.npcs.filter((n) => {
      if (n.loc.layer !== "interior" || n.loc.buildingId !== buildingId) return false;
      if (floor == null) return true;
      return (n.loc.floor ?? 0) === floor;
    });
  }

  tileAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return "grass";
    return this.map.tiles[idx(x, y, this.map.w)]!;
  }

  startRoleplay(npcId: string, presence?: "here" | "called") {
    const n = this.npc(npcId);
    if (!n || n.kind === "pc") return null;
    void presence;
    n.bb.control = "llm";
    n.bb.path = null;

    n.speed = 0;
    this.log({
      type: "talk",
      actorId: "pc",
      targetId: n.id,
      summary: `You start speaking with ${n.name}.`,
      source: "sim",
    });
    return snapshotNpc(this, n);
  }

  endRoleplay(npcId: string, deltas?: RoleplayDeltas) {
    const n = this.npc(npcId);
    if (!n) return;
    if (deltas) applyDeltas(this, n, deltas);
    n.bb.control = "autonomous";
    n.bb.goalLock = 0;
    n.bb.usingId = null;
    n.bb.pose = "stand";
    n.bb.path = null;
    n.bb.pathI = 0;
    n.bb.destKey = null;
    this.log({
      type: "talk-end",
      actorId: "pc",
      targetId: n.id,
      summary: `The conversation with ${n.name} ends. They return to their day.`,
      source: "sim",
    });
  }

  commandPlayerTo(dest: Loc) {
    const p = this.player;
    const fromBody = locFromBody(p.loc, p.px, p.py);
    const tries: Loc[] = [fromBody];
    if (fromBody.x !== p.loc.x || fromBody.y !== p.loc.y) tries.push({ ...p.loc });
    let path = null as ReturnType<typeof planRoute>;
    for (const from of tries) {
      path = planRoute(this.map, this.buildings, from, dest);
      if (path) break;
    }
    if (!path) return false;
    p.bb.path = trimLeadingWaypoints(path, p.px, p.py, p.loc);
    p.bb.pathI = 0;
    p.loc.x = fromBody.x;
    p.loc.y = fromBody.y;
    return true;
  }

  commandNpcTo(npcId: string, dest: Loc) {
    const n = this.npc(npcId);
    if (!n || n.kind === "pc") return false;
    const fromBody = locFromBody(n.loc, n.px, n.py);
    const path = planRoute(this.map, this.buildings, fromBody, dest);
    if (!path) return false;
    n.bb.usingId = null;
    n.bb.pose = "stand";
    n.bb.path = trimLeadingWaypoints(path, n.px, n.py, n.loc);
    n.bb.pathI = 0;
    n.bb.destKey = `${dest.layer}:${dest.buildingId ?? ""}:${dest.floor ?? 0}:${dest.x},${dest.y}`;
    return true;
  }

  /** Same interior floor as the PC, or city within 3 tiles. */
  isHere(npcId: string): boolean {
    const n = this.npc(npcId);
    if (!n || n.kind === "pc") return false;
    const p = this.player;
    if (p.loc.layer === "interior") {
      return n.loc.layer === "interior" && n.loc.buildingId === p.loc.buildingId && (n.loc.floor ?? 0) === (p.loc.floor ?? 0);
    }
    if (n.loc.layer !== "city") return false;
    return Math.hypot(n.px - p.px, n.py - p.py) <= 3;
  }

  tickPlayerMove(dt: number) {
    const p = this.player;
    if (p.bb.path) {
      advanceAlongPath(p, dt);
      if (p.bb.path && p.bb.pathI >= p.bb.path.length) {
        p.bb.path = null;
        p.speed = 0;
      }
    } else {
      p.speed = 0;
    }
    if (!p.bb.path && this.pendingEnter && p.loc.layer === "city") {
      const b = this.building(this.pendingEnter);
      if (b && this.nearEntrance(b, 1.6)) {
        const id = this.pendingEnter;
        this.pendingEnter = null;
        this.enterBuilding(id);
        return;
      }
    }
    if (!p.bb.path && this.pendingExit && p.loc.layer === "interior") {
      const b = this.building(p.loc.buildingId);
      if (b && (p.loc.floor ?? 0) === 0) {
        const door = streetDoor(b);
        if (Math.floor(p.px) === door.x && Math.floor(p.py) === door.y) {
          this.pendingExit = false;
          this.exitBuilding();
          return;
        }
      }
    }
    if (!p.bb.path && this.pendingStair && p.loc.layer === "interior") {
      const b = this.building(p.loc.buildingId);
      const st = this.pendingStair;
      if (b && Math.hypot(p.px - (st.x + 0.5), p.py - (st.y + 0.5)) < 1.35) {
        this.pendingStair = null;
    this.pendingBuy = null;
        this.useStairs(b, st);
      }
    }
    if (!p.bb.path && this.pendingBuy && p.loc.layer === "interior") {
      const b = this.building(p.loc.buildingId);
      const t = this.pendingBuy;
      if (b && (p.loc.floor ?? 0) === t.floor && Math.hypot(p.px - (t.x + 0.5), p.py - (t.y + 0.5)) < 1.35) {
        this.pendingBuy = null;
        this.buyMeal();
      }
    }
  }

  /** Buy a carried meal for the player at the shop they stand in. */
  buyMeal(): boolean {
    const p = this.player;
    if (p.loc.layer !== "interior" || !p.loc.buildingId) return false;
    const b = this.building(p.loc.buildingId);
    if (!b) return false;
    ensureBuildingEconomy(b);
    const foodId = GOOD.food;
    const price = priceOf(this.defs, foodId) ?? 3;
    if ((b.stock[foodId] ?? 0) >= 1 && p.coin >= price) {
      b.stock[foodId] -= 1;
      b.coffer += price;
      p.coin -= price;
      p.bb.food += 1;
      this.log({ type: "buy", actorId: "pc", buildingId: b.id, summary: `You bought a meal at ${b.name}.`, source: "sim" });
      return true;
    }
    if ((b.stock[foodId] ?? 0) < 1) {
      this.log({ type: "buy", actorId: "pc", buildingId: b.id, summary: `The larder at ${b.name} is bare.`, source: "sim" });
    } else {
      this.log({ type: "buy", actorId: "pc", buildingId: b.id, summary: `Your purse is too light for ${b.name} (a meal is ${price}).`, source: "sim" });
    }
    return false;
  }

  approachBuilding(id: string) {
    const b = this.building(id);
    if (!b) return false;
    if (this.player.loc.layer === "interior") {
      if (this.player.loc.buildingId === id) return true;
      this.exitBuilding();
    }
    if (this.nearEntrance(b, 1.45)) {
      this.enterBuilding(id);
      return true;
    }
    this.pendingEnter = id;
    return this.commandPlayerTo({ layer: "city", x: b.entrance.x, y: b.entrance.y });
  }

  replaceTree(tree: BtTree) {
    this.defs.trees[tree.id] = tree;
    this.log({ type: "data", actorId: "world", summary: `Behavior tree “${tree.name}” updated.`, source: "sim" });
  }

  enterBuilding(id: string) {
    const b = this.building(id);
    if (!b) return;
    const spawn = insideOf(b);
    const p = this.player;
    p.loc = { layer: "interior", buildingId: b.id, floor: 0, x: spawn.x, y: spawn.y };
    p.px = spawn.x + 0.5;
    p.py = spawn.y + 0.5;
    p.bb.path = null;
    p.speed = 0;
    this.pendingEnter = null;
    this.pendingExit = false;
    this.pendingStair = null;
    this.pendingBuy = null;
    this.transitLock = 0.28;
  }

  exitBuilding() {
    const p = this.player;
    if (p.loc.layer !== "interior") return;
    const b = this.building(p.loc.buildingId);
    if (!b) return;
    const n = streetStand(this.map, this.buildings, b);
    p.loc = { layer: "city", x: Math.floor(n.x), y: Math.floor(n.y), floor: undefined };
    p.px = n.x;
    p.py = n.y;
    p.bb.path = null;
    p.speed = 0;
    this.pendingEnter = null;
    this.pendingExit = false;
    this.pendingStair = null;
    this.pendingBuy = null;
    this.transitLock = 0.28;
  }

  addVillager(opts?: {
    name?: string;
    sex?: Sex;
    jobId?: string;
    homeId?: string;
    age?: number;
    orientation?: Orientation;
    ancestryId?: string;
  }): Npc | null {
    const homeTagged = new Set(homeKindIds(this.defs));
    const homes = this.buildings.filter((b) => homeTagged.has(b.kind));
    const home = (opts?.homeId ? this.building(opts.homeId) : null) ?? homes[0] ?? this.buildings[0];
    if (!home) return null;
    const kit = getKitSafe(this.kitId);
    const sex: Sex = opts?.sex ?? (chance(this.rng, 0.5) ? "f" : "m");
    const jobId = opts?.jobId && this.defs.jobs[opts.jobId] ? opts.jobId : kit.defaultPcJobId;
    const job = this.defs.jobs[jobId] ?? Object.values(this.defs.jobs)[0]!;
    // Documented engine rule: the catalog's retired-trade row gets senior ages.
    const age = clampAge(opts?.age ?? (job.id === JOBS.pensioner ? randInt(this.rng, 62, 84) : randInt(this.rng, 18, 58)));
    const first = pick(this.rng, sex === "f" ? this.defs.names.firstF : this.defs.names.firstM);
    const name = opts?.name?.trim() || `${first} ${pick(this.rng, this.defs.names.surnames)}`;
    const traits = shuffle(this.rng, Object.keys(this.defs.traits)).slice(0, 2);
    const needs: Record<string, number> = {};
    for (const n of this.defs.needs) needs[n.id] = n.id === NEED.thirst ? 100 : 70;
    const id = uid();
    const door = streetDoor(home);
    const bed = planClaimBed(home, id) ?? (() => {
      const beds = allBeds(home);
      return beds[this.npcs.filter((n) => n.bb.homeId === home.id).length % Math.max(1, beds.length)] ?? {
        x: door.x,
        y: door.y,
        floor: 0,
      };
    })();
    const ancestryId = opts?.ancestryId && this.defs.ancestries[opts.ancestryId] ? opts.ancestryId : pickAncestry(this.rng, this.defs);
    const concealed = !(this.defs.ancestries[ancestryId]?.mundane ?? false);
    const npc: Npc = {
      id,
      name,
      kind: "npc",
      sex,
      age,
      orientation: opts?.orientation ?? pickOrientation(this.rng),
      ancestryId,
      narrative: { public: "", private: "", voice: "" },
      appearance: makeAppearance(this.rng),
      secrets: makeSecrets(this.rng, this.defs, ancestryId, concealed),
      concealed,
      worn: emptyWorn(),
      parentIds: [],
      palette: this.npcs.length % 12,
      coin: 10,
      portrait: sex === "f" ? PORTRAITS_F[this.npcs.length % PORTRAITS_F.length] : PORTRAITS_M[this.npcs.length % PORTRAITS_M.length],
      loc: { layer: "interior", buildingId: home.id, floor: bed.floor, x: bed.x, y: bed.y },
      px: bed.x + 0.5,
      py: bed.y + 0.5,
      facing: 0,
      speed: walkSpeed({ age, kind: "npc" } as Npc),
      bb: {
        needs,
        mood: 0,
        traits,
        jobId: job.id,
        homeId: home.id,
        workId: resolveWorkId(this.defs, this.buildings, job, home.id, [...this.npcs, this.player], this.rng),
        householdId: `h-${home.id}`,
        food: 1,
        essence: 60,
        spells: [],
        goalId: null,
        goalLock: 0,
        treeId: null,
        btCursor: {},
        runningNodeId: null,
        lastStatus: null,
        control: "autonomous",
        path: null,
        pathI: 0,
        destKey: null,
        socialCooldown: 0,
        lastSocialTarget: null,
        waitTicks: 0,
        knowledge: [],
        usingId: null,
        pose: "stand",
        memory: [],
        tasks: [],
      },
      relationships: {},
    };
    const ancDef = this.defs.ancestries[npc.ancestryId];
    if (ancDef?.thirst) npc.bb.needs[NEED.thirst] = 60;
    ensureNarrative(npc, this.rng, job.label, home.name);
    dressSoul(this.rng, this.defs, this.clothing, npc, home);
    this.npcs.push(npc);
    this.reindex();
    this.log({ type: "data", actorId: "world", summary: `${npc.name} settles in ${home.name}.`, source: "sim" });
    return npc;
  }

  removeVillager(id: string) {
    const n = this.npc(id);
    if (!n || n.kind === "pc") return false;
    this.npcs = this.npcs.filter((x) => x.id !== id);
    this.bonds = this.bonds.filter((b) => b.a !== id && b.b !== id);
    this.donors = this.donors.filter((d) => d.donor !== id && d.drinker !== id);
    for (const b of this.buildings) planUnassign(b, id);
    for (const o of [...this.npcs, this.player]) {
      delete o.relationships[id];
      o.parentIds = o.parentIds.filter((p) => p !== id);
      if (o.spouseId === id) o.spouseId = undefined;
    }
    this.reindex();
    this.log({ type: "data", actorId: "world", summary: `${n.name} leaves ${this.townName}.`, source: "sim" });
    return true;
  }

  patchVillager(
    id: string,
    patch: {
      name?: string;
      age?: number;
      sex?: Sex;
      jobId?: string;
      homeId?: string;
      workId?: string | null;
      traits?: string[];
      treeId?: string;
      orientation?: Orientation;
      ancestryId?: string;
      appearance?: string;
      secrets?: string;
      concealed?: boolean;
      portrait?: string | null;
      narrative?: { public?: string; private?: string; voice?: string };
      eatAffinity?: { home?: number; kinds?: Record<string, number> };
    },
  ) {
    const n = this.npc(id);
    if (!n) return false;
    if (n.kind === "pc") {
      if (patch.orientation) n.orientation = patch.orientation;
      if (patch.name != null) n.name = patch.name.trim() || n.name;
      if (patch.age != null) n.age = clampAge(patch.age);
      if (patch.sex) n.sex = patch.sex;
      if (patch.ancestryId && this.defs.ancestries[patch.ancestryId]) n.ancestryId = patch.ancestryId;
      if (patch.traits) n.bb.traits = patch.traits.filter((t) => this.defs.traits[t]).slice(0, 4);
      if (patch.jobId && this.defs.jobs[patch.jobId]) {
        n.bb.jobId = patch.jobId;
        this.assignWorkplace(n);
      }
      if (patch.homeId && this.building(patch.homeId)) n.bb.homeId = patch.homeId;
      if (patch.appearance != null) n.appearance = patch.appearance.slice(0, 2000);
      if (patch.secrets != null) n.secrets = patch.secrets.slice(0, 2000);
      if (patch.concealed != null) n.concealed = !!patch.concealed;
      if (patch.portrait !== undefined) {
        if (patch.portrait == null || patch.portrait === "") delete n.portrait;
        else n.portrait = patch.portrait.slice(0, 200000);
      }
      if (patch.narrative) {
        if (patch.narrative.public != null) n.narrative.public = patch.narrative.public.slice(0, 2000);
        if (patch.narrative.private != null) n.narrative.private = patch.narrative.private.slice(0, 2000);
        if (patch.narrative.voice != null) n.narrative.voice = patch.narrative.voice.slice(0, 200);
      }
      if (patch.eatAffinity) {
        const cur = n.bb.eatAffinity ?? { home: 0.5, kinds: {} };
        const home = typeof patch.eatAffinity.home === "number" ? Math.max(0, Math.min(1, patch.eatAffinity.home)) : cur.home;
        const kinds: Record<string, number> = { ...cur.kinds };
        if (patch.eatAffinity.kinds) {
          for (const [k, v] of Object.entries(patch.eatAffinity.kinds)) {
            if (typeof v === "number" && Number.isFinite(v)) kinds[k] = Math.max(0, Math.min(1, v));
          }
        }
        n.bb.eatAffinity = { home, kinds };
      }
      return true;
    }
    if (patch.name != null) n.name = patch.name.trim() || n.name;
    if (patch.age != null) n.age = clampAge(patch.age);
    if (patch.sex) n.sex = patch.sex;
    if (patch.orientation) n.orientation = patch.orientation;
    if (patch.jobId && this.defs.jobs[patch.jobId]) {
      n.bb.jobId = patch.jobId;
      this.assignWorkplace(n);
    }
    if (patch.homeId && this.building(patch.homeId)) n.bb.homeId = patch.homeId;
    if (patch.workId !== undefined) n.bb.workId = patch.workId && this.building(patch.workId) ? patch.workId : null;
    if (patch.traits) n.bb.traits = patch.traits.filter((t) => this.defs.traits[t]);
    if (patch.treeId && this.defs.trees[patch.treeId]) n.bb.treeId = patch.treeId;
    if (patch.ancestryId && this.defs.ancestries[patch.ancestryId]) n.ancestryId = patch.ancestryId;
    if (patch.appearance != null) n.appearance = patch.appearance.slice(0, 2000);
    if (patch.secrets != null) n.secrets = patch.secrets.slice(0, 2000);
    if (patch.concealed != null) n.concealed = !!patch.concealed;
    if (patch.portrait !== undefined) {
      if (patch.portrait == null || patch.portrait === "") delete n.portrait;
      else n.portrait = patch.portrait.slice(0, 200000);
    }
    if (patch.narrative) {
      if (patch.narrative.public != null) n.narrative.public = patch.narrative.public.slice(0, 2000);
      if (patch.narrative.private != null) n.narrative.private = patch.narrative.private.slice(0, 2000);
      if (patch.narrative.voice != null) n.narrative.voice = patch.narrative.voice.slice(0, 200);
    }
    if (patch.eatAffinity) {
      const cur = n.bb.eatAffinity ?? { home: 0.5, kinds: {} };
      const home = typeof patch.eatAffinity.home === "number" ? Math.max(0, Math.min(1, patch.eatAffinity.home)) : cur.home;
      const kinds: Record<string, number> = { ...cur.kinds };
      if (patch.eatAffinity.kinds) {
        for (const [k, v] of Object.entries(patch.eatAffinity.kinds)) {
          if (typeof v === "number" && Number.isFinite(v)) kinds[k] = Math.max(0, Math.min(1, v));
        }
      }
      n.bb.eatAffinity = { home, kinds };
    }
    n.speed = walkSpeed(n);
    return true;
  }

  grantSpell(id: string, spellId: string): boolean {
    const n = this.npc(id);
    if (!n || !this.defs.spells[spellId]) return false;
    if (!Array.isArray(n.bb.spells)) n.bb.spells = [];
    if (!n.bb.spells.includes(spellId)) n.bb.spells.push(spellId);
    return true;
  }

  revokeSpell(id: string, spellId: string): boolean {
    const n = this.npc(id);
    if (!n || !Array.isArray(n.bb.spells)) return false;
    const next = n.bb.spells.filter((s) => s !== spellId);
    if (next.length === n.bb.spells.length) return false;
    n.bb.spells = next;
    return true;
  }

  /**
   * Point a soul at a matching workplace for their job. Home/plaza/sys-token jobs
   * and missing workplaces resolve to null ("odd jobs"); the ledger warns in that case.
   * Matcher jobs prefer buildings with fewer assigned workers.
   */
  assignWorkplace(n: Npc): void {
    const job = this.defs.jobs[n.bb.jobId];
    n.bb.workId = job ? resolveWorkId(this.defs, this.buildings, job, n.bb.homeId, [...this.npcs, this.player], this.rng) : null;
  }

  /** Ledger warning when a soul's named workplace does not exist on the map. */
  jobWorkplaceWarning(id: string): string | null {
    const n = this.npc(id);
    if (!n) return null;
    const job = this.defs.jobs[n.bb.jobId];
    if (!job || job.workplace === SYS.home || job.workplace === SYS.plaza) return null;
    if (hasWorkplace(this.defs, this.buildings, job)) return null;
    return `No ${this.kindLabel(job.workplace)} in town — ${n.name} idles at the plaza.`;
  }

  addBuildingKind(def: BuildingKindDef): string | null {
    const taken = new Set(Object.keys(this.defs.buildingKinds));
    // Slugs must stay unique across the catalog (shipped ∪ overlay).
    const takenSlugs = new Set(Object.values(this.defs.buildingKinds).map((k) => k.slug).filter(Boolean));
    const err = validateKindDef(
      { id: def.id, slug: def.slug, label: def.label, footprint: def.footprint, stories: def.stories, ground: def.ground, tags: def.tags },
      taken,
      takenSlugs,
    );
    if (err) return err;
    const clean: BuildingKindDef = {
      id: def.id,
      slug: def.slug || slugId(def.label),
      label: def.label.trim(),
      names: (def.names ?? []).map((s) => s.trim()).filter(Boolean),
      footprint: { w: Math.round(def.footprint.w), h: Math.round(def.footprint.h) },
      roof: def.roof,
      stories: def.stories === 2 ? 2 : 1,
      ground: (def.ground ?? []).map((r) => ({ kind: r.kind.trim() || "hall", name: r.name?.trim() || r.kind.trim() || "Hall" })),
      upper: def.upper?.map((r) => ({ kind: r.kind.trim() || "hall", name: r.name?.trim() || r.kind.trim() || "Room" })),
      doorSide: "any",
      tags: (def.tags ?? []).filter((t) => KNOWN_TAGS.includes(t)),
    };
    this.defs.buildingKinds[clean.id] = clean;
    this.defsOverlay.buildings.rows[clean.id] = { ...clean };
    this.log({ type: "data", actorId: "world", summary: `A new kind of house is known: ${clean.label}.`, source: "sim" });
    return null;
  }

  removeBuildingKind(id: string): string | null {
    const def = this.defs.buildingKinds[id];
    if (!def) return "No such kind.";
    if (SHIPPED_KIND_IDS.includes(id)) return "Shipped kinds stay — they hold up the ward.";
    if (this.buildings.some((b) => b.kind === id)) return "Buildings of that kind still stand. Demolish them first.";
    if (Object.values(this.defs.jobs).some((j) => j.workplace === id)) return "A job still works there. Move the job first.";
    delete this.defs.buildingKinds[id];
    delete this.defsOverlay.buildings.rows[id];
    this.log({ type: "data", actorId: "world", summary: `The ${def.label} is forgotten.`, source: "sim" });
    return null;
  }

  addJob(def: JobDef): string | null {
    const known = knownWorkplaces(this.defs);
    // Slugs must stay unique across the catalog (shipped ∪ overlay).
    const takenSlugs = new Set(Object.values(this.defs.jobs).map((j) => j.slug).filter(Boolean));
    const err = validateJobDef(
      { id: def.id, slug: def.slug, label: def.label, workplace: def.workplace, startHour: def.startHour, endHour: def.endHour },
      new Set(Object.keys(this.defs.jobs)),
      known,
      takenSlugs,
    );
    if (err) return err;
    const clean: JobDef = {
      id: def.id,
      slug: def.slug || slugId(def.label),
      label: def.label.trim(),
      workplace: def.workplace,
      startHour: def.startHour,
      endHour: def.endHour,
      palette: Math.abs(Math.round(def.palette ?? 0)) % 12,
      produces: def.produces,
      consumes: def.consumes,
      wage: def.wage,
    };
    this.defs.jobs[clean.id] = clean;
    this.defsOverlay.jobs.rows[clean.id] = { ...clean };
    this.log({ type: "data", actorId: "world", summary: `A new trade is known: ${clean.label}.`, source: "sim" });
    return null;
  }

  removeJob(id: string): string | null {
    const job = this.defs.jobs[id];
    if (!job) return "No such job.";
    const kit = getKitSafe(this.kitId);
    if (id === kit.defaultPcJobId) return "Someone has to do the odd jobs.";
    delete this.defs.jobs[id];
    // Shipped rows are deleted explicitly via removedIds; custom rows just vanish.
    if (SHIPPED_JOB_IDS.includes(id)) {
      if (!this.defsOverlay.jobs.removedIds.includes(id)) this.defsOverlay.jobs.removedIds.push(id);
    }
    delete this.defsOverlay.jobs.rows[id];
    let moved = 0;
    for (const n of [...this.npcs, this.player]) {
      if (n.bb.jobId === id) {
        n.bb.jobId = kit.defaultPcJobId;
        this.assignWorkplace(n);
        moved++;
      }
    }
    this.log({ type: "data", actorId: "world", summary: `The ${job.label} trade ends — ${moved} ${moved === 1 ? "soul labors" : "souls labor"} now.`, source: "sim" });
    return null;
  }

  // ---- Catalog overlay rows (Catalog spec §5): Library + live overlay share these ----
  private overlayAdd<T extends { id: string; slug?: string; label: string }>(
    ovCol: "businessTypes" | "garments" | "commodities" | "traits" | "ancestries" | "spells" | "social",
    def: T,
    err: string | null,
  ): string | null {
    if (err) return err;
    const cols = {
      businessTypes: this.defs.businessTypes,
      garments: this.defs.garments,
      commodities: this.defs.commodities,
      traits: this.defs.traits,
      ancestries: this.defs.ancestries,
      spells: this.defs.spells,
      social: this.defs.social,
    } as unknown as Record<string, Record<string, T>>;
    cols[ovCol]![def.id] = { ...def };
    (this.defsOverlay[ovCol].rows as Record<string, T>)[def.id] = { ...def };
    this.log({ type: "data", actorId: "world", summary: `A new row is known: ${def.label}.`, source: "sim" });
    return null;
  }

  private overlayRemove(
    ovCol: "businessTypes" | "garments" | "commodities" | "traits" | "ancestries" | "spells" | "social",
    shippedIds: string[],
    id: string,
    guard: string | null,
  ): string | null {
    if (guard) return guard;
    const cols = {
      businessTypes: this.defs.businessTypes,
      garments: this.defs.garments,
      commodities: this.defs.commodities,
      traits: this.defs.traits,
      ancestries: this.defs.ancestries,
      spells: this.defs.spells,
      social: this.defs.social,
    } as unknown as Record<string, Record<string, { id: string; label: string }>>;
    const def = cols[ovCol]![id];
    if (!def) return "No such row.";
    delete cols[ovCol]![id];
    delete (this.defsOverlay[ovCol].rows as Record<string, unknown>)[id];
    if (shippedIds.includes(id) && !this.defsOverlay[ovCol].removedIds.includes(id)) {
      this.defsOverlay[ovCol].removedIds.push(id);
    }
    this.log({ type: "data", actorId: "world", summary: `The ${def.label} is forgotten.`, source: "sim" });
    return null;
  }

  addBusinessType(def: BusinessTypeDef): string | null {
    const takenSlugs = new Set(Object.values(this.defs.businessTypes).map((t) => t.slug).filter(Boolean));
    return this.overlayAdd("businessTypes", def, validateBusinessTypeDef(def, new Set(Object.keys(this.defs.businessTypes)), takenSlugs, this.defs));
  }

  removeBusinessType(id: string): string | null {
    const guard = this.buildings.some((b) => b.businessTypeId === id)
      ? "Buildings still use that type. Clear their type first."
      : Object.values(this.defs.jobs).some((j) => j.workplace === id)
        ? "A job still works there. Move the job first."
        : this.kitUsesType(id)
          ? "The generation kit still names that type."
          : null;
    return this.overlayRemove("businessTypes", SHIPPED_BUSINESS_TYPE_IDS, id, guard);
  }

  private kitUsesType(id: string): boolean {
    try {
      return getKitSafe(this.kitId).buildings.some((b) => b.typeId === id);
    } catch {
      return false;
    }
  }

  addGarment(def: GarmentDef): string | null {
    const takenSlugs = new Set(Object.values(this.defs.garments).map((g) => g.slug).filter(Boolean));
    return this.overlayAdd("garments", def, validateGarmentDef(def, new Set(Object.keys(this.defs.garments)), takenSlugs));
  }

  removeGarment(id: string): string | null {
    const guard = this.clothing.some((c) => c.defId === id) ? "Souls still own garments of that make." : null;
    return this.overlayRemove("garments", SHIPPED_GARMENT_IDS, id, guard);
  }

  addCommodity(def: CommodityDef): string | null {
    const takenSlugs = new Set(Object.values(this.defs.commodities).map((c) => c.slug).filter(Boolean));
    return this.overlayAdd("commodities", def, validateSimpleRow(def, new Set(Object.keys(this.defs.commodities)), takenSlugs));
  }

  removeCommodity(id: string): string | null {
    return this.overlayRemove("commodities", SHIPPED_COMMODITY_IDS, id, null);
  }

  addTrait(def: TraitDef): string | null {
    const takenSlugs = new Set(Object.values(this.defs.traits).map((t) => t.slug).filter(Boolean));
    return this.overlayAdd(
      "traits",
      { ...def, modifiers: def.modifiers ?? { needDecay: {}, socialHit: {}, utility: {} } },
      validateSimpleRow(def, new Set(Object.keys(this.defs.traits)), takenSlugs),
    );
  }

  removeTrait(id: string): string | null {
    const r = this.overlayRemove("traits", SHIPPED_TRAIT_IDS, id, null);
    if (r) return r;
    for (const n of [...this.npcs, this.player]) n.bb.traits = n.bb.traits.filter((t) => t !== id);
    return null;
  }

  addAncestry(def: AncestryDef): string | null {
    if (typeof def.mundane !== "boolean") (def as { mundane?: boolean }).mundane = false;
    const takenSlugs = new Set(Object.values(this.defs.ancestries).map((a) => a.slug).filter(Boolean));
    return this.overlayAdd("ancestries", def, validateSimpleRow(def, new Set(Object.keys(this.defs.ancestries)), takenSlugs));
  }

  removeAncestry(id: string): string | null {
    const guard = [...this.npcs, this.player].some((n) => n.ancestryId === id) ? "Souls still claim that blood." : null;
    return this.overlayRemove("ancestries", [], id, guard);
  }

  addSpell(def: SpellDef): string | null {
    const takenSlugs = new Set(Object.values(this.defs.spells).map((s) => s.slug).filter(Boolean));
    return this.overlayAdd("spells", def, validateSimpleRow(def, new Set(Object.keys(this.defs.spells)), takenSlugs));
  }

  removeSpell(id: string): string | null {
    const r = this.overlayRemove("spells", [], id, null);
    if (r) return r;
    for (const n of [...this.npcs, this.player]) n.bb.spells = (n.bb.spells ?? []).filter((s) => s !== id);
    return null;
  }

  addNeed(def: NeedDef): string | null {
    if (this.defs.needs.some((n) => n.id === def.id)) return `“${def.id}” already exists.`;
    if (!isUuidV4(def.id)) return "Id must be a version-4 UUID.";
    if (!def.label.trim()) return "Label is required.";
    this.defs.needs.push({ ...def });
    this.defsOverlay.needs.rows[def.id] = { ...def };
    for (const n of [...this.npcs, this.player]) {
      if (n.bb.needs[def.id] == null) n.bb.needs[def.id] = 70;
    }
    this.log({ type: "data", actorId: "world", summary: `A new need stirs: ${def.label}.`, source: "sim" });
    return null;
  }

  removeNeed(id: string): string | null {
    const at = this.defs.needs.findIndex((n) => n.id === id);
    if (at < 0) return "No such need.";
    this.defs.needs.splice(at, 1);
    delete this.defsOverlay.needs.rows[id];
    if (SHIPPED_NEED_IDS.includes(id) && !this.defsOverlay.needs.removedIds.includes(id)) {
      this.defsOverlay.needs.removedIds.push(id);
    }
    for (const n of [...this.npcs, this.player]) delete n.bb.needs[id];
    this.log({ type: "data", actorId: "world", summary: "A need fades from the city.", source: "sim" });
    return null;
  }

  addSocial(def: SocialActionDef): string | null {
    const takenSlugs = new Set(Object.values(this.defs.social).map((s) => s.slug).filter(Boolean));
    return this.overlayAdd("social", def, validateSimpleRow(def, new Set(Object.keys(this.defs.social)), takenSlugs));
  }

  removeSocial(id: string): string | null {
    return this.overlayRemove("social", SHIPPED_SOCIAL_IDS, id, null);
  }

  addGoal(def: GoalDef): string | null {
    if (this.defs.goals.some((g) => g.id === def.id)) return `“${def.id}” already exists.`;
    if (!isUuidV4(def.id)) return "Id must be a version-4 UUID.";
    if (!def.label.trim()) return "Label is required.";
    this.defs.goals.push({ ...def });
    this.defsOverlay.goals.rows[def.id] = { ...def };
    this.log({ type: "data", actorId: "world", summary: `A new calling is known: ${def.label}.`, source: "sim" });
    return null;
  }

  removeGoal(id: string): string | null {
    const at = this.defs.goals.findIndex((g) => g.id === id);
    if (at < 0) return "No such goal.";
    const guard = [...this.npcs, this.player].some((n) => n.bb.goalId === id) ? "Souls still pursue that calling." : null;
    if (guard) return guard;
    this.defs.goals.splice(at, 1);
    delete this.defsOverlay.goals.rows[id];
    if (SHIPPED_GOAL_IDS.includes(id) && !this.defsOverlay.goals.removedIds.includes(id)) {
      this.defsOverlay.goals.removedIds.push(id);
    }
    this.log({ type: "data", actorId: "world", summary: "A calling fades from the city.", source: "sim" });
    return null;
  }

  /**
   * Patch a catalog row for this city only (live overlay). Shipped rows stay
   * read-only in git; the patch lands in defsOverlay and the town save.
   * Adults 18+ only: age bands below 18 are rejected.
   */
  patchCatalogRow(
    collection: "jobs" | "buildings" | "ancestries" | "spells" | "businessTypes" | "garments" | "commodities" | "traits" | "social" | "needs" | "goals",
    id: string,
    patch: Record<string, unknown>,
  ): string | null {
    if (patch.label !== undefined && !(typeof patch.label === "string" && patch.label.trim())) {
      return "Label is required.";
    }
    if (patch.workplace !== undefined && collection === "jobs") {
      if (typeof patch.workplace !== "string" || !knownWorkplaces(this.defs).has(patch.workplace)) {
        return "Workplace must be a known business type, kind, tag, or sys token.";
      }
    }
    if (patch.ages !== undefined) {
      const ages = patch.ages as [number, number];
      const err = agesAdult(Array.isArray(ages) ? ages : undefined);
      if (err) return err;
    }
    if (patch.pcAge !== undefined) {
      const age = Number(patch.pcAge);
      if (!Number.isFinite(age) || age < 18) return "Ages must be 18+ — never author a minor.";
    }
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      clean[k] = v;
    }
    const recordCols = {
      jobs: this.defs.jobs,
      buildings: this.defs.buildingKinds,
      ancestries: this.defs.ancestries,
      spells: this.defs.spells,
      businessTypes: this.defs.businessTypes,
      garments: this.defs.garments,
      commodities: this.defs.commodities,
      traits: this.defs.traits,
      social: this.defs.social,
    } as unknown as Record<string, Record<string, Record<string, unknown>>>;
    if (recordCols[collection]) {
      const row = recordCols[collection]![id];
      if (!row) return "No such row.";
      const next = { ...row, ...clean, id };
      recordCols[collection]![id] = next;
      ((this.defsOverlay[collection] as unknown as { rows: Record<string, Record<string, unknown>> }).rows)[id] = { ...next };
      // Patched souls keep working where they should.
      if (collection === "jobs") {
        for (const n of [...this.npcs, this.player]) {
          if (n.bb.jobId === id) this.assignWorkplace(n);
        }
      }
      this.log({ type: "data", actorId: "world", summary: "The city ledger is amended.", source: "sim" });
      return null;
    }
    if (collection === "needs") {
      const at = this.defs.needs.findIndex((n) => n.id === id);
      if (at < 0) return "No such row.";
      this.defs.needs[at] = { ...this.defs.needs[at]!, ...clean, id };
      this.defsOverlay.needs.rows[id] = { ...this.defs.needs[at]! };
      return null;
    }
    if (collection === "goals") {
      const at = this.defs.goals.findIndex((g) => g.id === id);
      if (at < 0) return "No such row.";
      this.defs.goals[at] = { ...this.defs.goals[at]!, ...clean, id };
      this.defsOverlay.goals.rows[id] = { ...this.defs.goals[at]! };
      return null;
    }
    return "Unknown collection.";
  }

  // ---- Clothing (Scene spec §7.3): full item model, tools only ----
  clothingItem(id: string): ClothingItem | undefined {
    return this.clothing.find((c) => c.id === id);
  }

  private clothingRoomLoc(n: Npc): Loc {
    if (n.loc.layer === "interior" && n.loc.buildingId) {
      return { layer: "interior", buildingId: n.loc.buildingId, floor: n.loc.floor ?? 0, x: Math.round(n.px), y: Math.round(n.py) };
    }
    return { layer: "city", x: Math.floor(n.px), y: Math.floor(n.py) };
  }

  /** Room label for the unworn-in-room prompt line. */
  roomNameOf(n: Npc): string | null {
    if (n.loc.layer !== "interior" || !n.loc.buildingId) return null;
    const b = this.building(n.loc.buildingId);
    if (!b) return null;
    const fl = floorOf(b, n.loc.floor ?? 0);
    return roomAt(fl, Math.round(n.px), Math.round(n.py))?.name ?? fl.name;
  }

  wearItem(npcId: string, itemId: string): string | null {
    const n = this.npc(npcId);
    const item = this.clothingItem(itemId);
    if (!n || !item) return "Unknown soul or item.";
    if (item.ownerId !== n.id) return "They do not own that.";
    if (item.wornBy === n.id) return "Already worn.";
    if (item.wornBy) return "Someone else is wearing that.";
    // Must be reachable: in the same building/room, held, or stored where they stand.
    const here = this.clothingRoomLoc(n);
    const reachable =
      (item.loc?.layer === "interior" && here.layer === "interior" && item.loc.buildingId === here.buildingId) ||
      (item.loc?.layer === "city" && here.layer === "city") ||
      (item.stored?.buildingId != null && here.layer === "interior" && item.stored.buildingId === here.buildingId);
    if (!reachable) return "That is not here.";
    const def = this.defs.garments[item.defId];
    if (!def) return "Unknown garment.";
    if (!n.worn) n.worn = emptyWorn();
    const slot = def.slot;
    const prevId = n.worn[slot];
    if (prevId && prevId !== item.id) {
      const prev = this.clothingItem(prevId);
      if (prev) {
        delete prev.wornBy;
        prev.loc = { ...here };
        delete prev.stored;
      }
    }
    delete item.loc;
    delete item.stored;
    item.wornBy = n.id;
    n.worn[slot] = item.id;
    return null;
  }

  removeItem(npcId: string, slotOrItem: string, to: "hands" | "here" | "hook" = "here"): string | null {
    const n = this.npc(npcId);
    if (!n) return "Unknown soul.";
    if (!n.worn) n.worn = emptyWorn();
    let item = this.clothingItem(slotOrItem);
    if (!item) {
      const slot = slotOrItem as ClothingSlot;
      const id = (n.worn as Record<string, string | null>)[slot];
      item = id ? this.clothingItem(id) : undefined;
    }
    if (!item || item.wornBy !== n.id) return "They are not wearing that.";
    const def = this.defs.garments[item.defId];
    const slot = def?.slot;
    delete item.wornBy;
    // here/hook/hands all land in the current room; hook needs a building.
    if (to === "hook" && n.loc.layer !== "interior") item.loc = this.clothingRoomLoc(n);
    else item.loc = this.clothingRoomLoc(n);
    delete item.stored;
    if (slot && n.worn[slot] === item.id) n.worn[slot] = null;
    return null;
  }

  takeItem(npcId: string, itemId: string): string | null {
    const n = this.npc(npcId);
    const item = this.clothingItem(itemId);
    if (!n || !item) return "Unknown soul or item.";
    if (item.wornBy) return "Someone is wearing that.";
    if (item.stored) return "That is put away.";
    const here = this.clothingRoomLoc(n);
    const sameRoom =
      (item.loc?.layer === "interior" && here.layer === "interior" && item.loc.buildingId === here.buildingId) ||
      (item.loc?.layer === "city" && here.layer === "city" && item.loc.x === here.x && item.loc.y === here.y);
    if (!sameRoom) return "That is not here.";
    // Picking up someone else's garment is allowed; ownership does not move.
    const def = this.defs.garments[item.defId];
    if (def && n.worn && !n.worn[def.slot]) return this.wearItem(npcId, itemId);
    item.loc = { ...here };
    return null;
  }

  storeItem(npcId: string, itemId: string): string | null {
    const n = this.npc(npcId);
    const item = this.clothingItem(itemId);
    if (!n || !item) return "Unknown soul or item.";
    if (n.loc.layer !== "interior" || !n.loc.buildingId) return "Wardrobes are at home.";
    if (n.loc.buildingId !== n.bb.homeId) return "That wardrobe is not theirs to use.";
    const here = this.clothingRoomLoc(n);
    const reachable =
      item.wornBy === n.id ||
      (item.loc?.layer === "interior" && item.loc.buildingId === here.buildingId);
    if (!reachable) return "That is not here.";
    if (item.wornBy === n.id) {
      const def = this.defs.garments[item.defId];
      if (def && n.worn && n.worn[def.slot] === item.id) n.worn[def.slot] = null;
      delete item.wornBy;
    }
    delete item.loc;
    item.stored = { buildingId: n.loc.buildingId, container: "wardrobe" };
    return null;
  }

  /** Character-beat / MCP clothing op. Returns an error string, or null on success. */
  applyClothingOp(npcId: string, op: { op: string; slot?: string; itemId?: string; to?: string }): string | null {
    const to = op.to === "hands" || op.to === "hook" ? op.to : "here";
    if (op.op === "wear") {
      if (!op.itemId) return "wear needs an itemId.";
      return this.wearItem(npcId, op.itemId);
    }
    if (op.op === "remove") {
      const target = op.itemId ?? op.slot;
      if (!target) return "remove needs a slot or itemId.";
      return this.removeItem(npcId, target, to as "hands" | "here" | "hook");
    }
    if (op.op === "take") {
      if (!op.itemId) return "take needs an itemId.";
      return this.takeItem(npcId, op.itemId);
    }
    if (op.op === "store") {
      if (!op.itemId) return "store needs an itemId.";
      return this.storeItem(npcId, op.itemId);
    }
    return `Unknown clothing op “${op.op}”.`;
  }

  setSpouse(aId: string, bId: string | null) {    const a = this.npc(aId);
    if (!a || a.kind === "pc") return false;
    if (a.spouseId) {
      const old = this.npc(a.spouseId);
      if (old?.spouseId === a.id) old.spouseId = undefined;
      const bond = getBond(this, a.id, a.spouseId);
      if (bond && isRomanticStatus(bond.status)) setBond(this, a.id, a.spouseId, "friend");
    }
    if (!bId) {
      a.spouseId = undefined;
      return true;
    }
    const b = this.npc(bId);
    if (!b || b.id === a.id) return false;
    if (areBloodKin(a, b, soulsOf(this))) return false;
    if (b.spouseId && b.spouseId !== a.id) {
      const other = this.npc(b.spouseId);
      if (other?.spouseId === b.id) other.spouseId = undefined;
      const bond = getBond(this, b.id, b.spouseId);
      if (bond && isRomanticStatus(bond.status)) setBond(this, b.id, b.spouseId, "friend");
    }
    setBond(this, a.id, b.id, "spouse");
    return true;
  }

  addParent(childId: string, parentId: string) {
    const child = this.npc(childId);
    if (!child || child.kind === "pc") return false;
    if (parentId === childId) return false;
    if (child.parentIds.includes(parentId) || child.parentIds.length >= 2) return false;
    const parent = this.npc(parentId);
    if (parent?.parentIds.includes(childId)) return false;
    child.parentIds = [...child.parentIds, parentId];
    if (parent && areBloodKin(child, parent, soulsOf(this))) {
      const bond = getBond(this, child.id, parent.id);
      if (bond && isRomanticStatus(bond.status)) setBond(this, child.id, parent.id, "friend");
    }
    return true;
  }

  removeParent(childId: string, parentId: string) {
    const child = this.npc(childId);
    if (!child) return false;
    const next = child.parentIds.filter((id) => id !== parentId);
    if (next.length === child.parentIds.length) return false;
    child.parentIds = next;
    return true;
  }

  /** Resolve a kind id to its def, falling back to the first catalog kind for unknown kinds. */
  kindDef(kind: string): BuildingKindDef {
    return this.defs.buildingKinds[kind] ?? FIRST_KIND;
  }

  kindLabel(kind: string): string {
    return kindLabel(this.defs, kind);
  }

  addHouse(kind?: string, name?: string): Building | null {
    // No/unknown kind: build the first home-tagged kind, else the first catalog kind.
    const homeId = homeKindIds(this.defs)[0];
    const def = (kind != null ? this.defs.buildingKinds[kind] : undefined) ?? (homeId ? this.defs.buildingKinds[homeId] : FIRST_KIND);
    const useDef = def ?? FIRST_KIND;
    const names = def?.names ?? [];
    const label = name?.trim() || (names.length ? pick(this.rng, names) : useDef.label);
    const b = placeBuildingOnMap(this.map, this.buildings, this.rng, useDef, label, uid());
    if (!b) {
      this.log({ type: "data", actorId: "world", summary: `No road frontage left for a ${useDef.label}.`, source: "sim" });
      return null;
    }
    this.reindex();
    this.log({ type: "data", actorId: "world", summary: `${b.name} is raised beside the road.`, source: "sim" });
    return b;
  }

  renameBuilding(id: string, name: string) {
    const b = this.building(id);
    if (!b) return false;
    b.name = name.trim() || b.name;
    return true;
  }

  removeBuilding(id: string) {
    const b = this.building(id);
    if (!b) return false;
    if (this.player.loc.buildingId === id) this.exitBuilding();
    if (this.pendingEnter === id) this.pendingEnter = null;
    const homeTagged = new Set(homeKindIds(this.defs));
    const homes = this.buildings.filter((x) => x.id !== id && homeTagged.has(x.kind));
    const fallback = homes[0] ?? this.buildings.find((x) => x.id !== id);
    for (const n of this.npcs) {
      if (n.loc.buildingId === id) {
        if (fallback) {
          const door = streetDoor(fallback);
          n.loc = { layer: "interior", buildingId: fallback.id, floor: 0, x: door.x, y: door.y };
          n.px = door.x + 0.5;
          n.py = door.y + 0.5;
        } else {
          n.loc = { layer: "city", x: b.entrance.x, y: b.entrance.y };
          n.px = b.entrance.x + 0.5;
          n.py = b.entrance.y + 0.5;
        }
        n.bb.path = null;
      }
      if (n.bb.homeId === id) n.bb.homeId = fallback?.id ?? n.bb.homeId;
      if (n.bb.workId === id) n.bb.workId = fallback?.id ?? null;
    }
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        const i = idx(xx, yy, this.map.w);
        if (this.map.tiles[i] !== "road" && this.map.tiles[i] !== "plaza") this.map.tiles[i] = "grass";
        this.map.blocked[i] = 0;
      }
    }
    this.buildings = this.buildings.filter((x) => x.id !== id);
    this.reindex();
    this.log({ type: "data", actorId: "world", summary: `${b.name} is pulled down.`, source: "sim" });
    return true;
  }

  // ---- Wave 3: floorplan / floors / furniture ----

  paintFloorTile(buildingId: string, floorIndex: number, x: number, y: number, tile: TileKind | "erase"): boolean {
    const b = this.building(buildingId);
    if (!b) return false;
    const ok = planPaint(b, floorIndex, x, y, tile);
    if (!ok) return false;
    this.nudgeOffWalls(b, floorIndex);
    return true;
  }

  private nudgeOffWalls(b: Building, floorIndex: number) {
    const fl = b.floors.find((f) => f.index === floorIndex);
    if (!fl) return;
    for (const n of [...this.npcs, this.player]) {
      if (n.loc.layer !== "interior" || n.loc.buildingId !== b.id || (n.loc.floor ?? 0) !== floorIndex) continue;
      const gx = Math.floor(n.px);
      const gy = Math.floor(n.py);
      if (gx < 0 || gy < 0 || gx >= fl.w || gy >= fl.h) continue;
      const t = fl.tiles[gy * fl.w + gx];
      if (t === "wall" || t === "window") {
        const spot = nearestWalkable(fl, gx, gy);
        if (spot) {
          n.loc = { layer: "interior", buildingId: b.id, floor: floorIndex, x: spot.x, y: spot.y };
          n.px = spot.x + 0.5;
          n.py = spot.y + 0.5;
          n.bb.path = null;
        }
      }
    }
  }

  setBuildingStreetDoor(buildingId: string, x: number, y: number): boolean {
    const b = this.building(buildingId);
    if (!b) return false;
    if (!planSetDoor(b, x, y)) return false;
    // Move the street-side entrance to the road tile nearest the new door so people still enter from the road.
    const edge: { x: number; y: number }[] = [];
    if (b.doorSide === "n") for (let xx = b.x; xx < b.x + b.w; xx++) edge.push({ x: xx, y: b.y - 1 });
    else if (b.doorSide === "s") for (let xx = b.x; xx < b.x + b.w; xx++) edge.push({ x: xx, y: b.y + b.h });
    else if (b.doorSide === "w") for (let yy = b.y; yy < b.y + b.h; yy++) edge.push({ x: b.x - 1, y: yy });
    else for (let yy = b.y; yy < b.y + b.h; yy++) edge.push({ x: b.x + b.w, y: yy });
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const c of edge) {
      if (!cityWalkable(this.map, c.x, c.y)) continue;
      const t = this.map.tiles[idx(c.x, c.y, this.map.w)];
      if (t !== "road" && t !== "plaza" && t !== "dirt") continue;
      const d = Math.hypot(c.x + 0.5 - cx, c.y + 0.5 - cy);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      b.entrance = best;
      this.map.blocked[idx(best.x, best.y, this.map.w)] = 0;
    }
    return true;
  }

  addRoomRect(buildingId: string, floorIndex: number, rect: { x: number; y: number; w: number; h: number }, name: string, kind: string) {
    const b = this.building(buildingId);
    if (!b) return null;
    return planSetRoom(b, floorIndex, rect, name, kind);
  }

  renameRoom(buildingId: string, floorIndex: number, roomId: string, name: string, kind: string): boolean {
    const b = this.building(buildingId);
    if (!b) return false;
    return planRenameRoom(b, floorIndex, roomId, name, kind);
  }

  deleteRoom(buildingId: string, floorIndex: number, roomId: string): boolean {
    const b = this.building(buildingId);
    if (!b) return false;
    return planDeleteRoom(b, floorIndex, roomId);
  }

  validateFloor(buildingId: string, floorIndex: number) {
    const b = this.building(buildingId);
    if (!b) return { ok: false, closedRooms: [], badStairs: [] };
    return planValidateFloor(b, floorIndex);
  }

  validateWholeBuilding(buildingId: string) {
    const b = this.building(buildingId);
    if (!b) return { ok: false, closedRooms: [], badStairs: [], floor: 0 };
    return planValidate(b);
  }

  addFloorAbove(buildingId: string) {
    const b = this.building(buildingId);
    if (!b) return null;
    const fl = planAddFloor(b);
    if (fl) this.log({ type: "data", actorId: "world", buildingId: b.id, summary: `A new storey rises over ${b.name}.`, source: "sim" });
    return fl;
  }

  addBasement(buildingId: string) {
    const b = this.building(buildingId);
    if (!b) return null;
    const fl = planAddBasement(b);
    if (fl) this.log({ type: "data", actorId: "world", buildingId: b.id, summary: `A cellar is dug beneath ${b.name}.`, source: "sim" });
    return fl;
  }

  removeFloor(buildingId: string, index: number, opts?: { deletePair?: boolean }) {
    const b = this.building(buildingId);
    if (!b) return { ok: false, reason: "No such building." };
    const res = planRemoveFloor(b, index, opts);
    if (!res.ok) return res;
    const ground = b.floors.find((f) => f.index === 0) ?? b.floors[0]!;
    let moved = 0;
    const door = ground.door ?? { x: 1, y: 1 };
    for (const n of [...this.npcs, this.player]) {
      if (n.loc.layer === "interior" && n.loc.buildingId === b.id && (n.loc.floor ?? 0) === index) {
        const spot = nearestWalkable(ground, door.x, door.y) ?? door;
        n.loc = { layer: "interior", buildingId: b.id, floor: ground.index, x: spot.x, y: spot.y };
        n.px = spot.x + 0.5;
        n.py = spot.y + 0.5;
        n.bb.path = null;
        moved++;
      }
    }
    if (this.player.loc.buildingId === b.id && (this.player.loc.floor ?? 0) === index) {
      this.player.loc.floor = ground.index;
    }
    this.log({ type: "data", actorId: "world", buildingId: b.id, summary: `A floor is removed from ${b.name}.`, source: "sim" });
    return { ok: true, moved };
  }

  placeFurniture(buildingId: string, floorIndex: number, x: number, y: number, kind: TileKind, ownerId?: string) {
    const b = this.building(buildingId);
    if (!b) return null;
    const id = planPlaceFurniture(b, floorIndex, x, y, kind, ownerId);
    if (id) this.nudgeOffWalls(b, floorIndex);
    return id;
  }

  removeFurnitureAt(buildingId: string, floorIndex: number, x: number, y: number) {
    const b = this.building(buildingId);
    if (!b) return { ok: false };
    const res = planRemoveFurniture(b, floorIndex, x, y);
    if (res.ok) this.nudgeOffWalls(b, floorIndex);
    return res;
  }

  assignBed(buildingId: string, furnitureId: string, ownerId: string | null): boolean {
    const b = this.building(buildingId);
    if (!b) return false;
    if (ownerId && !this.npc(ownerId)) return false;
    // One sweetheart/partner/spouse bed each: clear this soul's other beds first.
    if (ownerId) {
      for (const f of b.floors) {
        for (const item of f.furniture ?? []) {
          if (item.kind === "bed" && item.ownerId === ownerId && item.id !== furnitureId) delete item.ownerId;
        }
      }
    }
    return planAssignBed(b, furnitureId, ownerId);
  }

  assignRoom(buildingId: string, floorIndex: number, roomId: string, ownerId: string | null): boolean {
    const b = this.building(buildingId);
    if (!b) return false;
    if (ownerId && !this.npc(ownerId)) return false;
    return planAssignRoom(b, floorIndex, roomId, ownerId);
  }

  bedOfSoul(buildingId: string, soulId: string) {
    const b = this.building(buildingId);
    if (!b) return null;
    return planBedOf(b, soulId);
  }

  linkStairs(buildingId: string, fromIndex: number, x: number, y: number, toIndex: number): boolean {
    const b = this.building(buildingId);
    if (!b) return false;
    return planLinkStairs(b, fromIndex, x, y, toIndex);
  }
}
