import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { validateKit } from "@/sim/custom";
import { kitPopulation } from "@/sim/kits";
import type { Defs, Kit, KitBuildingEntry, KitRosterEntry } from "@/sim/types";
import { uid } from "@/sim/gen";
import { downloadJsonFile, readJsonFile } from "@/components/game/CatalogForms";
import { cn } from "@/lib/utils";

/** Derived staff line: what typed buildings imply, so the kit stays buildings-first. */
export function staffPreview(kit: Kit, defs: Defs): string {
  const parts: string[] = [];
  for (const entry of kit.buildings) {
    if (!entry.typeId) continue;
    const type = defs.businessTypes[entry.typeId];
    if (!type) continue;
    for (const s of type.staff) {
      const job = defs.jobs[s.jobId];
      if (!job) continue;
      parts.push(`${entry.count * s.countPerInstance} ${job.label}`);
    }
  }
  return parts.length ? `From buildings: ${parts.join(", ")}.` : "From buildings: no staff.";
}

function blankKit(defs: Defs): Kit {
  const kinds = Object.keys(defs.buildingKinds);
  const jobs = Object.keys(defs.jobs);
  return {
    id: uid(),
    slug: "",
    label: "Untitled city",
    buildings: kinds.slice(0, 2).map((kindId) => ({ kindId, count: 2 })),
    homes: kinds.slice(0, 1),
    roster: jobs.slice(0, 2).map((jobId) => ({ jobId, count: 4, ages: [18, 58] as [number, number] })),
    defaultPcJobId: jobs[0] ?? "",
    pcAge: 30,
    unnamedHomePattern: "{surname} House",
  };
}

export function KitBuilder({
  shipped,
  custom,
  defs,
  busy,
  onSave,
  onDelete,
  onUse,
}: {
  shipped: Kit[];
  custom: Kit[];
  defs: Defs;
  busy?: boolean;
  onSave: (kit: Kit) => Promise<string | null>;
  onDelete: (id: string) => Promise<void>;
  onUse: (kit: Kit) => void;
}) {
  const [editing, setEditing] = useState<Kit | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="grid gap-2">
      {shipped.map((kit) => (
        <div key={kit.id} className="rounded-sm bg-card-2 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">
              {kit.label} <span className="text-muted">· shipped · {kitPopulation(kit)} souls + staff</span>
            </span>
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                onClick={() => {
                  setEditing({ ...structuredClone(kit), id: uid(), label: `${kit.label} copy` });
                  setMsg(null);
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                onClick={() => downloadJsonFile(`${kit.slug || "kit"}.json`, kit)}
              >
                Download
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                onClick={() => onUse(kit)}
              >
                Use
              </button>
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">{staffPreview(kit, defs)}</p>
        </div>
      ))}
      {custom.map((kit) => (
        <div key={kit.id}>
          <div className="flex items-center justify-between gap-2 rounded-sm bg-card-2 px-3 py-2 text-sm">
            <span className="truncate">
              {kit.label} <span className="text-muted">· custom · {kitPopulation(kit)} souls + staff</span>
            </span>
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                onClick={() => {
                  setEditing(structuredClone(kit));
                  setMsg(null);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                onClick={() => downloadJsonFile(`${kit.slug || "kit"}.json`, kit)}
              >
                Download
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-sm px-2 text-xs text-muted hover:bg-card hover:text-foreground"
                onClick={() => onUse(kit)}
              >
                Use
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-sm px-2 text-xs text-danger hover:bg-card"
                onClick={() => void onDelete(kit.id)}
              >
                Delete
              </button>
            </span>
          </div>
          {editing?.id === kit.id && (
            <KitForm
              defs={defs}
              initial={editing}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSave={(next) => void onSave(next).then((err) => (err ? setMsg(err) : (setEditing(null), setMsg("Saved."))))}
            />
          )}
        </div>
      ))}
      {editing && !custom.some((k) => k.id === editing.id) && !shipped.some((k) => k.id === editing.id) && (
        <KitForm
          defs={defs}
          initial={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(next) => void onSave(next).then((err) => (err ? setMsg(err) : (setEditing(null), setMsg("Saved."))))}
        />
      )}
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(blankKit(defs)); setMsg(null); }}>
          New kit
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          Upload kit
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          void readJsonFile(f)
            .then((raw) => {
              const kit = (Array.isArray(raw) ? raw[0] : raw) as Kit;
              if (!kit || typeof kit !== "object") throw new Error("bad kit");
              return onSave(kit as Kit);
            })
            .then((err) => setMsg(err ?? "Uploaded."))
            .catch(() => setMsg("Could not read that kit file."));
        }}
      />
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <p className="text-xs text-muted">Shipped kits are read-only — duplicate one to edit it. “Use this kit” fills the generation picker.</p>
    </div>
  );
}

