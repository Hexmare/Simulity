import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { KNOWN_TAGS, WORKPLACE_TAGS, kindLabel, slugId } from "@/sim/custom";
import { SYS } from "@/sim/defs";
import { CLOTHING_SLOTS } from "@/sim/types";
import type { Defs } from "@/sim/types";
import { uid } from "@/sim/gen";
import type { World } from "@/sim/world";
import type { Send } from "@/components/game/Editors";
import { cn } from "@/lib/utils";

export type CollectionKey =
  | "ancestries"
  | "buildings"
  | "commodities"
  | "goals"
  | "jobs"
  | "names"
  | "needs"
  | "setting"
  | "social"
  | "spells"
  | "traits"
  | "garments"
  | "businessTypes";

export const COLLECTION_TITLES: Record<CollectionKey, string> = {
  ancestries: "Ancestries",
  buildings: "Building kinds",
  commodities: "Commodities",
  goals: "Goals",
  jobs: "Jobs",
  names: "Names",
  needs: "Needs",
  setting: "Setting",
  social: "Social actions",
  spells: "Spells",
  traits: "Traits",
  garments: "Garments",
  businessTypes: "Business types",
};

type Row = Record<string, any>;

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "check" | "select" | "textarea" | "json" | "list" | "tags" | "rooms" | "staff" | "workplace" | "hours" | "footprint";
  options?: { value: string; label: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
}

function roomsToText(rooms: { kind: string; name?: string }[] | undefined): string {
  return (rooms ?? []).map((r) => (r.name && r.name !== r.kind ? `${r.kind}: ${r.name}` : r.kind)).join(", ");
}

function textToRooms(raw: string): { kind: string; name: string }[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      return i < 0 ? { kind: s, name: s } : { kind: s.slice(0, i).trim() || "hall", name: s.slice(i + 1).trim() || s.slice(0, i).trim() };
    });
}

function listToText(list: string[] | undefined): string {
  return (list ?? []).join("\n");
}

