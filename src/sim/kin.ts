import type { Rng } from "./rng.ts";
import { chance, randInt } from "./rng.ts";
import type { AncestryDef, Bond, BondStatus, Defs, Npc, Orientation, Rel, Sex, SimHost } from "./types.ts";

/** Weighted ancestry pick (AncestryDef.weight; defaults to a uniform roll). */
export function weightedAncestry(rows: AncestryDef[], rng: Rng): AncestryDef {
  const total = rows.reduce((s, r) => s + Math.max(0, r.weight ?? 1), 0);
  let r = (total > 0 ? rng() * total : 0);
  for (const row of rows) {
    r -= Math.max(0, row.weight ?? 1);
    if (r < 0 || !rows.length) return row;
  }
  return rows[rows.length - 1]!;
}

export function pickAncestry(rng: Rng, defs?: Defs): string {
  const rows = Object.values(defs?.ancestries ?? {});
  if (!defs || !rows.length) {
    // No catalog available (legacy path): keep the shipped distribution.
    const r = rng();
    if (r < 0.7) return "human";
    if (r < 0.8) return "demon";
    if (r < 0.9) return "angel";
    return "vampire";
  }
  return weightedAncestry(rows, rng).id;
}

export const ORIENTATIONS: Orientation[] = ["hetero", "homo", "bi", "ace"];
export const BOND_STATUSES: BondStatus[] = ["none", "friend", "sweetheart", "partner", "spouse"];

export const ORIENTATION_LABEL: Record<Orientation, string> = {
  hetero: "Hetero",
  homo: "Homo",
  bi: "Bi",
  ace: "Ace",
};

export const BOND_LABEL: Record<BondStatus, string> = {
  none: "—",
  friend: "friend",
  sweetheart: "sweetheart",
  partner: "partner",
  spouse: "spouse",
};

export function pickOrientation(rng: Rng): Orientation {
  const r = rng();
  if (r < 0.7) return "hetero";
  if (r < 0.85) return "bi";
  if (r < 0.95) return "homo";
  return "ace";
}

export function hashOrientation(id: string): Orientation {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const r = (h >>> 0) % 100;
  if (r < 70) return "hetero";
  if (r < 85) return "bi";
  if (r < 95) return "homo";
  return "ace";
}

export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function walkSpeed(npc: Npc): number {
  if (npc.kind === "pc") return 3.4;
  if (npc.age > 65) return 1.2;
  return 1.65;
}

export function clampAge(age: number): number {
  return Math.max(18, Math.min(110, Math.round(age) || 18));
}

export function normalizeSoul(n: Npc, validJobIds?: Set<string>, fallbackJobId?: string): { grewUp: boolean } {
  let grewUp = false;
  if (typeof n.age !== "number" || n.age < 18) {
    if (typeof n.age === "number" && n.age < 18) grewUp = true;
    n.age = 18;
  }
  if (n.age > 110) n.age = 110;
  // Unknown/removed job → the kit's default (fallback) job.
  if (validJobIds && n.bb?.jobId && !validJobIds.has(n.bb.jobId)) {
    if (fallbackJobId) {
      n.bb.jobId = fallbackJobId;
      grewUp = true;
    }
  }
  if (!n.orientation || !ORIENTATIONS.includes(n.orientation)) n.orientation = hashOrientation(n.id);
  if (!Array.isArray(n.parentIds)) n.parentIds = [];
  n.parentIds = n.parentIds.filter((id) => typeof id === "string" && id.length > 0).slice(0, 2);
  if (n.kind !== "pc") n.speed = walkSpeed(n);
  return { grewUp };
}

export function orientationAccepts(person: Npc, otherSex: Sex): boolean {
  if (person.orientation === "bi") return true;
  if (person.orientation === "hetero") return person.sex !== otherSex;
  if (person.orientation === "homo") return person.sex === otherSex;
  return false;
}

export function soulsOf(world: SimHost): Npc[] {
  const list = world.people().slice();
  const pc = world.npc("pc");
  if (pc && !list.some((n) => n.id === pc.id)) list.push(pc);
  return list;
}

export function areBloodKin(a: Npc, b: Npc, all?: Npc[]): boolean {
  if (a.id === b.id) return false;
  if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) return true;
  if (a.parentIds.some((id) => id && b.parentIds.includes(id))) return true;
  if (!all) return false;
  const kidsOf = (id: string) => all.filter((n) => n.parentIds.includes(id));
  if (kidsOf(a.id).some((k) => k.id === b.id) || kidsOf(b.id).some((k) => k.id === a.id)) return true;
  return false;
}

export function romanceAllowed(a: Npc, b: Npc, all?: Npc[]): boolean {
  if (a.id === b.id) return false;
  if (a.orientation === "ace" || b.orientation === "ace") return false;
  if (areBloodKin(a, b, all)) return false;
  return orientationAccepts(a, b.sex) && orientationAccepts(b, a.sex);
}

