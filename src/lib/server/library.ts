import { createServerFn } from "@tanstack/react-start";
import { buildDefs } from "@/sim/defs";
import {
  agesAdult,
  applyLibraryDefs,
  blankOverlay,
  isUuidV4,
  knownWorkplaces,
  slugId,
  validateBusinessTypeDef,
  validateGarmentDef,
  validateJobDef,
  validateKindDef,
  validateKit,
  validateSimpleRow,
  type KitCheck,
} from "@/sim/custom";
import type { Defs, Kit } from "@/sim/types";
import { readLibraryCatalog, readLibraryKits, writeLibraryCatalog, writeLibraryKits } from "@/lib/server/store";

export const LIBRARY_COLLECTIONS = [
  "ancestries",
  "buildings",
  "commodities",
  "goals",
  "jobs",
  "names",
  "needs",
  "setting",
  "social",
  "spells",
  "traits",
  "garments",
  "businessTypes",
] as const;

export type LibraryCollection = (typeof LIBRARY_COLLECTIONS)[number];

/** JSON-safe catalog payload (server-fn serializable). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type LibraryCatalog = Record<string, JsonValue[]>;

/** Defs preview: shipped rows + every custom Library row. */
export function previewDefs(catalog?: LibraryCatalog): Defs {
  const defs = buildDefs();
  if (catalog) applyLibraryDefs(defs, blankOverlay(), catalog as Record<string, unknown[]>);
  return defs;
}

function asRecord(row: unknown): Record<string, JsonValue> | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return row as Record<string, JsonValue>;
}

function slugTaken(defs: Defs, collection: string, slug: string, exceptId?: string): boolean {
  const cols: Record<string, Record<string, { id: string; slug?: string }>> = {
    ancestries: defs.ancestries,
    buildings: defs.buildingKinds,
    commodities: defs.commodities,
    spells: defs.spells,
    businessTypes: defs.businessTypes,
    garments: defs.garments,
    social: defs.social,
    traits: defs.traits,
    jobs: defs.jobs,
  };
  const col = cols[collection];
  if (!col) return false;
  return Object.values(col).some((r) => r.slug === slug && r.id !== exceptId);
}

