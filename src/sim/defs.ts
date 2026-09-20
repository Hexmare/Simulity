// Shipped catalog loader (docs/Data_Driven_Catalog.md §4, §6).
//
// Every shipped row lives in JSON under content/. This file statically imports
// each collection, builds the byId / bySlug / tagged indexes, and exposes the
// interpreter's sys:* vocabulary. No kind/job/need literals live here — they
// are data. Slugs are authoring-only metadata; runtime references use the id.

import type {
  AncestryDef,
  BtTree,
  BuildingKindDef,
  CommodityDef,
  Defs,
  GoalDef,
  JobDef,
  NamesCollection,
  NeedDef,
  SettingRow,
  SocialActionDef,
  SpellDef,
  TraitDef,
} from "./types.ts";

import { getKit } from "./kits.ts";

import needsRows from "../../content/catalog/needs.json" with { type: "json" };
import commodityRows from "../../content/catalog/commodities.json" with { type: "json" };
import traitRows from "../../content/catalog/traits.json" with { type: "json" };
import jobRows from "../../content/catalog/jobs.json" with { type: "json" };
import kindRows from "../../content/catalog/building-kinds.json" with { type: "json" };
import ancestryRows from "../../content/catalog/ancestries.json" with { type: "json" };
import spellRows from "../../content/catalog/spells.json" with { type: "json" };
import goalRows from "../../content/catalog/goals.json" with { type: "json" };
import socialRows from "../../content/catalog/social.json" with { type: "json" };
import namesRows from "../../content/catalog/names.json" with { type: "json" };
import settingRows from "../../content/catalog/setting.json" with { type: "json" };

import eatTree from "../../content/trees/eat.json" with { type: "json" };
import sleepTree from "../../content/trees/sleep.json" with { type: "json" };
import drinkTree from "../../content/trees/drink.json" with { type: "json" };
import wardTree from "../../content/trees/ward.json" with { type: "json" };
import workTree from "../../content/trees/work.json" with { type: "json" };
import socializeTree from "../../content/trees/socialize.json" with { type: "json" };
import hygieneTree from "../../content/trees/hygiene.json" with { type: "json" };
import relaxTree from "../../content/trees/relax.json" with { type: "json" };
import worshipTree from "../../content/trees/worship.json" with { type: "json" };
import wanderTree from "../../content/trees/wander.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Collection loading (shipped rows, file order preserved)

const needs = needsRows as unknown as NeedDef[];
const commodities = commodityRows as unknown as CommodityDef[];
const traits = traitRows as unknown as TraitDef[];
const jobs = jobRows as unknown as JobDef[];
const buildingKinds = kindRows as unknown as BuildingKindDef[];
const ancestries = ancestryRows as unknown as AncestryDef[];
const spells = spellRows as unknown as SpellDef[];
const goals = goalRows as unknown as GoalDef[];
const social = socialRows as unknown as SocialActionDef[];
const names = namesRows as unknown as NamesCollection & { setting?: SettingRow };
const settings = settingRows as unknown as SettingRow[];
const trees: BtTree[] = [
  eatTree,
  sleepTree,
  drinkTree,
  wardTree,
  workTree,
  socializeTree,
  hygieneTree,
  relaxTree,
  worshipTree,
  wanderTree,
].map((t) => t as unknown as BtTree);

function indexById<T extends { id: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) out[row.id] = row;
  return out;
}

function slugToId<T extends { id: string; slug: string }>(rows: T[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) out[row.slug] = row.id;
  return out;
}

/** First shipped kind in file order — fallback when a saved id is unknown. */
export const FIRST_KIND: BuildingKindDef = buildingKinds[0];

/** Catalog ids that exist in shipped content (not town overlays). */
export const SHIPPED_JOB_IDS: string[] = jobs.map((j) => j.id);
export const SHIPPED_KIND_IDS: string[] = buildingKinds.map((k) => k.id);
export const SHIPPED_ANCESTRY_IDS: string[] = ancestries.map((a) => a.id);
export const SHIPPED_SPELL_IDS: string[] = spells.map((s) => s.id);

// ---------------------------------------------------------------------------
// Interpreter vocabulary (docs/Urban_Fantasy_Default_World.md §3.4).
// The only non-UUID references allowed in runtime data.

export const SYS = {
  home: "sys:home",
  work: "sys:work",
  plaza: "sys:plaza",
  bed: "sys:bed",
  drink: "sys:drink",
  target: "sys:target",
  wander: "sys:wander",
  eat: "sys:eat",
} as const;

// Slug→UUID maps (documented exception to runtime-byId-only): a handful of
// engine rules keep addressing rows by slug for readability. The map is
// resolved once at load; runtime code compares the ids, so renaming a slug
// (a field write) changes nothing. All other runtime references use ids.

export const NEED: Record<string, string> = Object.freeze(slugToId(needs));
export const GOOD: Record<string, string> = Object.freeze(slugToId(commodities));
export const SOCIAL: Record<string, string> = Object.freeze(slugToId(social));
export const TRAIT: Record<string, string> = Object.freeze(slugToId(traits));
export const ANCESTRY: Record<string, string> = Object.freeze(slugToId(ancestries));
export const JOBS: Record<string, string> = Object.freeze(slugToId(jobs));

/** Kinds carrying a tag, in file order (e.g. `kindsByTag("gather")`). */
export function kindsByTag(tag: string): BuildingKindDef[] {
  return buildingKinds.filter((k) => k.tags.includes(tag));
}

// ---------------------------------------------------------------------------
// Defs construction (shipped catalog + active kit's setting)

/** Resolve the active setting row for a kit (kit.settingId, else first shipped). */
export function resolveSetting(kitId?: string): SettingRow {
  const kit = getKit(kitId);
  return settings.find((s) => s.id === kit.settingId) ?? settings[0];
}

/** Build the merged catalog: shipped rows + setting resolved from the active kit. */
export function buildDefs(kitId?: string): Defs {
  return {
    needs: [...needs],
    commodities: indexById(commodities),
    traits: indexById(traits),
    jobs: indexById(jobs),
    buildingKinds: indexById(buildingKinds),
    ancestries: indexById(ancestries),
    spells: indexById(spells),
    goals: [...goals],
    social: indexById(social),
    trees: indexById(trees),
    names,
    setting: resolveSetting(kitId),
  };
}

/** Shared default-defs instance (default kit). */
export const defs = buildDefs();