function touchRel(npc: Npc, otherId: string): Rel {
  const existing = npc.relationships[otherId];
  if (existing) return existing;
  const r: Rel = { familiarity: 0, friendship: 0, romance: 0, trust: 10, grudge: 0 };
  npc.relationships[otherId] = r;
  return r;
}

function clampRel(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function bumpRel(npc: Npc, otherId: string, d: Partial<Rel>) {
  const r = touchRel(npc, otherId);
  if (d.friendship != null) r.friendship = clampRel(r.friendship + d.friendship, -100, 100);
  if (d.romance != null) r.romance = clampRel(r.romance + d.romance, 0, 100);
  if (d.trust != null) r.trust = clampRel(r.trust + d.trust, -100, 100);
  if (d.grudge != null) r.grudge = clampRel(r.grudge + d.grudge, 0, 100);
  if (d.familiarity != null) r.familiarity = clampRel(r.familiarity + d.familiarity, 0, 100);
  npc.relationships[otherId] = r;
}

export function getBond(world: SimHost, a: string, b: string): Bond | undefined {
  const [x, y] = pairKey(a, b);
  return world.bonds.find((bond) => bond.a === x && bond.b === y);
}

export function isRomanticStatus(status: BondStatus): boolean {
  return status === "sweetheart" || status === "partner" || status === "spouse";
}

export function romanticBondOf(world: SimHost, id: string): Bond | undefined {
  return world.bonds.find((b) => (b.a === id || b.b === id) && isRomanticStatus(b.status));
}

export function otherId(bond: Bond, id: string): string {
  return bond.a === id ? bond.b : bond.a;
}

export function setBond(world: SimHost, aId: string, bId: string, status: BondStatus, silent = false): Bond {
  const [x, y] = pairKey(aId, bId);
  let bond = world.bonds.find((b) => b.a === x && b.b === y);
  const prev = bond?.status ?? "none";
  const tick = world.time().tick;
  if (!bond) {
    bond = { a: x, b: y, status, sinceTick: tick };
    world.bonds.push(bond);
  } else if (bond.status !== status) {
    bond.status = status;
    bond.sinceTick = tick;
  }
  syncSpouseIds(world, aId, bId, status, prev);
  if (!silent && prev !== status) {
    const a = world.npc(aId);
    const b = world.npc(bId);
    const left = a?.name ?? aId;
    const right = b?.name ?? bId;
    const summary =
      status === "none"
        ? `${left} and ${right} are no longer bound.`
        : status === "friend"
          ? `${left} and ${right} are now friends.`
          : `${left} and ${right} are now ${status}s.`;
    world.log({ type: "bond", actorId: aId, targetId: bId, summary, source: "sim" });
  }
  return bond;
}

function syncSpouseIds(world: SimHost, aId: string, bId: string, status: BondStatus, prev: BondStatus) {
  const a = world.npc(aId);
  const b = world.npc(bId);
  if (status === "spouse") {
    if (a) a.spouseId = bId;
    if (b) b.spouseId = aId;
    return;
  }
  if (prev === "spouse" || a?.spouseId === bId || b?.spouseId === aId) {
    if (a?.spouseId === bId) a.spouseId = undefined;
    if (b?.spouseId === aId) b.spouseId = undefined;
  }
}

export function breakRomantic(world: SimHost, aId: string, bId: string) {
  const bond = getBond(world, aId, bId);
  if (!bond || !isRomanticStatus(bond.status)) return;
  const a = world.npc(aId);
  const b = world.npc(bId);
  if (a) bumpRel(a, bId, { friendship: -8, romance: -12, trust: -6, grudge: 4 });
  if (b) bumpRel(b, aId, { friendship: -8, romance: -12, trust: -6, grudge: 4 });
  const prev = bond.status;
  setBond(world, aId, bId, "friend");
  // Rupture ends donor consent the same as romance.
  world.donors = world.donors.filter(
    (d) => !(d.donor === aId && d.drinker === bId) && !(d.donor === bId && d.drinker === aId),
  );
  const left = a?.name ?? aId;
  const right = b?.name ?? bId;
  world.log({
    type: prev === "spouse" ? "divorce" : "breakup",
    actorId: aId,
    targetId: bId,
    summary: prev === "spouse" ? `${left} and ${right} divorce.` : `${left} and ${right} part ways.`,
    source: "sim",
  });
}

export function considerBondPromotion(world: SimHost, a: Npc, b: Npc) {
  if (areBloodKin(a, b, soulsOf(world))) return;
  const relA = touchRel(a, b.id);
  const relB = touchRel(b, a.id);
  const friendship = (relA.friendship + relB.friendship) / 2;
  const romance = (relA.romance + relB.romance) / 2;
  const bond = getBond(world, a.id, b.id);
  const status = bond?.status ?? "none";

  if (status === "none" && friendship >= 40) {
    if (world.rng() < 0.45 || friendship >= 55) setBond(world, a.id, b.id, "friend");
    return;
  }

  const allowed = romanceAllowed(a, b, soulsOf(world));
  const aBusy = romanticBondOf(world, a.id);
  const bBusy = romanticBondOf(world, b.id);
  const free =
    (!aBusy || (aBusy.a === pairKey(a.id, b.id)[0] && aBusy.b === pairKey(a.id, b.id)[1])) &&
    (!bBusy || (bBusy.a === pairKey(a.id, b.id)[0] && bBusy.b === pairKey(a.id, b.id)[1]));

  if (allowed && free && (status === "none" || status === "friend") && friendship >= 35 && romance >= 25) {
    if (world.rng() < 0.4 || romance >= 40) setBond(world, a.id, b.id, "sweetheart");
    return;
  }

  if (status === "sweetheart" && allowed && romance >= 50 && friendship >= 40) {
    const duration = world.time().tick - (bond?.sinceTick ?? 0);
    if (duration >= 24 * 12 || romance >= 70) setBond(world, a.id, b.id, "partner");
  }
}

export function siblingsOf(npc: Npc, all: Npc[]): Npc[] {
  if (!npc.parentIds.length) return [];
  return all.filter((o) => o.id !== npc.id && o.parentIds.some((id) => npc.parentIds.includes(id)));
}

export function childrenOf(npc: Npc, all: Npc[]): Npc[] {
  return all.filter((o) => o.parentIds.includes(npc.id));
}

export type FamilyView = {
  parents: { id: string; name: string }[];
  siblings: { id: string; name: string }[];
  partner: { id: string; name: string; status: BondStatus } | null;
  household: { id: string; name: string }[];
};

export function familyOf(world: SimHost, npc: Npc): FamilyView {
  const all = soulsOf(world);
  const nameOf = (id: string) => world.npc(id)?.name ?? "parent (away)";
  const parents = npc.parentIds.map((id) => ({ id, name: nameOf(id) }));
  const siblings = siblingsOf(npc, all).map((n) => ({ id: n.id, name: n.name }));
  const rom = romanticBondOf(world, npc.id);
  const partnerId = rom ? otherId(rom, npc.id) : npc.spouseId;
  const partnerNpc = partnerId ? world.npc(partnerId) : undefined;
  const partner = partnerNpc
    ? { id: partnerNpc.id, name: partnerNpc.name, status: rom?.status ?? (npc.spouseId ? "spouse" : "none") }
    : null;
  const listed = new Set([npc.id, ...parents.map((p) => p.id), ...siblings.map((s) => s.id), partner?.id ?? ""]);
  const household = all
    .filter((n) => n.id !== npc.id && n.bb.homeId === npc.bb.homeId && n.kind !== "pc" && !listed.has(n.id))
    .map((n) => ({ id: n.id, name: n.name }));
  return { parents, siblings, partner, household };
}

function surnameOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : parts[0]!;
}

