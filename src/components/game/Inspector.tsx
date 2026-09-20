import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { BtEditor, TreePicker } from "@/components/game/BtEditor";
import { BuildingEditor, FoundingPane, NpcEditor, type Send } from "@/components/game/Editors";
import { PlanEditor } from "@/components/game/PlanEditor";
import { OverlayCatalog } from "@/components/game/CatalogForms";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/ui/tabs";
import { describeLoc, ensureEatAffinity } from "@/sim/ai";
import { describeWorn } from "@/sim/clothing";
import { homeKindIds, kindLabel } from "@/sim/custom";
import { BOND_LABEL, familyOf, getBond, ORIENTATION_LABEL } from "@/sim/kin";
import type { World } from "@/sim/world";
import { cn } from "@/lib/utils";
import { SettingsPane } from "@/components/game/SettingsPane";
import { PeoplePicker, EatAffinityEditor, eatTaggedKinds } from "@/components/game/PeoplePicker";
import type { SceneView } from "@/lib/protocol";

type Tab = "person" | "tree" | "chronicle" | "city" | "settings";

const NEED_TONE: Record<string, string> = {
  hunger: "bg-need-hunger",
  energy: "bg-need-energy",
  social: "bg-need-social",
  fun: "bg-need-fun",
  hygiene: "bg-need-hygiene",
  comfort: "bg-need-comfort",
  status: "bg-need-status",
  thirst: "bg-need-thirst",
};

