import type { Building, BuildingKindDef, Defs, DefsOverlay, JobDef, Npc } from "./types.ts";
import { CLOTHING_SLOTS } from "./types.ts";
import type { Rng } from "./rng.ts";
import { SYS, kindsByTag } from "./defs.ts";

/** Empty per-collection overlay (Library previews, fresh towns). */
export function blankOverlay(): DefsOverlay {
  const col = () => ({ rows: {}, removedIds: [] as string[] });
  return {
    jobs: col(),
    buildings: col(),
    ancestries: col(),
    spells: col(),
    businessTypes: col(),
    garments: col(),
    commodities: col(),
    traits: col(),
    needs: col(),
    social: col(),
    goals: col(),
  };
}

export const KNOWN_TAGS = ["home", "work", "shop", "gather", "worship", "eat"];

/** Workplace tags a job matcher may name (engine vocabulary, not catalog slugs). */
export const WORKPLACE_TAGS: string[] = [...KNOWN_TAGS];

/** Authoring-only slug derived from a label (runtime references use UUIDs). */
export function slugId(label: string): string {
  const s = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "custom";
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(s: string): boolean {
  return UUID_V4_RE.test(s);
}

export function validateKindDef(
  def: { id: string; slug?: string; label: string; footprint: { w: number; h: number }; stories: number; ground: { kind: string; name?: string }[]; tags: string[] },
  taken: Set<string>,
  takenSlugs: Set<string>,
): string | null {
  if (!isUuidV4(def.id)) return "Id must be a version-4 UUID.";
  const slugOk = def.slug == null || def.slug === "" || /^[a-z0-9][a-z0-9-]*$/.test(def.slug);
  if (!slugOk) return "Slug must be lowercase letters, numbers and dashes.";
  // Slugs stay unique across the catalog (shipped ∪ overlay). An omitted slug
  // is derived from the label, so the effective slug is what gets checked.
  const eff = def.slug && def.slug.trim() ? def.slug : slugId(def.label);
  if (takenSlugs.has(eff)) return `The slug “${eff}” is already in use.`;
  if (taken.has(def.id)) return `“${def.id}” already exists.`;
  if (!def.label.trim()) return "Label is required.";
  if (!Number.isFinite(def.footprint.w) || !Number.isFinite(def.footprint.h)) return "Footprint must be numbers.";
  if (def.footprint.w < 3 || def.footprint.h < 3) return "Footprint must be at least 3×3.";
  if (def.footprint.w > 20 || def.footprint.h > 14) return "Footprint max is 20×14.";
  if (def.stories !== 1 && def.stories !== 2) return "Stories must be 1 or 2.";
  if (!def.ground.length) return "Ground floor needs at least one room.";
  for (const r of def.ground) {
    if (!r.kind.trim()) return "Every room needs a kind.";
  }
  return null;
}

export function validateJobDef(
  def: { id: string; slug?: string; label: string; workplace: string; startHour: number; endHour: number },
  takenJobs: Set<string>,
  knownWorkplaces: Set<string>,
  takenSlugs: Set<string>,
): string | null {
  if (!isUuidV4(def.id)) return "Id must be a version-4 UUID.";
  const slugOk = def.slug == null || def.slug === "" || /^[a-z0-9][a-z0-9-]*$/.test(def.slug);
  if (!slugOk) return "Slug must be lowercase letters, numbers and dashes.";
  // Slugs stay unique across the catalog (shipped ∪ overlay); omitted slugs
  // are derived from the label, so the effective slug is what gets checked.
  const eff = def.slug && def.slug.trim() ? def.slug : slugId(def.label);
  if (takenSlugs.has(eff)) return `The slug “${eff}” is already in use.`;
  if (takenJobs.has(def.id)) return `“${def.id}” already exists.`;
  if (!def.label.trim()) return "Label is required.";
  if (!knownWorkplaces.has(def.workplace)) {
    return `Workplace “${def.workplace}” is not a known business type, kind, tag, or sys token.`;
  }
  if (def.startHour < 0 || def.startHour > 24 || def.endHour < 0 || def.endHour > 24) return "Shift hours must be 0–24.";
  return null;
}

/** Known workplaces for the job editor: sys tokens + business type ids + kind ids + tags. */
export function knownWorkplaces(defs: Defs): Set<string> {
  return new Set([
    ...(Object.values(SYS) as string[]),
    ...Object.keys(defs.businessTypes),
    ...Object.keys(defs.buildingKinds),
    ...WORKPLACE_TAGS,
  ]);
}

/** Adults 18+ only: reject any age band starting below 18. */
export function agesAdult(ages?: [number, number]): string | null {
  if (!ages || ages.length !== 2) return null;
  const lo = Math.min(Number(ages[0]), Number(ages[1]));
  if (!Number.isFinite(lo) || lo < 18) return "Ages must be 18+ — never author a minor.";
  return null;
}

function slugUnique(slug: string | undefined, label: string, takenSlugs: Set<string>): string | null {
  const slugOk = slug == null || slug === "" || /^[a-z0-9][a-z0-9-]*$/.test(slug);
  if (!slugOk) return "Slug must be lowercase letters, numbers and dashes.";
  const eff = slug && slug.trim() ? slug : slugId(label);
  if (takenSlugs.has(eff)) return `The slug “${eff}” is already in use.`;
  return null;
}

export function validateBusinessTypeDef(
  def: { id: string; slug?: string; label: string; buildingKindId: string; staff?: { jobId: string; countPerInstance: number }[]; tags?: string[]; hours?: { startHour: number; endHour: number } },
  taken: Set<string>,
  takenSlugs: Set<string>,
  defs: Defs,
): string | null {
  if (!isUuidV4(def.id)) return "Id must be a version-4 UUID.";
  const se = slugUnique(def.slug, def.label, takenSlugs);
  if (se) return se;
  if (taken.has(def.id)) return `“${def.id}” already exists.`;
  if (!def.label.trim()) return "Label is required.";
  if (!defs.buildingKinds[def.buildingKindId]) return "Default shell must be a known building kind.";
  for (const s of def.staff ?? []) {
    if (!defs.jobs[s.jobId]) return "Staff must name known jobs.";
    if (!Number.isFinite(s.countPerInstance) || s.countPerInstance < 1) return "Staff counts must be 1+.";
  }
  if (def.hours && (def.hours.startHour < 0 || def.hours.startHour > 24 || def.hours.endHour < 0 || def.hours.endHour > 24)) {
    return "Hours must be 0–24.";
  }
  return null;
}

const GARMENT_SLOTS = new Set<string>(CLOTHING_SLOTS);
const GARMENT_LAYERS = new Set(["under", "inner", "mid", "outer"]);

export function validateGarmentDef(
  def: { id: string; slug?: string; label: string; slot: string; layer: string },
  taken: Set<string>,
  takenSlugs: Set<string>,
): string | null {
  if (!isUuidV4(def.id)) return "Id must be a version-4 UUID.";
  const se = slugUnique(def.slug, def.label, takenSlugs);
  if (se) return se;
  if (taken.has(def.id)) return `“${def.id}” already exists.`;
  if (!def.label.trim()) return "Label is required.";
  if (!GARMENT_SLOTS.has(def.slot)) return "Slot must be a known clothing slot.";
  if (!GARMENT_LAYERS.has(def.layer)) return "Layer must be under / inner / mid / outer.";
  return null;
}

export interface KitCheck {
  errors: string[];
  warnings: string[];
}

/** Validate a kit's shape against the catalog. Shipped shape, same rules. */
export function validateKit(kit: {
  id: string;
  slug?: string;
  label: string;
  buildings?: { kindId: string; count: number; typeId?: string }[];
  homes?: string[];
  roster?: { jobId: string; count: number; ages?: [number, number] }[];
  defaultPcJobId: string;
  pcAge: number;
  pcHomeKindId?: string;
}, defs: Defs): KitCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isUuidV4(kit.id)) errors.push("Kit id must be a version-4 UUID.");
  if (!kit.label.trim()) errors.push("Kit label is required.");
  for (const b of kit.buildings ?? []) {
    if (!defs.buildingKinds[b.kindId]) errors.push("Kit buildings must name known kinds.");
    if (!Number.isFinite(b.count) || b.count < 1) errors.push("Building counts must be 1+.");
    if (b.typeId) {
      const t = defs.businessTypes[b.typeId];
      if (!t) errors.push("Kit typeId must name a known business type.");
      else if (t.buildingKindId !== b.kindId) {
        warnings.push(`Shell differs from the type's default shell — allowed, but check the floorplan fits.`);
      }
    }
  }
  for (const h of kit.homes ?? []) {
    if (!defs.buildingKinds[h]) errors.push("Kit homes must name known kinds.");
  }
  for (const r of kit.roster ?? []) {
    if (!defs.jobs[r.jobId]) errors.push("Kit roster must name known jobs.");
    if (!Number.isFinite(r.count) || r.count < 1) errors.push("Roster counts must be 1+.");
    const ae = agesAdult(r.ages);
    if (ae) errors.push(ae);
  }
  if (!defs.jobs[kit.defaultPcJobId]) errors.push("Default PC job must be a known job.");
  if (!Number.isFinite(kit.pcAge) || kit.pcAge < 18) errors.push("PC age must be 18+.");
  if (kit.pcHomeKindId && !defs.buildingKinds[kit.pcHomeKindId]) errors.push("PC home kind must be a known kind.");
  return { errors: errors.length ? [...new Set(errors)] : [], warnings: [...new Set(warnings)] };
}

