import type { Building, BuildingKindDef, Defs, JobDef } from "./types.ts";
import { SYS, kindsByTag } from "./defs.ts";

export const KNOWN_TAGS = ["home", "work", "shop", "gather", "worship", "eat"];

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
    return `Workplace “${def.workplace}” is not a known kind or sys token. Use a kind UUID, ${SYS.home} or ${SYS.plaza}.`;
  }
  if (def.startHour < 0 || def.startHour > 24 || def.endHour < 0 || def.endHour > 24) return "Shift hours must be 0–24.";
  return null;
}

export type WorkTarget = { type: "building"; id: string } | { type: "home" };

/** Kinds tagged `gather`, by id (the town's public square). */
function gatherKindIds(): Set<string> {
  return new Set(kindsByTag("gather").map((k) => k.id));
}

/** The first built building of the given kind (or, for plaza tokens, the first gather house). */
export function workBuildingOf(buildings: Building[], job: JobDef): Building | null {
  const want = job.workplace === SYS.plaza ? [...gatherKindIds()] : [job.workplace];
  return buildings.find((b) => want.includes(b.kind)) ?? null;
}

/** Runtime workId: sys tokens / kind UUID → a building id, or null (odd jobs, purse-paid). */
export function resolveWorkId(buildings: Building[], job: JobDef, homeId: string): string | null {
  if (job.workplace === SYS.home) return homeId;
  return workBuildingOf(buildings, job)?.id ?? null;
}

/** Display target: where a job works (falls back to the household's home). */
export function resolveWorkTarget(buildings: Building[], _homeId: string, job: JobDef): WorkTarget {
  if (job.workplace === SYS.home) return { type: "home" };
  const b = workBuildingOf(buildings, job);
  return b ? { type: "building", id: b.id } : { type: "home" };
}

/** True when the job's named workplace actually exists on the map. */
export function hasWorkplace(buildings: Building[], job: JobDef): boolean {
  if (job.workplace === SYS.home) return true;
  const gather = gatherKindIds();
  if (job.workplace === SYS.plaza) return buildings.some((b) => gather.has(b.kind));
  return buildings.some((b) => b.kind === job.workplace);
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
  return defs.buildingKinds[kind]?.label ?? kind;
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