function withSurname(name: string, surname: string) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return `${first} ${surname}`;
}

function bumpKin(a: Npc, b: Npc, rng: Rng) {
  const paint = (n: Npc, other: string): Rel => {
    const r = touchRel(n, other);
    r.familiarity = Math.max(r.familiarity, randInt(rng, 70, 95));
    r.trust = Math.max(r.trust, randInt(rng, 55, 90));
    r.friendship = Math.max(r.friendship, randInt(rng, 40, 80));
    r.romance = 0;
    n.relationships[other] = r;
    return r;
  };
  paint(a, b.id);
  paint(b, a.id);
}

function coupleRel(a: Npc, b: Npc, rng: Rng) {
  const paint = (n: Npc, other: string) => {
    const r = touchRel(n, other);
    r.familiarity = randInt(rng, 70, 95);
    r.friendship = randInt(rng, 50, 88);
    r.romance = randInt(rng, 45, 82);
    r.trust = randInt(rng, 50, 90);
    r.grudge = chance(rng, 0.06) ? randInt(rng, 2, 12) : 0;
    n.relationships[other] = r;
  };
  paint(a, b.id);
  paint(b, a.id);
}

function makeCompatible(a: Npc, b: Npc, rng: Rng) {
  if (a.orientation === "ace") a.orientation = chance(rng, 0.5) ? "bi" : a.sex === b.sex ? "homo" : "hetero";
  if (b.orientation === "ace") b.orientation = chance(rng, 0.5) ? "bi" : a.sex === b.sex ? "homo" : "hetero";
  if (a.sex === b.sex) {
    if (a.orientation === "hetero") a.orientation = chance(rng, 0.6) ? "homo" : "bi";
    if (b.orientation === "hetero") b.orientation = chance(rng, 0.6) ? "homo" : "bi";
  } else {
    if (a.orientation === "homo") a.orientation = chance(rng, 0.6) ? "hetero" : "bi";
    if (b.orientation === "homo") b.orientation = chance(rng, 0.6) ? "hetero" : "bi";
  }
}