/** Minimal row validation for the remaining catalog collections (Library + overlay editors). */
export function validateSimpleRow(  def: { id: string; slug?: string; label: string },
  taken: Set<string>,
  takenSlugs: Set<string>,
): string | null {
  if (!isUuidV4(def.id)) return "Id must be a version-4 UUID.";
  const se = slugUnique(def.slug, def.label, takenSlugs);
  if (se) return se;
  if (taken.has(def.id)) return `“${def.id}” already exists.`;
  if (!def.label.trim()) return "Label is required.";
  return null;
}

/**
 * Apply Library custom rows (plain JSON, UUID rows) onto a Defs + overlay pair.
 * Used at generation so custom inventions exist before the city is built; the
 * rows persist on the town save, keeping the town self-contained.
 */
export function applyLibraryDefs(
  defs: Defs,
  overlay: import("./types.ts").DefsOverlay,
  catalog: Record<string, unknown[]>,
  kitSettingId?: string,
): void {
  const recordCols: Array<[keyof import("./types.ts").DefsOverlay, "jobs" | "buildingKinds" | "ancestries" | "spells" | "businessTypes" | "garments" | "commodities" | "traits" | "social"]> = [
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
  for (const [ovCol, defsCol] of recordCols) {
    const rows = catalog[ovCol] ?? catalog[defsCol];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const r = row as { id?: unknown };
      if (!r || typeof r.id !== "string" || !isUuidV4(r.id)) continue;
      (defs[defsCol] as Record<string, unknown>)[r.id] = { ...(row as Record<string, unknown>) };
      ((overlay[ovCol] as unknown as { rows: Record<string, unknown> }).rows)[r.id] = { ...(row as Record<string, unknown>) };
    }
  }
  const needs = catalog.needs;
  if (Array.isArray(needs)) {
    for (const row of needs) {
      const r = row as { id?: unknown };
      if (!r || typeof r.id !== "string" || !isUuidV4(r.id)) continue;
      const at = defs.needs.findIndex((n) => n.id === r.id);
      if (at >= 0) defs.needs[at] = row as import("./types.ts").NeedDef;
      else defs.needs.push(row as import("./types.ts").NeedDef);
      overlay.needs.rows[r.id] = row as import("./types.ts").NeedDef;
    }
  }
  const goals = catalog.goals;
  if (Array.isArray(goals)) {
    for (const row of goals) {
      const r = row as { id?: unknown };
      if (!r || typeof r.id !== "string" || !isUuidV4(r.id)) continue;
      const at = defs.goals.findIndex((g) => g.id === r.id);
      if (at >= 0) defs.goals[at] = row as import("./types.ts").GoalDef;
      else defs.goals.push(row as import("./types.ts").GoalDef);
      overlay.goals.rows[r.id] = row as import("./types.ts").GoalDef;
    }
  }
  const names = catalog.names;
  if (Array.isArray(names) && names[0]) {
    // defs.names aliases the shipped module object — clone before extending.
    defs.names = { firstF: [...defs.names.firstF], firstM: [...defs.names.firstM], surnames: [...defs.names.surnames] };
    const doc = names[0] as { firstF?: unknown; firstM?: unknown; surnames?: unknown };
    if (Array.isArray(doc.firstF)) defs.names.firstF = [...defs.names.firstF, ...doc.firstF.filter((x) => typeof x === "string") as string[]];
    if (Array.isArray(doc.firstM)) defs.names.firstM = [...defs.names.firstM, ...doc.firstM.filter((x) => typeof x === "string") as string[]];
    if (Array.isArray(doc.surnames)) defs.names.surnames = [...defs.names.surnames, ...doc.surnames.filter((x) => typeof x === "string") as string[]];
  }
  const settingRows = catalog.setting;
  if (kitSettingId && Array.isArray(settingRows)) {
    const hit = settingRows.find((r) => (r as { id?: unknown })?.id === kitSettingId) as import("./types.ts").SettingRow | undefined;
    if (hit && typeof hit.bible === "string") defs.setting = { ...hit };
  }
}