function KitForm({ defs, initial, busy, onCancel, onSave }: { defs: Defs; initial: Kit; busy?: boolean; onCancel: () => void; onSave: (kit: Kit) => void }) {
  const [kit, setKit] = useState<Kit>(() => structuredClone(initial));
  const [err, setErr] = useState<string | null>(null);
  const kinds = Object.values(defs.buildingKinds);
  const jobs = Object.values(defs.jobs);
  const types = Object.values(defs.businessTypes);

  const set = (patch: Partial<Kit>) => setKit((k) => ({ ...k, ...patch }));

  const save = () => {
    if (!kit.label.trim()) {
      setErr("Label is required.");
      return;
    }
    const check = validateKit(kit, defs);
    if (check.errors.length) {
      setErr(check.errors[0]!);
      return;
    }
    setErr(null);
    onSave(kit);
  };

  return (
    <div className="mt-2 grid gap-2 rounded-sm bg-card-2 p-3">
      <Field label="Label">
        <Input value={kit.label} maxLength={48} onChange={(e) => set({ label: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Slug">
          <Input value={kit.slug} maxLength={48} onChange={(e) => set({ slug: e.target.value })} />
        </Field>
        <Field label="PC age (18+)">
          <Input type="number" min={18} max={110} value={kit.pcAge} onChange={(e) => set({ pcAge: Number(e.target.value) || 18 })} />
        </Field>
      </div>
      <Field label="Unnamed-home pattern">
        <Input value={kit.unnamedHomePattern} maxLength={48} onChange={(e) => set({ unnamedHomePattern: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Default PC job">
          <Select value={kit.defaultPcJobId} onChange={(e) => set({ defaultPcJobId: e.target.value })}>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Player's rooms kind">
          <Select value={kit.pcHomeKindId ?? ""} onChange={(e) => set({ pcHomeKindId: e.target.value || undefined })}>
            <option value="">Fallback (first home kind)</option>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-2">
        <p className="text-xs text-muted">Buildings (kind × count, optional business type)</p>
        {kit.buildings.map((b, i) => (
          <div key={i} className="flex gap-1">
            <Select value={b.kindId} onChange={(e) => set({ buildings: kit.buildings.map((x, k) => (k === i ? { ...x, kindId: e.target.value } : x)) })}>
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
            <Input type="number" min={1} max={40} value={b.count} onChange={(e) => set({ buildings: kit.buildings.map((x, k) => (k === i ? { ...x, count: Math.max(1, Number(e.target.value) || 1) } : x)) })} />
            <Select
              value={b.typeId ?? ""}
              onChange={(e) => {
                const v = e.target.value || undefined;
                set({ buildings: kit.buildings.map((x, k) => (k === i ? { ...x, typeId: v } : x)) });
              }}
            >
              <option value="">No type</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ buildings: kit.buildings.filter((_, k) => k !== i) })}>
              Drop
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => set({ buildings: [...kit.buildings, { kindId: kinds[0]?.id ?? "", count: 1 } as KitBuildingEntry] })}
        >
          Add buildings row
        </Button>
        <p className="text-xs text-muted">{staffPreview(kit, defs)}</p>
      </div>
      <div className="grid gap-2">
        <p className="text-xs text-muted">Home kinds (receive residents)</p>
        <div className="flex flex-wrap gap-1">
          {kinds.map((k) => {
            const on = kit.homes.includes(k.id);
            return (
              <button
                key={k.id}
                type="button"
                className={cn("h-10 rounded-sm px-2 text-xs", on ? "bg-accent text-accent-foreground" : "bg-card text-muted")}
                onClick={() => set({ homes: on ? kit.homes.filter((h) => h !== k.id) : [...kit.homes, k.id] })}
              >
                {k.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="text-xs text-muted">Roster extras (job × count × ages 18+)</p>
        {kit.roster.map((r, i) => (
          <div key={i} className="flex gap-1">
            <Select value={r.jobId} onChange={(e) => set({ roster: kit.roster.map((x, k) => (k === i ? { ...x, jobId: e.target.value } : x)) })}>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </Select>
            <Input type="number" min={1} max={40} value={r.count} onChange={(e) => set({ roster: kit.roster.map((x, k) => (k === i ? { ...x, count: Math.max(1, Number(e.target.value) || 1) } : x)) })} />
            <Input
              type="number"
              min={18}
              max={110}
              value={r.ages?.[0] ?? 18}
              onChange={(e) =>
                set({ roster: kit.roster.map((x, k) => (k === i ? { ...x, ages: [Math.max(18, Number(e.target.value) || 18), x.ages?.[1] ?? 58] as [number, number] } : x)) })
              }
            />
            <Input
              type="number"
              min={18}
              max={110}
              value={r.ages?.[1] ?? 58}
              onChange={(e) =>
                set({ roster: kit.roster.map((x, k) => (k === i ? { ...x, ages: [x.ages?.[0] ?? 18, Math.max(18, Number(e.target.value) || 18)] as [number, number] } : x)) })
              }
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ roster: kit.roster.filter((_, k) => k !== i) })}>
              Drop
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => set({ roster: [...kit.roster, { jobId: jobs[0]?.id ?? "", count: 2, ages: [18, 58] } as KitRosterEntry] })}
        >
          Add roster row
        </Button>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          Save kit
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
