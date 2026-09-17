import type { Building, BuildingKindDef, Defs, JobDef } from "./types";

export const KNOWN_TAGS = ["home", "work", "shop", "gather", "worship"];

export function slugId(label: string): string {
  const s = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "custom";
}

export function validateKindDef(
  def: { id: string; label: string; footprint: { w: number; h: number }; stories: number; ground: { kind: string; name: string }[]; tags: string[] },
  taken: Set<string>,
): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(def.id)) return "Id must be lowercase letters, numbers, dashes.";
  if (taken.has(def.id)) return `“${def.id}” already exists.`;
  if (!def.label.trim()) return "Label is required.";
  if (!Number.isFinite(def.footprint.w) || !Number.isFinite(def.footprint.h)) return "Footprint must be numbers.";
  if (def.footprint.w < 3 || def.footprint.h < 3) return "Footprint must be at least 3×3.";
  if (def.footprint.w > 14 || def.footprint.h > 12) return "Footprint max is 14×12.";
  if (def.stories !== 1 && def.stories !== 2) return "Stories must be 1 or 2.";
  if (!def.ground.length) return "Ground floor needs at least one room.";
  for (const r of def.ground) {
    if (!r.kind.trim()) return "Every room needs a kind.";
  }
  return null;
}

export function validateJobDef(
  def: { id: string; label: string; workplace: string; startHour: number; endHour: number },
  takenJobs: Set<string>,
  knownWorkplaces: Set<string>,
): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(def.id)) return "Id must be lowercase letters, numbers, dashes.";
  if (takenJobs.has(def.id)) return `“${def.id}” already exists.`;
  if (!def.label.trim()) return "Label is required.";
  if (!knownWorkplaces.has(def.workplace)) return `Workplace “${def.workplace}” is not a known kind. Use home or plaza.`;
  if (def.startHour < 0 || def.startHour > 24 || def.endHour < 0 || def.endHour > 24) return "Shift hours must be 0–24.";
  return null;
}

export type WorkTarget = { type: "building"; id: string } | { type: "home" } | { type: "plaza" };

/** Resolve where a job works: a matching building, home, or plaza fallback. */
export function resolveWorkTarget(buildings: Building[], homeId: string, job: JobDef): WorkTarget {
  if (job.workplace === "home") return { type: "home" };
  if (job.workplace === "plaza") {
    const market = buildings.find((b) => b.kind === "market") ?? buildings.find((b) => b.kind === "well");
    return market ? { type: "building", id: market.id } : { type: "home" };
  }
  const match = buildings.find((b) => b.kind === job.workplace);
  if (match) return { type: "building", id: match.id };
  const market = buildings.find((b) => b.kind === "market");
  return market ? { type: "building", id: market.id } : { type: "home" };
}

/** True when the job's named workplace actually exists on the map. */
export function hasWorkplace(buildings: Building[], job: JobDef): boolean {
  if (job.workplace === "home" || job.workplace === "plaza") return true;
  return buildings.some((b) => b.kind === job.workplace);
}

export function kindDefOf(defs: Defs, kind: string): BuildingKindDef | undefined {
  return defs.buildingKinds[kind];
}

export function kindLabel(defs: Defs, kind: string): string {
  return defs.buildingKinds[kind]?.label ?? kind;
}

export function allKindIds(defs: Defs): string[] {
  return Object.keys(defs.buildingKinds);
}

export function homeKindIds(defs: Defs): string[] {
  const ids = Object.values(defs.buildingKinds)
    .filter((k) => k.tags.includes("home"))
    .map((k) => k.id);
  if (!ids.includes("tavern")) ids.push("tavern");
  return ids;
}