function bindCouple(a: Npc, b: Npc, bonds: Bond[], tick: number, rng: Rng, asSpouse: boolean) {
  const [x, y] = pairKey(a.id, b.id);
  const status: BondStatus = asSpouse ? "spouse" : "partner";
  bonds.push({ a: x, b: y, status, sinceTick: tick });
  if (status === "spouse") {
    a.spouseId = b.id;
    b.spouseId = a.id;
  }
  coupleRel(a, b, rng);
  const sur = surnameOf(a.name);
  b.name = withSurname(b.name, sur);
}

export function seedFamilies(npcs: Npc[], rng: Rng, tick: number, bonds: Bond[]) {
  const byHome = new Map<string, Npc[]>();
  for (const n of npcs) {
    const hid = n.bb.homeId;
    if (!byHome.has(hid)) byHome.set(hid, []);
    byHome.get(hid)!.push(n);
  }

  for (const [, members] of byHome) {
    members.sort((a, b) => b.age - a.age);
    const mid = members.filter((n) => n.age >= 22 && n.age <= 64);
    let couple: [Npc, Npc] | null = null;
    outer: for (let i = 0; i < mid.length; i++) {
      for (let j = i + 1; j < mid.length; j++) {
        const a = mid[i]!;
        const b = mid[j]!;
        if (Math.abs(a.age - b.age) > 18) continue;
        if (romanceAllowed(a, b, npcs)) {
          couple = [a, b];
          break outer;
        }
      }
    }
    if (!couple && mid.length >= 2) {
      const a = mid[0]!;
      const b = mid.find((n) => n.id !== a.id && Math.abs(n.age - a.age) <= 18) ?? mid[1]!;
      makeCompatible(a, b, rng);
      couple = [a, b];
    }
    if (couple) {
      bindCouple(couple[0], couple[1], bonds, tick, rng, chance(rng, 0.68));
      const minParent = Math.min(couple[0].age, couple[1].age);
      const kids = members.filter(
        (n) => n.id !== couple![0].id && n.id !== couple![1].id && n.age >= 18 && n.age <= minParent - 18,
      );
      const taken = kids.slice(0, 2);
      const sur = surnameOf(couple[0].name);
      for (const kid of taken) {
        kid.parentIds = [couple[0].id, couple[1].id];
        kid.name = withSurname(kid.name, sur);
        bumpKin(kid, couple[0], rng);
        bumpKin(kid, couple[1], rng);
      }
      for (let i = 0; i < taken.length; i++) {
        for (let j = i + 1; j < taken.length; j++) bumpKin(taken[i]!, taken[j]!, rng);
      }
      const elders = members.filter(
        (n) => n.age >= 62 && n.id !== couple[0].id && n.id !== couple[1].id && !taken.includes(n),
      );
      const heir = couple[0];
      for (const elder of elders) {
        if (elder.age < heir.age + 18) continue;
        if (heir.parentIds.length >= 2) break;
        heir.parentIds = [...heir.parentIds, elder.id];
        bumpKin(heir, elder, rng);
      }
      if (elders.length >= 2) {
        const e0 = elders[0]!;
        const e1 = elders[1]!;
        if (!romanticBondIn(bonds, e0.id) && !romanticBondIn(bonds, e1.id) && Math.abs(e0.age - e1.age) <= 20) {
          makeCompatible(e0, e1, rng);
          bindCouple(e0, e1, bonds, tick, rng, true);
        }
      }
    } else {
      const young = members.filter((n) => n.age < 50);
      if (young.length >= 2) {
        const ages = young.map((n) => n.age);
        if (Math.max(...ages) - Math.min(...ages) <= 14) {
          const away = `away:${young[0]!.bb.homeId}`;
          for (const n of young) {
            if (!n.parentIds.length) n.parentIds = [away];
          }
          for (let i = 0; i < young.length; i++) {
            for (let j = i + 1; j < young.length; j++) bumpKin(young[i]!, young[j]!, rng);
          }
        }
      }
    }
  }
}

function romanticBondIn(bonds: Bond[], id: string) {
  return bonds.some((b) => (b.a === id || b.b === id) && isRomanticStatus(b.status));
}

export function pickerJobs<T extends { id: string }>(jobs: Record<string, T>): T[] {
  // All pickable jobs; the catalog no longer ships child rows.
  return Object.values(jobs);
}
