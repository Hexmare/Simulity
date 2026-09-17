import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { homeKindIds, kindLabel } from "@/sim/custom";
import { ORIENTATION_LABEL, ORIENTATIONS, pickerJobs } from "@/sim/kin";
import type { Orientation, Sex } from "@/sim/types";
import type { World } from "@/sim/world";
import { cn } from "@/lib/utils";

export function NpcEditor({
  world,
  npcId,
  onMutate,
}: {
  world: World;
  npcId: string;
  onMutate: () => void;
}) {
  const npc = world.npc(npcId);
  const [confirm, setConfirm] = useState(false);
  if (!npc || npc.kind === "pc") return null;
  const homes = world.buildings.filter((b) => homeKindIds(world.defs).includes(b.kind));
  const homeB = world.building(npc.bb.homeId);
  const homeBeds = homeB ? homeB.floors.flatMap((f) => (f.furniture ?? []).filter((i) => i.kind === "bed").map((i) => ({ ...i, floor: f.index }))) : [];
  return (
    <div className="grid gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Edit</p>
      <label className="grid gap-1 text-xs text-muted">
        Name
        <Input
          value={npc.name}
          onChange={(e) => {
            world.patchVillager(npc.id, { name: e.target.value });
            onMutate();
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Age
          <Input
            type="number"
            min={18}
            max={110}
            value={npc.age}
            onChange={(e) => {
              world.patchVillager(npc.id, { age: Number(e.target.value) || npc.age });
              onMutate();
            }}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Sex
          <select
            className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
            value={npc.sex}
            onChange={(e) => {
              world.patchVillager(npc.id, { sex: e.target.value as Sex });
              onMutate();
            }}
          >
            <option value="f">Female</option>
            <option value="m">Male</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-xs text-muted">
        Orientation
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={npc.orientation}
          onChange={(e) => {
            world.patchVillager(npc.id, { orientation: e.target.value as Orientation });
            onMutate();
          }}
        >
          {ORIENTATIONS.map((o) => (
            <option key={o} value={o}>
              {ORIENTATION_LABEL[o]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Ancestry
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={npc.ancestryId}
          onChange={(e) => {
            world.patchVillager(npc.id, { ancestryId: e.target.value });
            onMutate();
          }}
        >
          {Object.values(world.defs.ancestries).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Job
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={npc.bb.jobId}
          onChange={(e) => {
            world.patchVillager(npc.id, { jobId: e.target.value });
            onMutate();
          }}
        >
          {pickerJobs(world.defs.jobs).map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
      </label>
      {world.jobWorkplaceWarning(npc.id) && (
        <p className="text-xs text-danger">{world.jobWorkplaceWarning(npc.id)}</p>
      )}
      <label className="grid gap-1 text-xs text-muted">
        Home
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={npc.bb.homeId}
          onChange={(e) => {
            world.patchVillager(npc.id, { homeId: e.target.value });
            onMutate();
          }}
        >
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
            if (homeB) world.assignBed(homeB.id, e.target.value, e.target.value ? npc.id : null);
            if (!e.target.value && homeB) {
              for (const bed of homeBeds) {
                if (bed.ownerId === npc.id) world.assignBed(homeB.id, bed.id, null);
              }
            }
            onMutate();
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
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={npc.spouseId ?? ""}
          onChange={(e) => {
            world.setSpouse(npc.id, e.target.value || null);
            onMutate();
          }}
        >
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
                if (current) world.removeParent(npc.id, current);
                if (next) world.addParent(npc.id, next);
                onMutate();
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
                className={cn(
                  "h-10 rounded-sm px-2 text-xs",
                  on ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted",
                )}
                onClick={() => {
                  const next = on ? npc.bb.traits.filter((x) => x !== t.id) : [...npc.bb.traits, t.id].slice(0, 4);
                  world.patchVillager(npc.id, { traits: next });
                  onMutate();
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
                className={cn(
                  "h-10 rounded-sm px-2 text-xs",
                  known ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted",
                )}
                onClick={() => {
                  if (known) world.revokeSpell(npc.id, s.id);
                  else world.grantSpell(npc.id, s.id);
                  onMutate();
                }}
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
          Known about town
          <textarea
            className="min-h-20 rounded-md bg-card-2 px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)]"
            value={npc.narrative.public}
            maxLength={2000}
            onChange={(e) => {
              world.patchVillager(npc.id, { narrative: { public: e.target.value } });
              onMutate();
            }}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Backstage (editor + talk only)
          <textarea
            className="min-h-20 rounded-md bg-card-2 px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)]"
            value={npc.narrative.private}
            maxLength={2000}
            onChange={(e) => {
              world.patchVillager(npc.id, { narrative: { private: e.target.value } });
              onMutate();
            }}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Voice
          <Input
            value={npc.narrative.voice}
            maxLength={200}
            onChange={(e) => {
              world.patchVillager(npc.id, { narrative: { voice: e.target.value } });
              onMutate();
            }}
          />
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
          world.removeVillager(npc.id);
          onMutate();
        }}
      >
        {confirm ? "Confirm remove" : "Remove from town"}
      </Button>
    </div>
  );
}

export function BuildingEditor({
  world,
  buildingId,
  onMutate,
}: {
  world: World;
  buildingId: string;
  onMutate: () => void;
}) {
  const b = world.building(buildingId);
  const [confirm, setConfirm] = useState(false);
  if (!b) return null;
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-xs text-muted">
        Name
        <Input
          value={b.name}
          onChange={(e) => {
            world.renameBuilding(b.id, e.target.value);
            onMutate();
          }}
        />
      </label>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            return;
          }
          world.removeBuilding(b.id);
          onMutate();
        }}
      >
        {confirm ? "Confirm demolish" : "Demolish"}
      </Button>
    </div>
  );
}

export function FoundingPane({ world, onMutate }: { world: World; onMutate: () => void }) {
  const [soulName, setSoulName] = useState("");
  const [jobId, setJobId] = useState("laborer");
  const [kind, setKind] = useState<string>("cottage");
  const [houseName, setHouseName] = useState("");
  const [townName, setTownName] = useState(world.townName);
  const kindIds = Object.keys(world.defs.buildingKinds);
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Town</p>
        <div className="flex gap-2">
          <Input value={townName} onChange={(e) => setTownName(e.target.value)} maxLength={48} />
          <Button
            type="button"
            size="sm"
            onClick={() => {
              world.townName = townName.trim() || world.townName;
              onMutate();
            }}
          >
            Rename
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">You</p>
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={world.player.orientation}
          onChange={(e) => {
            world.patchVillager("pc", { orientation: e.target.value as Orientation });
            onMutate();
          }}
        >
          {ORIENTATIONS.map((o) => (
            <option key={o} value={o}>
              {ORIENTATION_LABEL[o]}
            </option>
          ))}
        </select>
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={world.player.ancestryId}
          onChange={(e) => {
            world.patchVillager("pc", { ancestryId: e.target.value });
            onMutate();
          }}
        >
          {Object.values(world.defs.ancestries).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <label className="grid gap-1 text-xs text-muted">
          Known about town
          <textarea
            className="min-h-20 rounded-md bg-card-2 px-3 py-2 text-sm text-foreground shadow-[var(--shadow-border)]"
            value={world.player.narrative.public}
            maxLength={2000}
            onChange={(e) => {
              world.patchVillager("pc", { narrative: { public: e.target.value } });
              onMutate();
            }}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Voice
          <Input
            value={world.player.narrative.voice}
            maxLength={200}
            onChange={(e) => {
              world.patchVillager("pc", { narrative: { voice: e.target.value } });
              onMutate();
            }}
          />
        </label>
      </div>
      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">New soul</p>
        <Input placeholder="Name (optional)" value={soulName} onChange={(e) => setSoulName(e.target.value)} />
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
        >
          {pickerJobs(world.defs.jobs).map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          onClick={() => {
            world.addVillager({ name: soulName || undefined, jobId });
            setSoulName("");
            onMutate();
          }}
        >
          Add person
        </Button>
      </div>
      <div className="grid gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">New house</p>
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
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
            world.addHouse(kind, houseName || undefined);
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
