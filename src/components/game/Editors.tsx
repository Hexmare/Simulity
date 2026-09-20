import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PortraitPicker } from "@/components/game/PortraitPicker";
import { homeKindIds, kindLabel } from "@/sim/custom";
import { getKit } from "@/sim/kits";
import { ORIENTATION_LABEL, ORIENTATIONS, pickerJobs } from "@/sim/kin";
import type { Orientation, Sex } from "@/sim/types";
import type { World } from "@/sim/world";
import type { ClientIntent } from "@/lib/protocol";
import { cn } from "@/lib/utils";

export type Send = (intent: ClientIntent) => void;

export function NpcEditor({
  world,
  npcId,
  onMutate,
  send,
}: {
  world: World;
  npcId: string;
  onMutate: () => void;
  send?: Send;
}) {
  const npc = world.npc(npcId);
  const [confirm, setConfirm] = useState(false);
  if (!npc || npc.kind === "pc") return null;
  const homes = world.buildings.filter((b) => homeKindIds(world.defs).includes(b.kind));
  const homeB = world.building(npc.bb.homeId);
  const homeBeds = homeB ? homeB.floors.flatMap((f) => (f.furniture ?? []).filter((i) => i.kind === "bed").map((i) => ({ ...i, floor: f.index }))) : [];
  const patch = (next: Record<string, unknown>) => {
    if (send) send({ type: "patchNpc", id: npc.id, patch: next });
    else world.patchVillager(npc.id, next as Parameters<typeof world.patchVillager>[1]);
    onMutate();
  };
  const call = (method: string, args: unknown[]) => {
    if (send) send({ type: "call", method, args });
    else (world as unknown as Record<string, (...a: unknown[]) => unknown>)[method]?.(...args);
    onMutate();
  };
  return (
    <div className="grid gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Edit</p>
      <label className="grid gap-1 text-xs text-muted">
        Name
        <Input value={npc.name} onChange={(e) => patch({ name: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Age
          <Input type="number" min={18} max={110} value={npc.age} onChange={(e) => patch({ age: Number(e.target.value) || npc.age })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Sex
          <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.sex} onChange={(e) => patch({ sex: e.target.value as Sex })}>
            <option value="f">Female</option>
            <option value="m">Male</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-xs text-muted">
        Orientation
        <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.orientation} onChange={(e) => patch({ orientation: e.target.value as Orientation })}>
          {ORIENTATIONS.map((o) => (
            <option key={o} value={o}>
              {ORIENTATION_LABEL[o]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Ancestry
        <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.ancestryId} onChange={(e) => patch({ ancestryId: e.target.value })}>
          {Object.values(world.defs.ancestries).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Job
        <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.bb.jobId} onChange={(e) => patch({ jobId: e.target.value })}>
          {pickerJobs(world.defs.jobs).map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
      </label>
      {world.jobWorkplaceWarning(npc.id) && <p className="text-xs text-danger">{world.jobWorkplaceWarning(npc.id)}</p>}
      <label className="grid gap-1 text-xs text-muted">
        Home
        <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.bb.homeId} onChange={(e) => patch({ homeId: e.target.value })}>
          {homes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Bed
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={homeBeds.find((bed) => bed.ownerId === npc.id)?.id ?? ""}
          onChange={(e) => {
            if (homeB) call("assignBed", [homeB.id, e.target.value, e.target.value ? npc.id : null]);
            if (!e.target.value && homeB) {
              for (const bed of homeBeds) {
                if (bed.ownerId === npc.id) call("assignBed", [homeB.id, bed.id, null]);
              }
            }
          }}
        >
          <option value="">Unassigned</option>
          {homeBeds.map((bed) => (
            <option key={bed.id} value={bed.id}>
              {homeB?.floors.find((f) => f.index === bed.floor)?.name ?? `Floor ${bed.floor}`} bed {bed.x},{bed.y}
              {bed.ownerId && bed.ownerId !== npc.id ? ` — ${world.npc(bed.ownerId)?.name ?? "claimed"}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Spouse
        <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.spouseId ?? ""} onChange={(e) => call("setSpouse", [npc.id, e.target.value || null])}>
          <option value="">None</option>
          {world.npcs
            .filter((o) => o.id !== npc.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </label>
      <div className="grid gap-2">
        <p className="text-xs text-muted">Parents</p>
        {[0, 1].map((slot) => {
          const current = npc.parentIds[slot] ?? "";
          return (
            <select
              key={slot}
              className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
              value={current}
              onChange={(e) => {
                const next = e.target.value;
                if (current) call("removeParent", [npc.id, current]);
                if (next) call("addParent", [npc.id, next]);
              }}
            >
              <option value="">{slot === 0 ? "Parent (none)" : "Second parent (none)"}</option>
              {current && !world.npc(current) ? <option value={current}>parent (away)</option> : null}
              {world.npcs
                .filter((o) => o.id !== npc.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          );
        })}
      </div>
      <div>
        <p className="mb-2 text-xs text-muted">Traits</p>
        <div className="flex flex-wrap gap-1">
          {Object.values(world.defs.traits).map((t) => {
            const on = npc.bb.traits.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={cn("h-10 rounded-sm px-2 text-xs", on ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
                onClick={() => {
                  const next = on ? npc.bb.traits.filter((x) => x !== t.id) : [...npc.bb.traits, t.id].slice(0, 4);
                  patch({ traits: next });
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs text-muted">Known signs</p>
        <div className="flex flex-wrap gap-1">
          {Object.values(world.defs.spells).map((s) => {
            const known = (npc.bb.spells ?? []).includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                title={`${s.school} · cost ${s.cost} — ${s.effect}`}
                className={cn("h-10 rounded-sm px-2 text-xs", known ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
                onClick={() => call(known ? "revokeSpell" : "grantSpell", [npc.id, s.id])}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="text-xs text-muted">A person, in writing</p>
        <label className="grid gap-1 text-xs text-muted">
          Appearance (presented to others)
          <textarea className="min-h-20 rounded-md bg-card-2 px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.appearance ?? ""} maxLength={2000} onChange={(e) => patch({ appearance: e.target.value })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Secrets (hidden — never shown on another ledger)
          <textarea className="min-h-20 rounded-md bg-card-2 px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.secrets ?? ""} maxLength={2000} onChange={(e) => patch({ secrets: e.target.value })} />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-muted">
          Concealed ancestry
          <button
            type="button"
            role="switch"
            aria-checked={!!npc.concealed}
            onClick={() => patch({ concealed: !npc.concealed })}
            className={cn("h-11 rounded-md px-3 text-sm shadow-[var(--shadow-border)]", npc.concealed ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
          >
            {npc.concealed ? "Hidden" : "Known"}
          </button>
        </label>
        <PortraitPicker value={npc.portrait} onChange={(portrait) => patch({ portrait })} />
        <label className="grid gap-1 text-xs text-muted">
          Known about the city
          <textarea className="min-h-20 rounded-md bg-card-2 px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.narrative.public} maxLength={2000} onChange={(e) => patch({ narrative: { public: e.target.value } })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Backstage (editor + talk only)
          <textarea className="min-h-20 rounded-md bg-card-2 px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)]" value={npc.narrative.private} maxLength={2000} onChange={(e) => patch({ narrative: { private: e.target.value } })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Voice
          <Input value={npc.narrative.voice} maxLength={200} onChange={(e) => patch({ narrative: { voice: e.target.value } })} />
        </label>
      </div>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            return;
          }
          call("removeVillager", [npc.id]);
        }}
      >
        {confirm ? "Confirm remove" : "Remove from city"}
      </Button>
    </div>
  );
}

export function BuildingEditor({
  world,
  buildingId,
  onMutate,
  send,
}: {
  world: World;
  buildingId: string;
  onMutate: () => void;
  send?: Send;
}) {
  const b = world.building(buildingId);
  const [confirm, setConfirm] = useState(false);
  if (!b) return null;
  const call = (method: string, args: unknown[]) => {
    if (send) send({ type: "call", method, args });
    else (world as unknown as Record<string, (...a: unknown[]) => unknown>)[method]?.(...args);
    onMutate();
  };
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-xs text-muted">
        Name
        <Input value={b.name} onChange={(e) => call("renameBuilding", [b.id, e.target.value])} />
      </label>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            return;
          }
          call("removeBuilding", [b.id]);
        }}
      >
        {confirm ? "Confirm demolish" : "Demolish"}
      </Button>
    </div>
  );
}

export function FoundingPane({ world, onMutate, send }: { world: World; onMutate: () => void; send?: Send }) {
  const [soulName, setSoulName] = useState("");
  const [jobId, setJobId] = useState(() => getKit(world.kitId).defaultPcJobId);
  const [kind, setKind] = useState<string>(() => homeKindIds(world.defs)[0] ?? Object.keys(world.defs.buildingKinds)[0]!);
  const [houseName, setHouseName] = useState("");
  const [townName, setTownName] = useState(world.townName);
  const kindIds = Object.keys(world.defs.buildingKinds);
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">City</p>
        <div className="flex gap-2">
          <Input value={townName} onChange={(e) => setTownName(e.target.value)} maxLength={48} />
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (send) send({ type: "renameTown", name: townName.trim() || world.townName });
              else world.townName = townName.trim() || world.townName;
              onMutate();
            }}
          >
            Rename
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">New soul</p>
        <Input placeholder="Name (optional)" value={soulName} onChange={(e) => setSoulName(e.target.value)} />
        <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {pickerJobs(world.defs.jobs).map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          onClick={() => {
            if (send) send({ type: "addVillager", name: soulName || undefined, jobId });
            else world.addVillager({ name: soulName || undefined, jobId });
            setSoulName("");
            onMutate();
          }}
        >
          Add person
        </Button>
      </div>
      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">New house</p>
        <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={kind} onChange={(e) => setKind(e.target.value)}>
          {kindIds.map((k) => (
            <option key={k} value={k}>
              {kindLabel(world.defs, k)}
            </option>
          ))}
        </select>
        <Input placeholder="Name (optional)" value={houseName} onChange={(e) => setHouseName(e.target.value)} />
        <Button
          type="button"
          onClick={() => {
            if (send) send({ type: "addHouse", kind, name: houseName || undefined });
            else world.addHouse(kind, houseName || undefined);
            setHouseName("");
            onMutate();
          }}
        >
          Raise along a road
        </Button>
      </div>
    </div>
  );
}
