import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ORIENTATION_LABEL, ORIENTATIONS, pickerJobs } from "@/sim/kin";
import { homeKindIds, kindLabel } from "@/sim/custom";
import { ensureEatAffinity } from "@/sim/ai";
import { EatAffinityEditor, eatTaggedKinds } from "@/components/game/PeoplePicker";
import type { Orientation, Sex } from "@/sim/types";
import type { World } from "@/sim/world";
import { cn } from "@/lib/utils";
import type { SessionClient } from "@/lib/session-client";

export function YouPane({ world, client }: { world: World; client: SessionClient }) {
  const p = world.player;
  const homes = world.buildings.filter((b) => homeKindIds(world.defs).includes(b.kind));
  const patch = (next: Record<string, unknown>) => client.send({ type: "patchPc", patch: next });
  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex items-center gap-3 px-4 pt-4">
        {p.portrait ? (
          <img src={p.portrait} alt="" className="portrait size-14 rounded-full object-cover" crossOrigin="anonymous" />
        ) : null}
        <div className="min-w-0">
          <p className="font-display text-lg leading-tight">You</p>
          <p className="text-xs text-muted">Facts the ward can know. Not a shift.</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 grid gap-5">
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={p.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Age">
              <Input type="number" min={18} max={110} value={p.age} onChange={(e) => patch({ age: Number(e.target.value) || p.age })} />
            </Field>
            <Field label="Sex">
              <Select value={p.sex} onChange={(e) => patch({ sex: e.target.value as Sex })}>
                <option value="f">Female</option>
                <option value="m">Male</option>
              </Select>
            </Field>
          </div>
          <Field label="Orientation">
            <Select value={p.orientation} onChange={(e) => patch({ orientation: e.target.value as Orientation })}>
              {ORIENTATIONS.map((o) => (
                <option key={o} value={o}>
                  {ORIENTATION_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ancestry">
            <Select value={p.ancestryId} onChange={(e) => patch({ ancestryId: e.target.value })}>
              {Object.values(world.defs.ancestries).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Place</p>
          <Field label="Job">
            <Select value={p.bb.jobId} onChange={(e) => patch({ jobId: e.target.value })}>
              {pickerJobs(world.defs.jobs).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Home">
            <Select value={p.bb.homeId} onChange={(e) => patch({ homeId: e.target.value })}>
              {homes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {kindLabel(world.defs, b.kind)}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs tabular-nums text-muted">Purse {p.coin} coin</p>
          <EatAffinityEditor
            home={ensureEatAffinity(world, p).home}
            kinds={ensureEatAffinity(world, p).kinds}
            eatKinds={eatTaggedKinds(world)}
            onChange={(next) => patch({ eatAffinity: next })}
          />
        </div>
        <div className="grid gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Story</p>
          <Field label="Known about town">
            <Textarea className="min-h-20" value={p.narrative.public} maxLength={2000} onChange={(e) => patch({ narrative: { public: e.target.value } })} />
          </Field>
          <Field label="Backstage">
            <Textarea className="min-h-20" value={p.narrative.private} maxLength={2000} onChange={(e) => patch({ narrative: { private: e.target.value } })} />
          </Field>
          <Field label="Voice">
            <Input value={p.narrative.voice} maxLength={200} onChange={(e) => patch({ narrative: { voice: e.target.value } })} />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Traits</p>
          <div className="flex flex-wrap gap-1">
            {Object.values(world.defs.traits).map((t) => {
              const on = p.bb.traits.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={cn(
                    "h-9 rounded-sm px-2.5 text-xs transition-colors",
                    on ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted hover:text-foreground",
                  )}
                  onClick={() => {
                    const next = on ? p.bb.traits.filter((x) => x !== t.id) : [...p.bb.traits, t.id].slice(0, 4);
                    patch({ traits: next });
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