export type WorkTarget = { type: "building"; id: string } | { type: "home" };

/**
 * Job workplace matcher (Catalog spec §6.2). Resolved in order:
 * `sys:*` engine token, business type id, building kind id, or tag.
 * Bartender → bar type, waitress → diner type, housekeeper → home tag.
 */
export type WorkplaceMatch =
  | { kind: "sys"; token: string }
  | { kind: "type"; id: string }
  | { kind: "buildingKind"; id: string }
  | { kind: "tag"; tag: string }
  | { kind: "invalid" };

export function matchWorkplace(defs: Defs, workplace: string): WorkplaceMatch {
  if (workplace.startsWith("sys:")) return { kind: "sys", token: workplace };
  if (defs.businessTypes[workplace]) return { kind: "type", id: workplace };
  if (defs.buildingKinds[workplace]) return { kind: "buildingKind", id: workplace };
  if ((WORKPLACE_TAGS as string[]).includes(workplace)) return { kind: "tag", tag: workplace };
  return { kind: "invalid" };
}

/** Tags carried by a building: its kind tags plus its business type tags. */
export function buildingTags(defs: Defs, b: Building): string[] {
  const tags = new Set<string>(defs.buildingKinds[b.kind]?.tags ?? []);
  if (b.businessTypeId && defs.businessTypes[b.businessTypeId]) {
    for (const t of defs.businessTypes[b.businessTypeId]!.tags) tags.add(t);
  }
  return [...tags];
}

