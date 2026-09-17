import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KNOWN_TAGS, kindLabel, slugId } from "@/sim/custom";
import { SHIPPED_KIND_IDS, SYS } from "@/sim/defs";
import type { World } from "@/sim/world";
import { cn } from "@/lib/utils";

/** New rows are catalog entries: pinned v4 UUID ids (slugs are derived by the world). */
const newId = () => globalThis.crypto.randomUUID();

export function KindsJobs({ world, onMutate }: { world: World; onMutate: () => void }) {
  return (
    <div className="grid gap-5">
      <KindSection world={world} onMutate={onMutate} />
      <JobSection world={world} onMutate={onMutate} />
    </div>
  );
}

function KindSection({ world, onMutate }: { world: World; onMutate: () => void }) {
  const [label, setLabel] = useState("");
  const [w, setW] = useState(5);
  const [h, setH] = useState(4);
  const [stories, setStories] = useState<1 | 2>(1);
  const [ground, setGround] = useState("shop: Shop");
  const [upper, setUpper] = useState("hall: Upstairs");
  const [names, setNames] = useState("");
  const [tags, setTags] = useState<string[]>(["work", "shop"]);
  const [msg, setMsg] = useState<string | null>(null);
  const kinds = Object.values(world.defs.buildingKinds);

  const parseRooms = (raw: string) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf(":");
        return i < 0 ? { kind: s, name: s } : { kind: s.slice(0, i).trim(), name: s.slice(i + 1).trim() || s.slice(0, i).trim() };
      });

  const submit = () => {
    const id = newId();
    const err = world.addBuildingKind({
      id,
      slug: slugId(label),
      label,
      names: names.split(",").map((s) => s.trim()).filter(Boolean),
      footprint: { w, h },
      stories,
      ground: parseRooms(ground),
      upper: stories === 2 ? parseRooms(upper) : undefined,
      tags,
    });
    if (err) {
      setMsg(err);
      return;
    }
    setLabel("");
    setNames("");
    setMsg(`“${label.trim()}” is known — raise one below.`);
    onMutate();
  };

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Building kinds</p>
      <ul className="grid gap-1 text-sm">
        {kinds.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {k.label}{" "}
              <span className="text-muted">
                {k.footprint.w}×{k.footprint.h} · {k.stories === 2 ? "2 floors" : "1 floor"}
                {SHIPPED_KIND_IDS.includes(k.id) ? "" : " · custom"}
              </span>
            </span>
            <button
              type="button"
              className="h-10 shrink-0 rounded-sm px-2 text-xs text-danger hover:bg-card-2"
              onClick={() => {
                const err = world.removeBuildingKind(k.id);
                setMsg(err);
                onMutate();
              }}
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
      <Input placeholder="New kind label, e.g. Apothecary" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={32} />
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Wide
          <Input type="number" min={3} max={14} value={w} onChange={(e) => setW(Number(e.target.value) || 5)} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Deep
          <Input type="number" min={3} max={12} value={h} onChange={(e) => setH(Number(e.target.value) || 4)} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Floors
          <select
            className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
            value={stories}
            onChange={(e) => setStories(Number(e.target.value) === 2 ? 2 : 1)}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-xs text-muted">
        Ground rooms (kind: Name, comma-separated)
        <Input value={ground} onChange={(e) => setGround(e.target.value)} maxLength={160} />
      </label>
      {stories === 2 && (
        <label className="grid gap-1 text-xs text-muted">
          Upper rooms
          <Input value={upper} onChange={(e) => setUpper(e.target.value)} maxLength={160} />
        </label>
      )}
      <label className="grid gap-1 text-xs text-muted">
        Default names (comma-separated, optional)
        <Input value={names} onChange={(e) => setNames(e.target.value)} maxLength={160} />
      </label>
      <div className="flex flex-wrap gap-1">
        {KNOWN_TAGS.map((t) => {
          const on = tags.includes(t);
          return (
            <button
              key={t}
              type="button"
              className={cn("h-10 rounded-sm px-2 text-xs", on ? "bg-accent text-accent-foreground" : "bg-card-2 text-muted")}
              onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
            >
              {t}
            </button>
          );
        })}
      </div>
      <Button type="button" onClick={submit} disabled={!label.trim()}>
        Add kind
      </Button>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}

function JobSection({ world, onMutate }: { world: World; onMutate: () => void }) {
  const [label, setLabel] = useState("");
  const [workplace, setWorkplace] = useState<string>(SYS.home);
  const [start, setStart] = useState(8);
  const [end, setEnd] = useState(17);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const jobs = Object.values(world.defs.jobs);
  const kindIds = Object.keys(world.defs.buildingKinds);

  const submit = () => {
    const id = newId();
    const err = world.addJob({ id, slug: slugId(label), label, workplace, startHour: start, endHour: end, palette: jobs.length % 12 });
    if (err) {
      setMsg(err);
      return;
    }
    setLabel("");
    setMsg(`“${label.trim()}” is a trade now — hire someone into it.`);
    onMutate();
  };

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Jobs</p>
      <ul className="grid gap-1 text-sm">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center justify-between gap-2">
            <span className="truncate">
              {j.label}{" "}
              <span className="text-muted">
                {kindLabel(world.defs, j.workplace)} · {j.startHour}–{j.endHour}
              </span>
            </span>
            <button
              type="button"
              className="h-10 shrink-0 rounded-sm px-2 text-xs text-danger hover:bg-card-2"
              onClick={() => {
                if (confirm !== j.id) {
                  setConfirm(j.id);
                  setMsg("Tap again — their souls will take the odd jobs.");
                  return;
                }
                setConfirm(null);
                const err = world.removeJob(j.id);
                setMsg(err);
                onMutate();
              }}
            >
              {confirm === j.id ? "Confirm" : "End"}
            </button>
          </li>
        ))}
      </ul>
      <Input placeholder="New trade label, e.g. Apothecary" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={32} />
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Workplace
          <select
            className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
            value={workplace}
            onChange={(e) => setWorkplace(e.target.value)}
          >
            {Object.values(SYS).map((t) => (
              <option key={t} value={t}>
                {kindLabel(world.defs, t)}
              </option>
            ))}
            {kindIds.map((k) => (
              <option key={k} value={k}>
                {kindLabel(world.defs, k)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Start
          <Input type="number" min={0} max={24} value={start} onChange={(e) => setStart(Number(e.target.value) || 0)} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          End
          <Input type="number" min={0} max={24} value={end} onChange={(e) => setEnd(Number(e.target.value) || 0)} />
        </label>
      </div>
      <Button type="button" onClick={submit} disabled={!label.trim()}>
        Add trade
      </Button>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
