import type { Building, JobDef, Npc, SimHost } from "./types";

/** Goods the borough tracks. Building `food` stock = servable meals. */
export const GOODS = ["grain", "flour", "bread", "ale", "wood", "goods", "food", "vitae"] as const;
export type Good = (typeof GOODS)[number];

/** Static price table. Only meals trade so far; the rest is Wave 5+ display. */
export const PRICES: Record<string, number> = {
  food: 3,
  grain: 1,
  flour: 2,
  bread: 2,
  ale: 3,
  wood: 2,
  goods: 4,
};

/** Per-good display cap so day-30 barns stay readable. */
export const STOCK_CAP = 99;

export function isGood(key: string): boolean {
  return (GOODS as readonly string[]).includes(key);
}

export function stockOf(b: Building, good: string): number {
  return Math.max(0, Math.floor(b.stock?.[good] ?? 0));
}

function setStock(b: Building, good: string, n: number) {
  if (!b.stock) b.stock = {};
  b.stock[good] = Math.max(0, Math.min(STOCK_CAP, Math.floor(n)));
}

/** Fill missing economy fields on old saves and fresh buildings. */
export function ensureBuildingEconomy(b: Building): void {
  if (!b.stock || typeof b.stock !== "object") b.stock = {};
  for (const g of GOODS) {
    if (typeof b.stock[g] !== "number" || !Number.isFinite(b.stock[g])) b.stock[g] = 0;
    else b.stock[g] = Math.max(0, Math.min(STOCK_CAP, Math.floor(b.stock[g])));
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

function shouldLog(key: string, tick: number, every = 48): boolean {
  const last = lastMade.get(key) ?? -1e9;
  if (tick - last < every) return false;
  lastMade.set(key, tick);
  return true;
}

/**
 * Run one `work` completion for an NPC at their workplace building.
 * Data-driven off the job def: consumes inputs, produces outputs
 * (`coin` output = sales into the coffer), pays min(wage, coffer).
 */
export function doWork(world: SimHost, npc: Npc): WorkResult {
  const job: JobDef | undefined = world.defs.jobs[npc.bb.jobId];
  if (!job) return "no-work";
  const b = world.building(npc.bb.workId ?? undefined);
  const tick = world.time().tick;
  if (!b) {
    // Plaza labor and the workless: purse-funded odd jobs, or nothing.
    if (npc.bb.jobId === "laborer") {
      payFromPurse(world, npc, job.wage ?? 1);
    }
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
    if (good === "coin") {
      b.coffer = Math.max(0, b.coffer + amount);
    } else if (isGood(good)) {
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
      summary: `${npc.name} ${makeVerb(job.id, made[0]!)} at ${b.name}.`,
      source: "sim",
    });
  }
  return "produced";
}

function makeVerb(jobId: string, good: string): string {
  if (good === "food") return jobId === "homemaker" ? "cooked from the grain" : "served a meal";
  if (good === "bread") return "baked bread";
  if (good === "flour") return "milled flour";
  if (good === "grain") return "brought in grain";
  if (good === "ale") return "drew ale";
  return `made ${good}`;
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
 * Buy a carried meal. Nearest stocked seller first; coin moves to the coffer.
 * Returns the seller, or null when shelves are bare / purse too light.
 */
export function tryBuyFood(world: SimHost, buyer: Npc): Seller | null {
  const price = PRICES.food ?? 3;
  if (buyer.coin < price) return null;
  const p = buyerPos(world, buyer);
  const sellers: Seller[] = [];
  for (const b of world.buildings) {
    if (stockOf(b, "food") < 1) continue;
    sellers.push({ building: b, dist: Math.hypot(b.entrance.x + 0.5 - p.x, b.entrance.y + 0.5 - p.y) });
  }
  sellers.sort((a, c) => a.dist - c.dist);
  const s = sellers[0];
  if (!s) return null;
  ensureBuildingEconomy(s.building);
  setStock(s.building, "food", stockOf(s.building, "food") - 1);
  s.building.coffer += price;
  buyer.coin -= price;
  buyer.bb.food += 1;
  return s;
}

/** Seed a fresh borough so day 1 is not a famine. */
export function seedEconomy(host: {
  buildings: Building[];
  npcs: Npc[];
  player: Npc;
  townPurse: number;
}): void {
  for (const b of host.buildings) {
    ensureBuildingEconomy(b);
    b.coffer = 20;
    switch (b.kind) {
      case "farmhouse":
        b.stock.grain = 6;
        break;
      case "mill":
        b.stock.flour = 4;
        b.stock.grain = 2;
        break;
      case "bakery":
        b.stock.bread = 3;
        b.stock.food = 4;
        b.stock.flour = 2;
        break;
      case "tavern":
        b.stock.food = 5;
        b.stock.ale = 3;
        b.stock.grain = 2;
        b.stock.vitae = 2;
        break;
      case "workshop":
        b.stock.wood = 6;
        break;
      case "market":
        b.stock.goods = 4;
        b.stock.food = 2;
        break;
      case "temple":
        b.stock.food = 2;
        b.stock.vitae = 3;
        break;
      default:
        break;
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