/** Validate one custom catalog row against the merged (shipped + custom) defs. */
export function validateLibraryRow(defs: Defs, collection: string, row: unknown): string | null {
  const r = asRecord(row);
  if (!r) return "Row must be an object.";
  // Single-doc collections carry no row id.
  if (collection === "names") {
    for (const k of ["firstF", "firstM", "surnames"]) {
      const v = r[k];
      if (v !== undefined && (!Array.isArray(v) || !v.every((x) => typeof x === "string"))) {
        return `${k} must be a list of names.`;
      }
    }
    return null;
  }
  if (collection === "setting") {
    if (typeof r.label !== "string" || !r.label.trim()) return "Label is required.";
    if (typeof r.bible !== "string" || !r.bible.trim()) return "Bible is required.";
    return null;
  }
  const id = r.id;
  if (typeof id !== "string" || !isUuidV4(id)) return "Id must be a version-4 UUID.";
  if (typeof r.label !== "string" || !r.label.trim()) return "Label is required.";
  const label = r.label;
  const slug = typeof r.slug === "string" && r.slug.trim() ? r.slug : slugId(label);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return "Slug must be lowercase letters, numbers and dashes.";
  const taken = new Set<string>();
  const idTaken = (() => {
    const cols: Record<string, Record<string, unknown>> = {
      ancestries: defs.ancestries,
      buildings: defs.buildingKinds,
      commodities: defs.commodities,
      spells: defs.spells,
      businessTypes: defs.businessTypes,
      garments: defs.garments,
      social: defs.social,
      traits: defs.traits,
      jobs: defs.jobs,
    };
    const col = cols[collection];
    return !!col && !!col[id] && (col[id] as { id?: string })?.id === id;
  })();
  void taken;
  void idTaken;
  // Slug uniqueness spans shipped ∪ custom; id collisions with shipped rows are
  // rejected (duplicate-to-custom assigns a fresh id instead).
  if (slugTaken(defs, collection, slug, id)) return `The slug “${slug}” is already in use.`;
  if (collection === "jobs") {
    const workplace = r.workplace;
    if (typeof workplace !== "string" || !knownWorkplaces(defs).has(workplace)) {
      return "Workplace must be a known business type, kind, tag, or sys token.";
    }
    const startHour = Number(r.startHour ?? 0);
    const endHour = Number(r.endHour ?? 0);
    return validateJobDef(
      { id, slug, label, workplace, startHour, endHour },
      new Set(),
      knownWorkplaces(defs),
      new Set(),
    );
  }
  if (collection === "buildings") {
    const footprint = (r.footprint && typeof r.footprint === "object" && !Array.isArray(r.footprint) ? r.footprint : {}) as Record<string, JsonValue>;
    const ground = Array.isArray(r.ground)
      ? r.ground.flatMap((g) => {
          const o = asRecord(g);
          return o && typeof o.kind === "string" ? [{ kind: o.kind, name: typeof o.name === "string" ? o.name : o.kind }] : [];
        })
      : [];
    const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [];
    return validateKindDef(
      {
        id,
        slug,
        label,
        footprint: { w: Number(footprint.w ?? 0), h: Number(footprint.h ?? 0) },
        stories: Number(r.stories ?? 1),
        ground,
        tags,
      },
      new Set(),
      new Set(),
    );
  }
  if (collection === "businessTypes") {
    const staff = Array.isArray(r.staff)
      ? r.staff.flatMap((s) => {
          const o = asRecord(s);
          return o && typeof o.jobId === "string" ? [{ jobId: o.jobId, countPerInstance: Math.max(1, Math.round(Number(o.countPerInstance ?? 1))) }] : [];
        })
      : [];
    const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [];
    const hours = asRecord(r.hours ?? {});
    return validateBusinessTypeDef(
      {
        id,
        slug,
        label,
        buildingKindId: typeof r.buildingKindId === "string" ? r.buildingKindId : "",
        staff,
        tags,
        hours: hours ? { startHour: Number(hours.startHour ?? 0), endHour: Number(hours.endHour ?? 0) } : undefined,
      },
      new Set(),
      new Set(),
      defs,
    );
  }
  if (collection === "garments") {
    return validateGarmentDef({ id, slug, label, slot: String(r.slot ?? ""), layer: String(r.layer ?? "") }, new Set(), new Set());
  }
  if (collection === "needs" || collection === "goals" || collection === "social" || collection === "traits" || collection === "commodities" || collection === "spells" || collection === "ancestries") {
    return validateSimpleRow({ id, slug, label }, new Set(), new Set());
  }
  return `Unknown collection “${collection}”.`;
}

export function validateLibraryKit(kit: unknown, defs: Defs): KitCheck {
  const r = asRecord(kit);
  if (!r) return { errors: ["Kit must be an object."], warnings: [] };
  const buildings = Array.isArray(r.buildings)
    ? r.buildings.flatMap((b) => {
        const o = asRecord(b);
        return o && typeof o.kindId === "string" ? [{ kindId: o.kindId, count: Math.max(1, Math.round(Number(o.count ?? 1))), typeId: typeof o.typeId === "string" ? o.typeId : undefined }] : [];
      })
    : [];
  const homes = Array.isArray(r.homes) ? r.homes.filter((h): h is string => typeof h === "string") : [];
  const roster = Array.isArray(r.roster)
    ? r.roster.flatMap((x) => {
        const o = asRecord(x);
        if (!o || typeof o.jobId !== "string") return [];
        const ages = Array.isArray(o.ages) ? [Number(o.ages[0] ?? 18), Number(o.ages[1] ?? 18)] as [number, number] : undefined;
        return [{ jobId: o.jobId, count: Math.max(1, Math.round(Number(o.count ?? 1))), ages }];
      })
    : [];
  return validateKit(
    {
      id: typeof r.id === "string" ? r.id : "",
      slug: typeof r.slug === "string" ? r.slug : "",
      label: typeof r.label === "string" ? r.label : "",
      buildings,
      homes,
      roster,
      defaultPcJobId: typeof r.defaultPcJobId === "string" ? r.defaultPcJobId : "",
      pcAge: Number(r.pcAge ?? 0),
      pcHomeKindId: typeof r.pcHomeKindId === "string" ? r.pcHomeKindId : undefined,
    },
    defs,
  );
}

