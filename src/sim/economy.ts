import type { Building, CommodityDef, Defs, JobDef, Npc, SimHost } from "./types.ts";
import { TICKS_PER_HOUR } from "./types.ts";
import { GOOD } from "./defs.ts";

/** Per-good display cap so day-30 coffers stay readable. */
export const STOCK_CAP = 99;

export function stockOf(b: Building, good: string): number {
  return Math.max(0, Math.floor(b.stock?.[good] ?? 0));
}

function setStock(b: Building, good: string, n: number) {
  if (!b.stock) b.stock = {};
  b.stock[good] = Math.max(0, Math.min(STOCK_CAP, Math.floor(n)));
}

/** Commodity price from the catalog (commodities.json `price`). */
export function priceOf(defs: Defs, goodId: string): number | undefined {
  const c: CommodityDef | undefined = defs.commodities[goodId];
  return c?.price;
}

/** Commodity display verb from the catalog (commodities.json `verb`, else "made {label}"). */
export function makeVerb(defs: Defs, goodId: string): string {
  const c = defs.commodities[goodId];
  return c?.verb ?? `made ${c?.label ?? goodId}`;
}

/** Normalize a building's economy fields (clamps stock to 0..STOCK_CAP). No catalog ids here. */
export function ensureBuildingEconomy(b: Building): void {
  if (!b.stock || typeof b.stock !== "object") b.stock = {};
  for (const [k, v] of Object.entries(b.stock)) {
    if (typeof v === "number" && Number.isFinite(v)) b.stock[k] = Math.max(0, Math.min(STOCK_CAP, Math.floor(v)));
    else delete b.stock[k];
  }
  if (typeof b.coffer !== "number" || !Number.isFinite(b.coffer)) b.coffer = 10;
  else b.coffer = Math.max(0, Math.floor(b.coffer));
}

export function ensureSoulEconomy(n: Npc): void {
  if (typeof n.coin !== "number" || !Number.isFinite(n.coin)) n.coin = 10;
  else n.coin = Math.max(0, Math.floor(n.coin));
}

// Throttled chronicle: one production note per building per ~4 hours, one dry note per dry spell.
const lastMade = new Map<string, number>();
const dryFlag = new Set<string>();

export type WorkResult = "produced" | "idle" | "no-work";

// Economy cadence in sim-minutes: roughly one ledger entry every ~4 hours.
function shouldLog(key: string, tick: number, every = 4 * TICKS_PER_HOUR): boolean {
  const last = lastMade.get(key) ?? -1e9;
  if (tick - last < every) return false;
  lastMade.set(key, tick);
  return true;
}

function isCommodity(world: SimHost, key: string): boolean {
  return world.defs.commodities[key] !== undefined;
}

/**
 * Run one `work` completion for an NPC at their workplace building.
 * Data-driven off the job def: consumes inputs, produces outputs
 * (coin output = sales into the coffer), pays min(wage, coffer).
 */
export function doWork(world: SimHost, npc: Npc): WorkResult {
  const job: JobDef | undefined = world.defs.jobs[npc.bb.jobId];
  if (!job) return "no-work";
  const b = world.building(npc.bb.workId ?? undefined);
  const tick = world.time().tick;
  if (!b) {
    // No workplace building: purse-funded odd jobs (the town covers the wage).
    payFromPurse(world, npc, job.wage ?? 0);
    return "produced";
  }
  ensureBuildingEconomy(b);
  const consumes = job.consumes ?? {};
  for (const [good, need] of Object.entries(consumes)) {
    if (stockOf(b, good) < need) {
      if (!dryFlag.has(b.id)) {
        dryFlag.add(b.id);
        world.log({
          type: "dry",
          actorId: npc.id,
          buildingId: b.id,
          summary: `${b.name} ran dry — ${npc.name} idles.`,
          source: "sim",
        });
      }
      return "idle";
    }
  }
  dryFlag.delete(b.id);
  const made: string[] = [];
  for (const [good, need] of Object.entries(consumes)) setStock(b, good, stockOf(b, good) - need);
  for (const [good, amount] of Object.entries(job.produces ?? {})) {
    if (good === GOOD.credits) {
      b.coffer = Math.max(0, b.coffer + amount);
    } else if (isCommodity(world, good)) {
      setStock(b, good, stockOf(b, good) + amount);
      made.push(good);
    }
  }
  const wage = job.wage ?? 0;
  if (wage > 0 && b.coffer > 0) {
    const paid = Math.min(wage, Math.floor(b.coffer));
    b.coffer -= paid;
    npc.coin = Math.max(0, npc.coin + paid);
  }
  if (made.length && shouldLog(`${b.id}:${made[0]}`, tick)) {
    world.log({
      type: "make",
      actorId: npc.id,
      buildingId: b.id,
      summary: `${npc.name} ${makeVerb(world.defs, made[0]!)} at ${b.name}.`,
      source: "sim",
    });
  }
  return "produced";
}

function payFromPurse(world: SimHost, npc: Npc, wage: number) {
  const purse = typeof world.townPurse === "number" ? world.townPurse : 0;
  const paid = Math.max(0, Math.min(wage, Math.floor(purse)));
  if (paid > 0) {
    world.townPurse = purse - paid;
    npc.coin = Math.max(0, npc.coin + paid);
  }
}

export interface Seller {
  building: Building;
  dist: number;
}

function buyerPos(world: SimHost, npc: Npc): { x: number; y: number } {
  if (npc.loc.layer === "city") return { x: npc.px, y: npc.py };
  const b = world.building(npc.loc.buildingId);
  if (b) return { x: b.entrance.x, y: b.entrance.y };
  return { x: npc.px, y: npc.py };
}

/**
 * Buy a carried meal unit (`food` commodity). Nearest stocked seller first;
 * coin moves to the coffer. Returns the seller, or null when shelves are bare / purse too light.
 */
export function tryBuyFood(world: SimHost, buyer: Npc): Seller | null {
  const price = priceOf(world.defs, GOOD.food) ?? 3;
  if (buyer.coin < price) return null;
  const p = buyerPos(world, buyer);
  const sellers: Seller[] = [];
  for (const b of world.buildings) {
    if (stockOf(b, GOOD.food) < 1) continue;
    sellers.push({ building: b, dist: Math.hypot(b.entrance.x + 0.5 - p.x, b.entrance.y + 0.5 - p.y) });
  }
  sellers.sort((a, c) => a.dist - c.dist);
  const s = sellers[0];
  if (!s) return null;
  ensureBuildingEconomy(s.building);
  setStock(s.building, GOOD.food, stockOf(s.building, GOOD.food) - 1);
  s.building.coffer += price;
  buyer.coin -= price;
  buyer.bb.food += 1;
  return s;
}

/** Seed a fresh town so day 1 is not a famine. Per-kind stocks come from the kind def's stockDefaults. */
export function seedEconomy(host: { defs: Defs; buildings: Building[]; npcs: Npc[]; player: Npc; townPurse: number }): void {
  for (const b of host.buildings) {
    ensureBuildingEconomy(b);
    b.coffer = 20;
    const def = host.defs.buildingKinds[b.kind];
    for (const [good, amount] of Object.entries(def?.stockDefaults ?? {})) {
      setStock(b, good, stockOf(b, good) + Math.max(0, Math.floor(amount)));
    }
  }
  for (const n of host.npcs) {
    n.coin = 8 + (Math.abs(hashStr(n.id)) % 7);
  }
  host.player.coin = 25;
  host.townPurse = 100;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