/** Buildings a workplace matcher names (`sys:*` handled by the caller). */
export function buildingsMatchingWorkplace(defs: Defs, buildings: Building[], workplace: string): Building[] {
  const m = matchWorkplace(defs, workplace);
  if (m.kind === "type") return buildings.filter((b) => b.businessTypeId === m.id);
  if (m.kind === "buildingKind") return buildings.filter((b) => b.kind === m.id);
  if (m.kind === "tag") return buildings.filter((b) => buildingTags(defs, b).includes(m.tag));
  return [];
}

/**
 * Smart pick among matching buildings: fewest assigned workers first, then rng.
 * `people` are souls whose workId counts as an assignment.
 */
export function pickWorkBuilding(
  defs: Defs,
  buildings: Building[],
  job: JobDef,
  people: Npc[],
  rng: Rng,
): Building | null {
  const cands = buildingsMatchingWorkplace(defs, buildings, job.workplace);
  if (!cands.length) return null;
  const load = new Map<string, number>();
  for (const b of cands) load.set(b.id, 0);
  for (const p of people) {
    if (p.bb.workId && load.has(p.bb.workId)) load.set(p.bb.workId, (load.get(p.bb.workId) ?? 0) + 1);
  }
  const min = Math.min(...cands.map((b) => load.get(b.id) ?? 0));
  const best = cands.filter((b) => (load.get(b.id) ?? 0) === min);
  return best[Math.floor(rng() * best.length) % best.length] ?? best[0] ?? null;
}