export function Inspector({
  world,
  selectedId,
  selectedBuildingId,
  onTalk,
  onEnterBuilding,
  onClose,
  onMutate,
  version,
  send,
  scene,
  onSelect,
}: {
  world: World;
  selectedId: string | null;
  selectedBuildingId: string | null;
  onTalk: (id: string) => void;
  onEnterBuilding: (id: string) => void;
  onClose?: () => void;
  onMutate: () => void;
  version: number;
  send?: Send;
  scene?: SceneView | null;
  onSelect?: (id: string | null, buildingId?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("person");
  const [treeId, setTreeId] = useState(
    () => Object.values(world.defs.trees).find((t) => t.slug === "socialize")?.id ?? Object.keys(world.defs.trees)[0] ?? "",
  );
  void version;
  const npc = selectedId ? world.npc(selectedId) : undefined;
  const tree = world.defs.trees[npc?.bb.treeId ?? treeId] ?? world.defs.trees[treeId]!;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <p className="font-display text-lg leading-tight">Ledger</p>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close ledger"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      <TabBar
        className="mt-1"
        value={tab}
        onChange={setTab}
        options={[
          { id: "person", label: "Person" },
          { id: "tree", label: "Tree" },
          { id: "chronicle", label: "Chronicle" },
          { id: "city", label: "City" },
          { id: "settings", label: "Settings" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3">
          <PeoplePicker
            items={world.npcs.map((n) => ({
              id: n.id,
              name: n.name,
              hint: `${world.defs.jobs[n.bb.jobId]?.label ?? ""} · ${describeLoc(world, n)}`.slice(0, 60),
            }))}
            placeholder="Find a soul…"
            onPick={(id) => {
              if (onSelect) onSelect(id);
              else onTalk(id);
              setTab("person");
            }}
          />
        </div>
        {tab === "person" && (
          <PersonPane
            world={world}
            npcId={selectedId}
            buildingId={selectedBuildingId}
            onTalk={onTalk}
            onEnterBuilding={onEnterBuilding}
            onMutate={onMutate}
            send={send}
            scene={scene}
          />
        )}
        {tab === "tree" && (
          <div className="flex min-h-0 flex-col gap-3">
            <TreePicker
              options={Object.values(world.defs.trees).map((t) => ({ id: t.id, label: t.name }))}
              value={npc?.bb.treeId ?? treeId}
              onChange={(id) => {
                setTreeId(id);
                if (npc) {
                  if (send) send({ type: "patchNpc", id: npc.id, patch: { treeId: id } });
                  else npc.bb.treeId = id;
                }
                onMutate();
              }}
            />
            <p className="text-xs text-muted">Edits write into the live tree the sim is ticking. Running node is outlined in sage.</p>
            {tree && (
              <BtEditor
                tree={tree}
                runningId={npc?.bb.runningNodeId ?? null}
                defs={world.defs}
                onChange={(next) => {
                  if (send) send({ type: "replaceTree", tree: next });
                  else world.defs.trees[next.id] = next;
                  onMutate();
                }}
              />
            )}
          </div>
        )}
        {tab === "chronicle" && <ChroniclePane world={world} />}
        {tab === "city" && <CityPane world={world} onEnterBuilding={onEnterBuilding} onMutate={onMutate} send={send} />}
        {tab === "settings" && <SettingsPane world={world} onMutate={onMutate} send={send} />}
      </div>
    </aside>
  );
}

function PersonPane({
  world,
  npcId,
  buildingId,
  onTalk,
  onEnterBuilding,
  onMutate,
  send,
  scene,
}: {
  world: World;
  npcId: string | null;
  buildingId: string | null;
  onTalk: (id: string) => void;
  onEnterBuilding: (id: string) => void;
  onMutate: () => void;
  send?: Send;
  scene?: SceneView | null;
}) {
  const npc = npcId ? world.npc(npcId) : undefined;
  if (!npc || npc.kind === "pc") {
    const b = buildingId ? world.building(buildingId) : undefined;
    if (b) {
      return <BuildingPane world={world} buildingId={b.id} onEnterBuilding={onEnterBuilding} onMutate={onMutate} send={send} />;
    }
    return <p className="text-sm text-muted">Select a city soul, or click a building.</p>;
  }
  const job = world.defs.jobs[npc.bb.jobId];
  const goal = npc.bb.goalId ? world.defs.goals.find((g) => g.id === npc.bb.goalId) : undefined;
  const ancestry = world.defs.ancestries[npc.ancestryId];
  const family = familyOf(world, npc);
  const donorOf = world.donors.filter((d) => d.drinker === npc.id).map((d) => world.npc(d.donor)?.name ?? d.donor);
  const donorTo = world.donors.filter((d) => d.donor === npc.id).map((d) => world.npc(d.drinker)?.name ?? d.drinker);
  const rels = Object.entries(npc.relationships)
    .map(([id, r]) => ({ id, r, name: world.npc(id)?.name ?? id, bond: getBond(world, npc.id, id)?.status }))
    .sort((a, b) => Math.abs(b.r.friendship) + b.r.grudge - (Math.abs(a.r.friendship) + a.r.grudge))
    .slice(0, 6);
  const here = world.isHere(npc.id);
  const inScene = !!scene?.ids.includes(npc.id);
  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        {npc.portrait ? (
          <img src={npc.portrait} alt="" className="portrait size-16 rounded-full object-cover" crossOrigin="anonymous" />
        ) : null}
        <div>
          <h2 className="font-display text-2xl leading-tight">{npc.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {job?.label} · {npc.age} · {ORIENTATION_LABEL[npc.orientation] ?? npc.orientation} · {ancestry?.label ?? npc.ancestryId}
          </p>
          <p className="mt-1 text-sm text-muted">
            {npc.coin} credits · {npc.bb.food} meals carried
          </p>
          <p className="mt-1 text-sm text-muted">{describeLoc(world, npc)}</p>
          {npc.appearance && <p className="mt-1 text-sm">{npc.appearance}</p>}
          <p className="mt-1 text-sm text-muted">{describeWorn(world.defs, world.clothing, npc)}</p>
          <p className="mt-1 text-sm text-muted">{npc.bb.traits.map((t) => world.defs.traits[t]?.label ?? t).join(" · ")}</p>
        </div>
      </div>
      <div className="grid gap-2">
        {world.defs.needs.map((n) => (
          <NeedBar key={n.id} label={n.label} value={npc.bb.needs[n.id] ?? 0} critical={n.criticalBelow} tone={NEED_TONE[n.slug]} />
        ))}
        <NeedBar label="Mood" value={npc.bb.mood / 2 + 50} critical={25} tone="bg-ok" />
        <NeedBar label="Essence" value={npc.bb.essence ?? 0} critical={15} tone="bg-warn" />
      </div>
      {(npc.bb.spells ?? []).length > 0 && (
        <p className="text-sm text-muted">Signs: {(npc.bb.spells ?? []).map((s) => world.defs.spells[s]?.label ?? s).join(" · ")}</p>
      )}
      {npc.narrative.public && <p className="text-sm leading-snug">{npc.narrative.public}</p>}
      {(donorOf.length > 0 || donorTo.length > 0) && (
        <p className="text-sm text-muted">
          {donorOf.length > 0 ? `Drinks from ${donorOf.join(", ")}` : ""}
          {donorOf.length > 0 && donorTo.length > 0 ? " · " : ""}
          {donorTo.length > 0 ? `Lets ${donorTo.join(", ")} drink` : ""}
        </p>
      )}
      <p className="text-sm">
        Goal <span className="text-muted">{goal?.label ?? (npc.bb.goalId ? "unknown" : "—")}</span>
        {npc.bb.control === "llm" ? " · speaking with you" : ""}
      </p>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Family</p>
        <ul className="grid gap-1 text-sm">
          {family.parents.length > 0 && (
            <li className="flex justify-between gap-2">
              <span className="text-muted">{npc.sex === "f" ? "Daughter of" : "Son of"}</span>
              <span className="text-right">{family.parents.map((p) => p.name).join(", ")}</span>
            </li>
          )}
          {family.siblings.length > 0 && (
            <li className="flex justify-between gap-2">
              <span className="text-muted">Siblings</span>
              <span className="text-right">{family.siblings.map((p) => p.name).join(", ")}</span>
            </li>
          )}
          {family.partner && (
            <li className="flex justify-between gap-2">
              <span className="text-muted">{BOND_LABEL[family.partner.status]}</span>
              <span>{family.partner.name}</span>
            </li>
          )}
          {family.household.length > 0 && (
            <li className="flex justify-between gap-2">
              <span className="text-muted">Household</span>
              <span className="text-right">{family.household.map((p) => p.name).join(", ")}</span>
            </li>
          )}
          {!family.parents.length && !family.siblings.length && !family.partner && !family.household.length && (
            <li className="text-muted">No kin recorded.</li>
          )}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Ties</p>
        <ul className="grid gap-1 text-sm">
          {rels.map(({ id, r, name, bond }) => (
            <li key={id} className="flex justify-between gap-2">
              <span>
                {name}
                {bond && bond !== "none" ? ` — ${BOND_LABEL[bond]}` : ""}
              </span>
              <span className="tabular-nums text-muted">
                F {Math.round(r.friendship)} · R {Math.round(r.romance)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Button onClick={() => onTalk(npc.id)} disabled={!here || inScene} title={!here ? "They are not here — use Call in Conversation" : undefined}>
        Speak
      </Button>
      {!here && <p className="text-xs text-muted">Not here. Open Conversation and Call them.</p>}
      <EatAffinityEditor
        home={ensureEatAffinity(world, npc).home}
        kinds={ensureEatAffinity(world, npc).kinds}
        eatKinds={eatTaggedKinds(world)}
        onChange={(next) => {
          if (send) send({ type: "patchNpc", id: npc.id, patch: { eatAffinity: next } });
          else world.patchVillager(npc.id, { eatAffinity: next });
          onMutate();
        }}
      />
      <p className="text-xs text-muted">{(npc.bb.memory ?? []).length} memories kept · pose {npc.bb.pose ?? "stand"}{npc.bb.usingId ? " · seated" : ""}</p>
      <NpcEditor world={world} npcId={npc.id} onMutate={onMutate} send={send} />
    </div>
  );
}

function BuildingPane({
  world,
  buildingId,
  onEnterBuilding,
  onMutate,
  send,
}: {
  world: World;
  buildingId: string;
  onEnterBuilding: (id: string) => void;
  onMutate: () => void;
  send?: Send;
}) {
  const b = world.building(buildingId);
  const [plan, setPlan] = useState(false);
  if (!b) return null;
  const inside = world.occupants(b.id);
  const here = world.player.loc.layer === "interior" && world.player.loc.buildingId === b.id;
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{kindLabel(world.defs, b.kind)}</p>
        <h2 className="font-display text-2xl leading-tight">{b.name}</h2>
        <p className="mt-1 text-sm text-muted">
          {inside.length ? `${inside.length} inside` : "Empty just now"}
          {b.floors.length > 1 ? ` · ${b.floors.length} floors` : ""}
        </p>
        <p className="mt-1 text-sm text-muted">
          Till {Math.floor(b.coffer ?? 0)} credits
          {Object.entries(b.stock ?? [])
            .filter(([, n]) => n > 0)
            .map(([g, n]) => ` · ${n} ${world.defs.commodities[g]?.label ?? g}`)
            .join("")}
        </p>
      </div>
      <ul className="grid gap-1 text-sm">
        {b.floors.flatMap((f) =>
          f.rooms.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span>
                {r.name}
                {r.ownerId ? ` — ${world.npc(r.ownerId)?.name ?? "claimed"}` : ""}
              </span>
              <span className="text-muted">{f.name}</span>
            </li>
          )),
        )}
      </ul>
      {inside.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {inside.slice(0, 10).map((n) => (
            <li key={n.id} className="flex justify-between gap-2">
              <span>{n.name}</span>
              <span className="text-muted">{world.defs.jobs[n.bb.jobId]?.label}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            if (here) {
              if (send) send({ type: "interact" });
              else world.exitBuilding();
            } else onEnterBuilding(b.id);
          }}
        >
          {here ? "Leave" : world.nearEntrance(b, 1.45) ? "Enter" : "Walk to door"}
        </Button>
        <Button variant={plan ? "primary" : "ghost"} onClick={() => setPlan((p) => !p)}>
          {plan ? "Done" : "Plan"}
        </Button>
      </div>
      {plan && <PlanEditor world={world} buildingId={b.id} onMutate={onMutate} send={send} />}
      <BuildingEditor world={world} buildingId={b.id} onMutate={onMutate} send={send} />
    </div>
  );
}

function NeedBar({ label, value, critical, tone }: { label: string; value: number; critical: number; tone?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const urgent = v < critical;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className={cn("tabular-nums", urgent ? "text-danger" : "text-muted")}>{Math.round(v)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-card-2">
        <div className={cn("h-full rounded-full", urgent ? "bg-danger" : tone ?? "bg-ok")} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function ChroniclePane({ world }: { world: World }) {
  const events = world.events.slice().reverse().slice(0, 60);
  return (
    <ol className="grid gap-3">
      {events.map((e) => {
        const actor = world.npc(e.actorId);
        return (
          <li key={e.id} className="border-b border-border pb-3 last:border-0">
            <p className="text-sm leading-snug">{e.summary}</p>
            <p className="mt-1 text-xs text-muted">
              {actor?.name ?? e.actorId} · {e.source} · t{e.tick}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function CityPane({
  world,
  onEnterBuilding,
  onMutate,
  send,
}: {
  world: World;
  onEnterBuilding: (id: string) => void;
  onMutate: () => void;
  send?: Send;
}) {
  const t = world.time();
  const jobs = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of world.npcs) m[n.bb.jobId] = (m[n.bb.jobId] ?? 0) + 1;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.npcs, world.tickIndex]);
  const kinds = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of world.npcs) m[n.ancestryId] = (m[n.ancestryId] ?? 0) + 1;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.npcs, world.tickIndex]);
  const places = world.buildings.filter((b) => !new Set(homeKindIds(world.defs)).has(b.kind));
  return (
    <div className="grid gap-4 text-sm">
      <p>
        Day {t.day} · {String(t.hour).padStart(2, "0")}:{String(t.minute).padStart(2, "0")} · {t.period}
      </p>
      <p className="text-muted">
        {world.npcs.length} people fully simulated · {world.buildings.length} buildings · {Object.keys(world.defs.social).length} social actions · {Object.keys(world.defs.trees).length} trees
      </p>
      <p className="text-muted">
        City purse {Math.floor(world.townPurse)} credits · your purse {world.player.coin} credits
      </p>
      <p className="text-muted">
        {world.townName} — {world.defs.setting.line}
      </p>
      <ul className="grid gap-1">
        {Object.entries(kinds).map(([id, n]) => (
          <li key={id} className="flex justify-between">
            <span>{world.defs.ancestries[id]?.plural ?? id}</span>
            <span className="tabular-nums text-muted">{n}</span>
          </li>
        ))}
      </ul>
      <FoundingPane world={world} onMutate={onMutate} send={send} />
      <OverlayCatalog world={world} send={send} onMutate={onMutate} />
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Places</p>
        <ul className="grid gap-1">
          {places.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{b.name}</span>
              <button type="button" className="h-10 shrink-0 rounded-sm px-2 text-xs text-muted hover:bg-card-2 hover:text-foreground" onClick={() => onEnterBuilding(b.id)}>
                Go
              </button>
            </li>
          ))}
        </ul>
      </div>
      <ul className="grid gap-1">
        {Object.entries(jobs).map(([id, n]) => (
          <li key={id} className="flex justify-between">
            <span>{world.defs.jobs[id]?.label ?? id}</span>
            <span className="tabular-nums text-muted">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