function textToList(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function jsonToText(v: unknown): string {
  if (v == null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return "";
  }
}

function fieldValue(row: Row, f: FieldDef): any {
  const v = row[f.key];
  if (f.type === "list") return listToText(v);
  if (f.type === "tags") return Array.isArray(v) ? v.join(", ") : "";
  if (f.type === "rooms") return roomsToText(v);
  if (f.type === "json") return jsonToText(v);
  if (f.type === "hours") return { startHour: v?.startHour ?? 8, endHour: v?.endHour ?? 18 };
  if (f.type === "footprint") return { w: v?.w ?? 5, h: v?.h ?? 4 };
  if (f.type === "staff") return Array.isArray(v) ? v : [];
  if (f.type === "check") return !!v;
  if (f.type === "number") return v ?? 0;
  return v ?? "";
}

function convertValue(f: FieldDef, v: any): { ok: true; value: any } | { ok: false; error: string } {
  if (f.type === "number") {
    const n = Number(v);
    if (!Number.isFinite(n)) return { ok: false, error: `${f.label} must be a number.` };
    return { ok: true, value: n };
  }
  if (f.type === "check") return { ok: true, value: !!v };
  if (f.type === "list") return { ok: true, value: textToList(String(v ?? "")) };
  if (f.type === "tags") {
    return {
      ok: true,
      value: String(v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  if (f.type === "rooms") return { ok: true, value: textToRooms(String(v ?? "")) };
  if (f.type === "json") {
    const raw = String(v ?? "").trim();
    if (!raw) return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, error: `${f.label} is not valid JSON.` };
    }
  }
  if (f.type === "hours") {
    return { ok: true, value: { startHour: Number(v?.startHour ?? 0), endHour: Number(v?.endHour ?? 0) } };
  }
  if (f.type === "footprint") {
    return { ok: true, value: { w: Math.round(Number(v?.w ?? 5)), h: Math.round(Number(v?.h ?? 4)) } };
  }
  if (f.type === "staff") {
    const rows = Array.isArray(v) ? v : [];
    for (const s of rows) {
      if (!s.jobId) return { ok: false, error: "Every staff row needs a job." };
      if (!Number.isFinite(Number(s.countPerInstance)) || Number(s.countPerInstance) < 1) {
        return { ok: false, error: "Staff counts must be 1+." };
      }
    }
    return { ok: true, value: rows.map((s) => ({ jobId: s.jobId, countPerInstance: Math.round(Number(s.countPerInstance)) })) };
  }
  return { ok: true, value: typeof v === "string" ? v : v ?? "" };
}

function FieldInput({ f, value, onChange, defs }: { f: FieldDef; value: any; onChange: (v: any) => void; defs: Defs }) {
  if (f.type === "textarea" || f.type === "json") {
    return <Textarea className={f.type === "json" ? "min-h-24 font-mono text-xs" : "min-h-20"} value={String(value ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === "list") {
    return <Textarea className="min-h-20" value={String(value ?? "")} placeholder={f.placeholder ?? "One per line"} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === "number") {
    return <Input type="number" min={f.min} max={f.max} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === "check") {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        onClick={() => onChange(!value)}
        className={cn("h-11 rounded-md px-3 text-sm shadow-[var(--shadow-border)]", value ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
      >
        {value ? "Yes" : "No"}
      </button>
    );
  }
  if (f.type === "select" && f.options) {
    return (
      <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        {f.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  if (f.type === "workplace") {
    const sysOpts = Object.values(SYS).map((t) => ({ value: t, label: kindLabel(defs, t) }));
    const typeOpts = Object.values(defs.businessTypes).map((t) => ({ value: t.id, label: `Type · ${t.label}` }));
    const kindOpts = Object.values(defs.buildingKinds).map((k) => ({ value: k.id, label: `Kind · ${k.label}` }));
    const tagOpts = WORKPLACE_TAGS.map((t) => ({ value: t, label: `Tag · ${t}` }));
    return (
      <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        {[...sysOpts, ...typeOpts, ...kindOpts, ...tagOpts].map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  if (f.type === "hours") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" min={0} max={24} value={value?.startHour ?? 8} onChange={(e) => onChange({ ...value, startHour: Number(e.target.value) })} />
        <Input type="number" min={0} max={24} value={value?.endHour ?? 18} onChange={(e) => onChange({ ...value, endHour: Number(e.target.value) })} />
      </div>
    );
  }
  if (f.type === "footprint") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" min={3} max={20} value={value?.w ?? 5} onChange={(e) => onChange({ ...value, w: Number(e.target.value) })} />
        <Input type="number" min={3} max={14} value={value?.h ?? 4} onChange={(e) => onChange({ ...value, h: Number(e.target.value) })} />
      </div>
    );
  }
  if (f.type === "staff") {
    const rows = Array.isArray(value) ? value : [];
    const jobs = Object.values(defs.jobs);
    return (
      <div className="grid gap-2">
        {rows.map((s: any, i: number) => (
          <div key={i} className="flex gap-2">
            <Select value={s.jobId} onChange={(e) => onChange(rows.map((r: any, k: number) => (k === i ? { ...r, jobId: e.target.value } : r)))}>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={1}
              max={12}
              value={s.countPerInstance}
              onChange={(e) => onChange(rows.map((r: any, k: number) => (k === i ? { ...r, countPerInstance: Number(e.target.value) } : r)))}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(rows.filter((_: any, k: number) => k !== i))}>
              Drop
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([...rows, { jobId: jobs[0]?.id ?? "", countPerInstance: 1 }])}
        >
          Add staff
        </Button>
      </div>
    );
  }
  if (f.type === "tags") {
    const opts = f.options?.length ? f.options : null;
    if (opts) {
      const on = Array.isArray(value) ? value : String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return (
        <div className="flex flex-wrap gap-1">
          {opts.map((o) => {
            const active = on.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                className={cn("h-10 rounded-sm px-2 text-xs", active ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
                onClick={() => onChange(active ? on.filter((x: string) => x !== o.value) : [...on, o.value])}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    return <Input value={Array.isArray(value) ? value.join(", ") : String(value ?? "")} placeholder="comma, separated" onChange={(e) => onChange(e.target.value)} />;
  }
  return <Input value={String(value ?? "")} maxLength={200} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function RowForm({
  fields,
  defs,
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  fields: FieldDef[];
  defs: Defs;
  initial: Row;
  saveLabel: string;
  onSave: (row: Row) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<Row>(() => {
    const s: Row = {};
    for (const f of fields) s[f.key] = fieldValue(initial, f);
    return s;
  });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-2 rounded-sm bg-card-2 p-3">
      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <FieldInput f={f} value={state[f.key]} onChange={(v) => setState((s) => ({ ...s, [f.key]: v }))} defs={defs} />
        </Field>
      ))}
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            const out: Row = { ...initial };
            for (const f of fields) {
              const r = convertValue(f, state[f.key]);
              if (!r.ok) {
                setErr(r.error);
                return;
              }
              if (r.value === undefined) delete out[f.key];
              else out[f.key] = r.value;
            }
            if (!String(out.label ?? "").trim()) {
              setErr("Label is required.");
              return;
            }
            setErr(null);
            onSave(out);
          }}
        >
          {saveLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function schemaFor(collection: CollectionKey, defs: Defs): { fields: FieldDef[]; blank: () => Row } {
  const kindOpts = Object.values(defs.buildingKinds).map((k) => ({ value: k.id, label: k.label }));
  const treeOpts = Object.values(defs.trees).map((t) => ({ value: t.id, label: t.name }));
  switch (collection) {
    case "ancestries":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", plural: "", note: "", mark: "none", weight: 1, mundane: false }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "plural", label: "Plural", type: "text" },
          { key: "note", label: "Lore line", type: "textarea" },
          { key: "mark", label: "Mark", type: "select", options: ["none", "halo", "horns", "fangs"].map((m) => ({ value: m, label: m })) },
          { key: "weight", label: "Roster weight", type: "number", min: 0 },
          { key: "mundane", label: "Mundane (starts unconcealed)", type: "check" },
        ],
      };
    case "buildings":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", names: [], footprint: { w: 5, h: 4 }, stories: 1, ground: [{ kind: "shop", name: "Shop" }], tags: ["work", "shop"] }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "names", label: "Default names (one per line)", type: "list" },
          { key: "footprint", label: "Footprint w × h", type: "footprint" },
          { key: "stories", label: "Stories", type: "select", options: [{ value: "1", label: "1" }, { value: "2", label: "2" }] },
          { key: "ground", label: "Ground rooms (kind: Name, …)", type: "rooms" },
          { key: "upper", label: "Upper rooms", type: "rooms" },
          { key: "tags", label: "Tags", type: "tags", options: KNOWN_TAGS.map((t) => ({ value: t, label: t })) },
          { key: "stockDefaults", label: "Stock defaults (JSON id→qty)", type: "json" },
          { key: "layouts", label: "Layouts (JSON)", type: "json" },
          { key: "furniturePlan", label: "Furniture plan (JSON)", type: "json" },
        ],
      };
    case "commodities":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", price: 1 }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "price", label: "Price", type: "number", min: 0 },
          { key: "verb", label: "Work verb (optional)", type: "text" },
        ],
      };
    case "goals":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", treeId: treeOpts[0]?.value ?? "", considerations: [] }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug", type: "text" },
          { key: "treeId", label: "Tree", type: "select", options: treeOpts },
          { key: "considerations", label: "Considerations (JSON)", type: "json" },
        ],
      };
    case "jobs":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", workplace: SYS.home, startHour: 8, endHour: 17, wage: 1, palette: 0 }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "workplace", label: "Workplace matcher", type: "workplace" },
          { key: "startHour", label: "Start", type: "number", min: 0, max: 24 },
          { key: "endHour", label: "End", type: "number", min: 0, max: 24 },
          { key: "wage", label: "Wage", type: "number", min: 0 },
          { key: "palette", label: "Palette", type: "number", min: 0, max: 11 },
          { key: "produces", label: "Produces (JSON id→qty)", type: "json" },
          { key: "consumes", label: "Consumes (JSON id→qty)", type: "json" },
        ],
      };
    case "needs":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", decayPerHour: 2, criticalBelow: 20 }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "decayPerHour", label: "Decay / hour", type: "number", min: 0 },
          { key: "criticalBelow", label: "Critical below", type: "number", min: 0, max: 100 },
        ],
      };
    case "setting":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", line: "", bible: "" }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "line", label: "Line", type: "text" },
          { key: "bible", label: "Bible", type: "textarea" },
        ],
      };
    case "social":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", dc: 10, tags: [], socialRestore: 10, outcomes: { great: {}, success: {}, fail: {}, critFail: {} } }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "dc", label: "Difficulty", type: "number", min: 0 },
          { key: "tags", label: "Tags (comma-separated)", type: "tags" },
          { key: "socialRestore", label: "Social restore", type: "number", min: 0 },
          { key: "targetSocial", label: "Target social", type: "number", min: 0 },
          { key: "requires", label: "Requires (JSON)", type: "json" },
          { key: "outcomes", label: "Outcomes (JSON)", type: "json" },
        ],
      };
    case "spells":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", school: "", cost: 10, tags: [], effect: "" }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "school", label: "School", type: "text" },
          { key: "cost", label: "Cost", type: "number", min: 0 },
          { key: "tags", label: "Tags (comma-separated)", type: "tags" },
          { key: "effect", label: "Effect", type: "textarea" },
        ],
      };
    case "traits":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", modifiers: { needDecay: {}, socialHit: {}, utility: {} } }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "modifiers", label: "Modifiers (JSON)", type: "json" },
        ],
      };
    case "garments":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", slot: "shirt", layer: "inner", tags: [] }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "slot", label: "Slot", type: "select", options: CLOTHING_SLOTS.map((s) => ({ value: s, label: s })) },
          { key: "layer", label: "Layer", type: "select", options: ["under", "inner", "mid", "outer"].map((l) => ({ value: l, label: l })) },
          { key: "tags", label: "Tags (comma-separated)", type: "tags" },
        ],
      };
    case "businessTypes":
      return {
        blank: () => ({ id: uid(), slug: "", label: "", buildingKindId: kindOpts[0]?.value ?? "", staff: [], tags: ["shop", "work"] }),
        fields: [
          { key: "label", label: "Label", type: "text" },
          { key: "slug", label: "Slug (blank = from label)", type: "text" },
          { key: "buildingKindId", label: "Default shell", type: "select", options: kindOpts },
          { key: "staff", label: "Staff per instance", type: "staff" },
          { key: "stockDefaults", label: "Stock defaults (JSON)", type: "json" },
          { key: "tags", label: "Tags", type: "tags", options: KNOWN_TAGS.map((t) => ({ value: t, label: t })) },
          { key: "hours", label: "Hours start / end", type: "hours" },
        ],
      };
    default:
      return { blank: () => ({ id: uid(), label: "" }), fields: [{ key: "label", label: "Label", type: "text" }] };
  }
}