export const listLibraryFn = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(async (): Promise<{ kits: Kit[]; catalog: LibraryCatalog }> => {
    const [kits, catalog] = await Promise.all([readLibraryKits(), readLibraryCatalog()]);
    return { kits, catalog };
  });

export const putKitFn = createServerFn({ method: "POST" })
  .validator((input: { kit: unknown }) => input)
  .handler(async ({ data }): Promise<{ kits: Kit[]; warnings: string[] }> => {
    const catalog = await readLibraryCatalog();
    const defs = previewDefs(catalog);
    const check = validateLibraryKit(data.kit, defs);
    if (check.errors.length) throw new Error(check.errors[0]);
    const kit = data.kit as Kit;
    const kits = await readLibraryKits();
    const at = kits.findIndex((k) => k.id === kit.id);
    if (at >= 0) kits[at] = kit;
    else kits.push(kit);
    await writeLibraryKits(kits);
    return { kits, warnings: check.warnings };
  });

export const deleteKitFn = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<{ kits: Kit[] }> => {
    const kits = (await readLibraryKits()).filter((k) => k.id !== String(data.id ?? ""));
    await writeLibraryKits(kits);
    return { kits };
  });

export const putCatalogRowsFn = createServerFn({ method: "POST" })
  .validator((input: { collection: string; rows: JsonValue[] }) => input)
  .handler(async ({ data }): Promise<{ catalog: LibraryCatalog }> => {
    const collection = String(data.collection ?? "");
    if (!(LIBRARY_COLLECTIONS as readonly string[]).includes(collection)) throw new Error(`Unknown collection “${collection}”.`);
    if (!Array.isArray(data.rows)) throw new Error("Rows must be an array.");
    const catalog = await readLibraryCatalog();
    // Validate against defs that already include the other custom rows.
    const defs = previewDefs(catalog);
    for (const row of data.rows) {
      const err = validateLibraryRow(defs, collection, row);
      if (err) throw new Error(err);
    }
    // Upsert by id (names/setting docs merge by shape).
    const prev = Array.isArray(catalog[collection]) ? catalog[collection]! : [];
    const next: JsonValue[] = [...prev];
    for (const row of data.rows) {
      const r = asRecord(row)!;
      const at = next.findIndex((x) => asRecord(x)?.id === r.id && r.id !== undefined);
      if (collection === "names" || collection === "setting") {
        // Single-doc collections: replace the whole doc list.
        next.length = 0;
        next.push(row);
        break;
      }
      if (at >= 0) next[at] = row;
      else next.push(row);
    }
    // Ages 18+: kit-side check lives in validateLibraryKit; catalog rows with
    // age bands (none shipped) are rejected here as a backstop.
    for (const row of next) {
      const ages = asRecord(row)?.ages;
      if (ages !== undefined) {
        const err = agesAdult(Array.isArray(ages) ? ([Number(ages[0]), Number(ages[1])] as [number, number]) : undefined);
        if (err) throw new Error(err);
      }
    }
    catalog[collection] = next;
    await writeLibraryCatalog(catalog);
    return { catalog };
  });

export const deleteCatalogRowFn = createServerFn({ method: "POST" })
  .validator((input: { collection: string; id: string }) => input)
  .handler(async ({ data }): Promise<{ catalog: LibraryCatalog }> => {
    const collection = String(data.collection ?? "");
    const catalog = await readLibraryCatalog();
    const prev = Array.isArray(catalog[collection]) ? catalog[collection]! : [];
    catalog[collection] = prev.filter((x) => asRecord(x)?.id !== String(data.id ?? ""));
    await writeLibraryCatalog(catalog);
    return { catalog };
  });
