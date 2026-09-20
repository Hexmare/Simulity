import { useMemo, useRef, useState } from "react";

export interface PickerItem {
  id: string;
  name: string;
  hint?: string;
}

export function PeoplePicker({ items, onPick, placeholder = "Type a name…" }: { items: PickerItem[]; onPick: (id: string) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? items.filter((i) => i.name.toLowerCase().includes(needle)) : items;
    return list.slice(0, 30);
  }, [items, q]);
  const pick = (id: string) => {
    onPick(id);
    setQ("");
    setHi(0);
  };
  return (
    <div className="grid gap-1">
      <input
        ref={inputRef}
        className="h-10 rounded-md bg-background px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const it = filtered[hi] ?? filtered[0];
            if (it) pick(it.id);
          }
          e.stopPropagation();
        }}
        onKeyUp={(e) => e.stopPropagation()}
      />
      <div className="max-h-48 overflow-y-auto rounded-md bg-background">
        {filtered.length === 0 && <p className="px-3 py-2 text-xs text-muted">No matches.</p>}
        {filtered.map((it, i) => (
          <button
            key={it.id}
            type="button"
            className={`flex h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm ${i === hi ? "bg-card-2" : "hover:bg-card-2"}`}
            onMouseEnter={() => setHi(i)}
            onClick={() => pick(it.id)}
          >
            <span className="truncate">{it.name}</span>
            {it.hint ? <span className="shrink-0 text-xs text-muted">{it.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EatAffinityEditor({
  home,
  kinds,
  eatKinds,
  onChange,
}: {
  home: number;
  kinds: Record<string, number>;
  eatKinds: { id: string; label: string }[];
  onChange: (next: { home: number; kinds: Record<string, number> }) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Food affinity</p>
      <label className="grid gap-1 text-xs text-muted">
        Home-cook {Math.round(home * 100)}%
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(home * 100)}
          onChange={(e) => onChange({ home: Number(e.target.value) / 100, kinds })}
        />
      </label>
      {eatKinds.map((k) => {
        const v = kinds[k.id] ?? 0.3;
        return (
          <label key={k.id} className="grid gap-1 text-xs text-muted">
            {k.label} {Math.round(v * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(v * 100)}
              onChange={(e) => onChange({ home, kinds: { ...kinds, [k.id]: Number(e.target.value) / 100 } })}
            />
          </label>
        );
      })}
    </div>
  );
}

export function eatTaggedKinds(world: { defs: { buildingKinds: Record<string, { id: string; label: string; tags: string[] }> } }): { id: string; label: string }[] {
  return Object.values(world.defs.buildingKinds)
    .filter((k) => k.tags.includes("eat"))
    .map((k) => ({ id: k.id, label: k.label }));
}