export function rowLabel(collection: CollectionKey, row: Row): string {
  if (collection === "names") return "Name lists";
  return String(row.label ?? row.id ?? collection);
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read a JSON file (kit or catalog rows); rejects illegal ages < 18 at the gate. */
export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

// ---- Live overlay: same forms, writing DefsOverlay on this city only ----

const OVERLAY_OPS: Record<Exclude<CollectionKey, "names" | "setting">, { add: string; remove: string }> = {
  ancestries: { add: "addAncestry", remove: "removeAncestry" },
  buildings: { add: "addBuildingKind", remove: "removeBuildingKind" },
  commodities: { add: "addCommodity", remove: "removeCommodity" },
  goals: { add: "addGoal", remove: "removeGoal" },
  jobs: { add: "addJob", remove: "removeJob" },
  needs: { add: "addNeed", remove: "removeNeed" },
  social: { add: "addSocial", remove: "removeSocial" },
  spells: { add: "addSpell", remove: "removeSpell" },
  traits: { add: "addTrait", remove: "removeTrait" },
  garments: { add: "addGarment", remove: "removeGarment" },
  businessTypes: { add: "addBusinessType", remove: "removeBusinessType" },
};

function overlayRows(world: World, collection: CollectionKey): Row[] {
  switch (collection) {
    case "ancestries":
      return Object.values(world.defs.ancestries);
    case "buildings":
      return Object.values(world.defs.buildingKinds);
    case "commodities":
      return Object.values(world.defs.commodities);
    case "goals":
      return world.defs.goals;
    case "jobs":
      return Object.values(world.defs.jobs);
    case "needs":
      return world.defs.needs;
    case "social":
      return Object.values(world.defs.social);
    case "spells":
      return Object.values(world.defs.spells);
    case "traits":
      return Object.values(world.defs.traits);
    case "garments":
      return Object.values(world.defs.garments);
    case "businessTypes":
      return Object.values(world.defs.businessTypes);
    default:
      return [];
  }
}

function collectionShippedIds(world: World, collection: CollectionKey): Set<string> {
  const ov = world.defsOverlay as unknown as Record<string, { rows: Record<string, unknown>; removedIds: string[] }>;
  const merged = new Set<string>();
  // Shipped = everything not authored in this city's overlay.
  for (const row of overlayRows(world, collection)) {
    const id = (row as { id: string }).id;
    if (!ov[overlayKey(collection)]?.rows[id]) merged.add(id);
  }
  return merged;
}

function overlayKey(collection: CollectionKey): string {
  if (collection === "buildings") return "buildings";
  return collection;
}

export function OverlayCatalog({ world, send, onMutate }: { world: World; send?: Send; onMutate: () => void }) {
  const [open, setOpen] = useState<CollectionKey | null>(null);
  const [editing, setEditing] = useState<{ collection: CollectionKey; row: Row } | null>(null);
  const [adding, setAdding] = useState<CollectionKey | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const call = (method: string, args: unknown[]): string | null => {
    if (send) {
      send({ type: "call", method, args });
      return null;
    }
    const fn = (world as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    const r = fn?.(...args);
    return typeof r === "string" ? r : null;
  };
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">City catalog — this city only</p>
      {(Object.keys(OVERLAY_OPS) as (keyof typeof OVERLAY_OPS)[]).map((collection) => {
        const rows = overlayRows(world, collection);
        const shipped = collectionShippedIds(world, collection);
        const isOpen = open === collection;
        return (
          <div key={collection} className="rounded-sm bg-card-2 px-3 py-2">
            <button type="button" className="flex w-full items-center justify-between text-sm" onClick={() => setOpen(isOpen ? null : (collection as CollectionKey))}>
              <span>
                {COLLECTION_TITLES[collection as CollectionKey]} <span className="text-muted">· {rows.length}</span>
              </span>
              <span className="text-xs text-muted">{isOpen ? "Hide" : "Edit"}</span>
            </button>
            {isOpen && (
              <div className="mt-2 grid gap-1">
                {rows.map((row) => {
                  const id = (row as { id: string }).id;
                  const custom = !shipped.has(id);
                  return (
                    <div key={id}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">
                          {rowLabel(collection as CollectionKey, row)} {!custom ? null : <span className="text-muted">· custom</span>}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                            onClick={() => {
                              setEditing({ collection: collection as CollectionKey, row });
                              setAdding(null);
                              setMsg(null);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="h-10 rounded-sm px-2 text-xs text-danger hover:bg-card"
                            onClick={() => {
                              const err = call(OVERLAY_OPS[collection].remove, [id]);
                              setMsg(err ?? "Forgotten in this city.");
                              onMutate();
                            }}
                          >
                            Forget
                          </button>
                        </span>
                      </div>
                      {editing?.collection === collection && editing.row.id === id && (
                        <RowForm
                          fields={schemaFor(collection as CollectionKey, world.defs).fields}
                          defs={world.defs}
                          initial={editing.row}
                          saveLabel="Save in this city"
                          onCancel={() => setEditing(null)}
                          onSave={(next) => {
                            const patch: Row = {};
                            for (const k of Object.keys(next)) {
                              if (k === "id") continue;
                              patch[k] = next[k];
                            }
                            // Live world + server stay in sync (same pattern as KindsJobs).
                            const err = world.patchCatalogRow(collection as "jobs", id, patch);
                            if (err) {
                              setMsg(err);
                              return;
                            }
                            send?.({ type: "call", method: "patchCatalogRow", args: [collection, id, patch] });
                            setEditing(null);
                            setMsg("Saved in this city.");
                            onMutate();
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {adding === collection ? (
                  <RowForm
                    fields={schemaFor(collection as CollectionKey, world.defs).fields}
                    defs={world.defs}
                    initial={schemaFor(collection as CollectionKey, world.defs).blank()}
                    saveLabel="Add in this city"
                    onCancel={() => setAdding(null)}
                    onSave={(next) => {
                      if (!next.slug) next.slug = slugId(String(next.label ?? ""));
                      const err = world[OVERLAY_OPS[collection].add as "addJob"](next as never) as unknown as string | null;
                      if (typeof err === "string" && err) {
                        setMsg(err);
                        return;
                      }
                      send?.({ type: "call", method: OVERLAY_OPS[collection].add, args: [next] });
                      setAdding(null);
                      setMsg(`“${String(next.label)}” is known in this city.`);
                      onMutate();
                    }}
                  />
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(collection as CollectionKey); setEditing(null); setMsg(null); }}>
                    Add row
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <p className="text-xs text-muted">Shipped rows stay read-only in git — edits land in this city’s overlay only.</p>
    </div>
  );
}

// ---- Library (start screen): shipped read-only, custom JSON on the server ----

export function LibraryCatalog({
  defs,
  catalog,
  onSaveRows,
  onDeleteRow,
  busy,
}: {
  defs: Defs;
  catalog: Record<string, { id: string }[]>;
  onSaveRows: (collection: CollectionKey, rows: unknown[]) => Promise<string | null>;
  onDeleteRow: (collection: CollectionKey, id: string) => Promise<void>;
  busy?: boolean;
}) {
  const [open, setOpen] = useState<CollectionKey | null>(null);
  const [editing, setEditing] = useState<{ collection: CollectionKey; row: Row } | null>(null);
  const [adding, setAdding] = useState<CollectionKey | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importTarget, setImportTarget] = useState<CollectionKey | null>(null);

  const shippedRows = useMemo(() => libraryShipped(defs), [defs]);

  return (
    <div className="grid gap-2">
      <NamesEditor defs={defs} catalog={catalog} onSaveRows={onSaveRows} busy={busy} />
      {(["ancestries", "buildings", "businessTypes", "jobs", "garments", "commodities", "goals", "needs", "setting", "social", "spells", "traits"] as CollectionKey[]).map(
        (collection) => {
          const ship = shippedRows[collection] ?? [];
          const custom = (catalog[collection] ?? []) as Row[];
          const isOpen = open === collection;
          return (
            <div key={collection} className="rounded-sm bg-card-2 px-3 py-2">
              <button type="button" className="flex w-full items-center justify-between text-sm" onClick={() => setOpen(isOpen ? null : collection)}>
                <span>
                  {COLLECTION_TITLES[collection]} <span className="text-muted">· {ship.length + custom.length}</span>
                </span>
                <span className="text-xs text-muted">{isOpen ? "Hide" : "Edit"}</span>
              </button>
              {isOpen && (
                <div className="mt-2 grid gap-1">
                  {ship.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{rowLabel(collection, row)}</span>
                      <button
                        type="button"
                        disabled={busy}
                        className="h-10 shrink-0 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                        onClick={() => {
                          setEditing({ collection, row: { ...row, id: uid(), slug: "" } });
                          setAdding(null);
                          setMsg(null);
                        }}
                      >
                        Duplicate
                      </button>
                    </div>
                  ))}
                  {custom.map((row) => (
                    <div key={row.id}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">
                          {rowLabel(collection, row)} <span className="text-muted">· custom</span>
                        </span>
                        <span className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                            onClick={() => {
                              setEditing({ collection, row });
                              setAdding(null);
                              setMsg(null);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="h-10 rounded-sm px-2 text-xs text-danger hover:bg-card"
                            onClick={() => void onDeleteRow(collection, row.id)}
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                      {editing?.collection === collection && editing.row.id === row.id && (
                        <RowForm
                          fields={schemaFor(collection, defs).fields}
                          defs={defs}
                          initial={editing.row}
                          saveLabel="Save custom"
                          onCancel={() => setEditing(null)}
                          onSave={(next) => void onSaveRows(collection, [next]).then((err) => (err ? setMsg(err) : (setEditing(null), setMsg("Saved."))))}
                        />
                      )}
                    </div>
                  ))}
                  {editing && editing.collection === collection && !custom.some((r) => r.id === editing.row.id) && !ship.some((r) => r.id === editing.row.id) && (
                    <RowForm
                      fields={schemaFor(collection, defs).fields}
                      defs={defs}
                      initial={editing.row}
                      saveLabel="Save custom"
                      onCancel={() => setEditing(null)}
                      onSave={(next) => void onSaveRows(collection, [next]).then((err) => (err ? setMsg(err) : (setEditing(null), setMsg("Saved."))))}
                    />
                  )}
                  {adding === collection ? (
                    <RowForm
                      fields={schemaFor(collection, defs).fields}
                      defs={defs}
                      initial={schemaFor(collection, defs).blank()}
                      saveLabel="Save custom"
                      onCancel={() => setAdding(null)}
                      onSave={(next) => void onSaveRows(collection, [next]).then((err) => (err ? setMsg(err) : (setAdding(null), setMsg("Saved."))))}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setAdding(collection); setEditing(null); setMsg(null); }}>
                        Add custom
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const all = [...ship, ...custom];
                          downloadJsonFile(`${collection}.json`, all);
                        }}
                      >
                        Download
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setImportTarget(collection);
                          fileRef.current?.click();
                        }}
                      >
                        Upload
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        },
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !importTarget) return;
          void readJsonFile(f)
            .then((raw) => {
              const rows = Array.isArray(raw) ? raw : [raw];
              return onSaveRows(importTarget, rows);
            })
            .then((err) => setMsg(err ?? "Uploaded."))
            .catch(() => setMsg("Could not read that file."));
        }}
      />
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <p className="text-xs text-muted">Shipped rows are read-only — duplicate one to edit it. New cities pick up custom rows.</p>
    </div>
  );
}

export function NamesEditor({
  defs,
  catalog,
  onSaveRows,
  busy,
}: {
  defs: Defs;
  catalog: Record<string, { id: string }[]>;
  onSaveRows: (collection: CollectionKey, rows: unknown[]) => Promise<string | null>;
  busy?: boolean;
}) {
  const custom = (catalog.names ?? [])[0] as { firstF?: string[]; firstM?: string[]; surnames?: string[] } | undefined;
  const [open, setOpen] = useState(false);
  const [firstF, setFirstF] = useState("");
  const [firstM, setFirstM] = useState("");
  const [surnames, setSurnames] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="rounded-sm bg-card-2 px-3 py-2">
      <button type="button" className="flex w-full items-center justify-between text-sm" onClick={() => setOpen(!open)}>
        <span>
          Names <span className="text-muted">· {defs.names.firstF.length + defs.names.firstM.length + defs.names.surnames.length} shipped{custom ? " + custom" : ""}</span>
        </span>
        <span className="text-xs text-muted">{open ? "Hide" : "Edit"}</span>
      </button>
      {open && (
        <div className="mt-2 grid gap-2">
          <p className="text-xs text-muted">Custom names are added to the shipped lists for new cities. Adults 18+ only — names carry no ages.</p>
          <Field label="First names (f, one per line)">
            <Textarea className="min-h-20" value={firstF} onChange={(e) => setFirstF(e.target.value)} />
          </Field>
          <Field label="First names (m, one per line)">
            <Textarea className="min-h-20" value={firstM} onChange={(e) => setFirstM(e.target.value)} />
          </Field>
          <Field label="Surnames (one per line)">
            <Textarea className="min-h-20" value={surnames} onChange={(e) => setSurnames(e.target.value)} />
          </Field>
          {msg && <p className="text-xs text-muted">{msg}</p>}
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              const doc = {
                firstF: textToList(firstF),
                firstM: textToList(firstM),
                surnames: textToList(surnames),
              };
              void onSaveRows("names", [doc]).then((err) => {
                setMsg(err ?? "Saved.");
                if (!err) {
                  setFirstF("");
                  setFirstM("");
                  setSurnames("");
                }
              });
            }}
          >
            Save custom names
          </Button>
        </div>
      )}
    </div>
  );
}

export function libraryShipped(defs: Defs): Record<string, Row[]> {
  return {
    ancestries: Object.values(defs.ancestries),
    buildings: Object.values(defs.buildingKinds),
    commodities: Object.values(defs.commodities),
    goals: defs.goals,
    jobs: Object.values(defs.jobs),
    needs: defs.needs,
    setting: [defs.setting],
    social: Object.values(defs.social),
    spells: Object.values(defs.spells),
    traits: Object.values(defs.traits),
    garments: Object.values(defs.garments),
    businessTypes: Object.values(defs.businessTypes),
  };
}

export function downloadJsonFile(filename: string, value: unknown) {
  downloadJson(filename, value);
}