/** Kinds tagged `gather`, by id (the town's public square). */
function gatherKindIds(): Set<string> {
  return new Set(kindsByTag("gather").map((k) => k.id));
}

/** The first built building of the given kind (or, for plaza tokens, the first gather house). */
export function workBuildingOf(defs: Defs, buildings: Building[], job: JobDef): Building | null {
  const m = matchWorkplace(defs, job.workplace);
  if (m.kind === "sys") {
    if (job.workplace === SYS.plaza) {
      const gather = gatherKindIds();
      return buildings.find((b) => gather.has(b.kind)) ?? null;
    }
    return null; // sys:home and other tokens resolve per-soul, not per-kind
  }
  return buildingsMatchingWorkplace(defs, buildings, job.workplace)[0] ?? null;
}

/** Runtime workId: sys tokens / type / kind / tag → a building id, or null (odd jobs, purse-paid). */
export function resolveWorkId(defs: Defs, buildings: Building[], job: JobDef, homeId: string, people?: Npc[], rng?: Rng): string | null {
  if (job.workplace === SYS.home) return homeId;
  if (matchWorkplace(defs, job.workplace).kind === "sys" && job.workplace !== SYS.plaza) return null;
  const pick = people && rng ? pickWorkBuilding(defs, buildings, job, people, rng) : workBuildingOf(defs, buildings, job);
  return pick?.id ?? null;
}

/** Display target: where a job works (falls back to the household's home). */
export function resolveWorkTarget(defs: Defs, buildings: Building[], _homeId: string, job: JobDef): WorkTarget {
  if (job.workplace === SYS.home) return { type: "home" };
  const b = workBuildingOf(defs, buildings, job);
  return b ? { type: "building", id: b.id } : { type: "home" };
}

/** True when the job's named workplace actually exists on the map. */
export function hasWorkplace(defs: Defs, buildings: Building[], job: JobDef): boolean {
  if (job.workplace === SYS.home) return true;
  const m = matchWorkplace(defs, job.workplace);
  if (m.kind === "sys") {
    if (job.workplace === SYS.plaza) {
      const gather = gatherKindIds();
      return buildings.some((b) => gather.has(b.kind));
    }
    return true;
  }
  if (m.kind === "invalid") return false;
  return buildingsMatchingWorkplace(defs, buildings, job.workplace).length > 0;
}

export function kindDefOf(defs: Defs, kind: string): BuildingKindDef | undefined {
  return defs.buildingKinds[kind];
}

const SYS_TOKEN_SET = new Set<string>(Object.values(SYS));
const SYS_LABELS: Record<string, string> = {
  "sys:home": "Home",
  "sys:work": "Workplace",
  "sys:plaza": "Plaza",
  "sys:bed": "Bed",
  "sys:drink": "Drinking place",
  "sys:target": "Target",
  "sys:wander": "Wandering",
  "sys:eat": "Eatery",
};

/** Kind label from the catalog (kind ids are UUIDs; sys tokens get display names, unknown ids pass through). */
export function kindLabel(defs: Defs, kind: string): string {
  if (SYS_TOKEN_SET.has(kind)) return SYS_LABELS[kind] ?? kind;
  return defs.buildingKinds[kind]?.label ?? defs.businessTypes[kind]?.label ?? kind;
}

export function allKindIds(defs: Defs): string[] {
  return Object.keys(defs.buildingKinds);
}

/** Kinds tagged `home` (the household's residences). */
export function homeKindIds(defs: Defs): string[] {
  return Object.values(defs.buildingKinds)
    .filter((k) => k.tags.includes("home"))
    .map((k) => k.id);
}
