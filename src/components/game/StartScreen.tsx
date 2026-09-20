import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { LlmSettingsPane } from "@/components/game/LlmSettingsPane";
import { LibraryPane } from "@/components/game/LibraryPane";
import type { TownMeta } from "@/sim/persist";
import { allKits, DEFAULT_KIT_ID, kitPopulation } from "@/sim/kits";
import type { Kit } from "@/sim/types";
import { listLibrary } from "@/lib/library-client";

export function StartScreen({
  towns,
  lastId,
  onCreate,
  onLoad,
  onDelete,
  onRename,
  onDuplicate,
  onImport,
  onExport,
  busy = false,
  error = null,
  live = null,
  onJoin,
  townsLoaded = true,
}: {
  towns: TownMeta[];
  lastId: string | null;
  onCreate: (name: string, seed: number, kitId: string, population: number) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onImport: (file: File) => void;
  onExport: (id: string) => void;
  busy?: boolean;
  error?: string | null;
  live?: { id: string; name: string } | null;
  onJoin?: () => void;
  townsLoaded?: boolean;
}) {
  const [seed, setSeed] = useState("1742");
  const [name, setName] = useState("Shadows Veil");
  const [kitId, setKitId] = useState(DEFAULT_KIT_ID);
  const [customKits, setCustomKits] = useState<Kit[]>([]);
  const [people, setPeople] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const last = towns.find((t) => t.id === lastId) ?? null;

  const kits = [...allKits(), ...customKits];
  const kit = kits.find((k) => k.id === kitId || k.slug === kitId) ?? allKits()[0]!;
  const defaultPeople = kitPopulation(kit);
  const peopleValue = people ?? defaultPeople;

  useEffect(() => {
    let live = true;
    listLibrary()
      .then((lib) => {
        if (live) setCustomKits(lib.kits);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const useKit = (k: Kit) => {
    if (!customKits.some((c) => c.id === k.id) && !allKits().some((s) => s.id === k.id)) {
      setCustomKits((cs) => [...cs, k]);
    }
    setKitId(k.id);
    setPeople(null);
    setShowLibrary(false);
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-y-auto bg-background">
      <img
        src="/world/hero.jpg"
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-45"
        crossOrigin="anonymous"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/30" />
      <div className="relative z-10 mx-auto grid w-full max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1fr_1.15fr] md:py-16">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">An autonomous sandbox</p>
          <h1 className="mt-3 font-display text-5xl leading-[0.95] tracking-[-0.03em] md:text-7xl">Simulity</h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted">
            Cities keep. Found a new one from a seed and a kit, or pick up a street that already remembers you.
          </p>
          <form
            className="mt-8 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              onCreate(name, Number(seed) || 1742, kit.id, peopleValue);
            }}
          >
            <label className="grid gap-1 text-xs font-medium text-muted">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder="Shadows Veil" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted">
              Seed
              <Input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                suppressHydrationWarning
              />
            </label>
            <Field label="Kit">
              <Select
                value={kit.id}
                onChange={(e) => {
                  setKitId(e.target.value);
                  setPeople(null);
                }}
              >
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                    {customKits.some((c) => c.id === k.id) ? " · custom" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="grid gap-1 text-xs font-medium text-muted">
              People ({peopleValue} souls + staff)
              <span className="flex items-center gap-2">
                <input
                  type="range"
                  min={6}
                  max={Math.max(60, defaultPeople * 2)}
                  value={Math.min(Math.max(6, peopleValue), Math.max(60, defaultPeople * 2))}
                  onChange={(e) => setPeople(Number(e.target.value))}
                  className="w-full"
                  suppressHydrationWarning
                />
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={peopleValue}
                  onChange={(e) => setPeople(Math.max(1, Number(e.target.value) || defaultPeople))}
                  suppressHydrationWarning
                />
              </span>
            </label>
            {live && onJoin ? (
              <Button type="button" size="lg" disabled={busy} onClick={onJoin}>
                {busy ? "Waking…" : `Join ${live.name}`}
              </Button>
            ) : last ? (
              <Button type="button" size="lg" disabled={busy} onClick={() => onLoad(last.id)}>
                {busy ? "Waking…" : `Continue ${last.name}`}
              </Button>
            ) : null}
            {live && last && live.id !== last.id ? (
              <Button type="button" size="lg" variant="outline" disabled={busy} onClick={() => onLoad(last.id)}>
                {busy ? "Waking…" : `Continue ${last.name}`}
              </Button>
            ) : null}
            <Button type="submit" size="lg" variant={last ? "outline" : "primary"} disabled={busy}>
              {busy ? "Waking…" : "Found a city"}
            </Button>
          </form>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <p className="mt-6 text-xs text-muted">
            WASD to walk · E or tap a door · stairs change floor · Space pauses
          </p>
          <p className="mt-3 flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
              Roleplay settings
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowLibrary(true)}>
              Library
            </Button>
          </p>
        </div>

        <div className="rounded-xl bg-card/90 p-4 shadow-[var(--shadow-border)] md:p-4">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="font-display text-2xl leading-tight">Cities</h2>
            <div className="flex gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                suppressHydrationWarning
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImport(f);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                Import
              </Button>
            </div>
          </div>
          {!townsLoaded ? (
            <p className="mt-4 text-sm text-muted">Looking for cities…</p>
          ) : towns.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No cities yet. Found one to the left — it will wait here.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {towns.map((t) => {
                const clock = `Day ${t.day} · ${String(t.hour).padStart(2, "0")}:00`;
                const when = new Date(t.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                return (
                  <li key={t.id} data-borough-id={t.id} className="rounded-sm bg-card-2 px-3 py-3 transition-[box-shadow] duration-150 hover:shadow-[var(--shadow-border-hover)]">
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" className="min-w-0 text-left" onClick={() => onLoad(t.id)} disabled={busy}>
                        <p className="truncate font-medium">
                          {t.name}
                          {t.id === lastId ? <span className="ml-2 text-xs font-normal text-muted">last</span> : null}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {t.souls} souls · {t.buildings} roofs · seed {t.seed} · {clock}
                        </p>
                        <p className="mt-0.5 text-xs text-subtle">{when}</p>
                      </button>
                      <Button type="button" size="sm" disabled={busy} onClick={() => onLoad(t.id)}>
                        Enter
                      </Button>
                    </div>
                    {editingId === t.id ? (
                      <form
                        className="mt-3 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          onRename(t.id, editName);
                          setEditingId(null);
                        }}
                      >
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={48} />
                        <Button type="submit" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(t.id);
                          setEditName(t.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onDuplicate(t.id)}>
                        Copy
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onExport(t.id)}>
                        Export
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (confirmId === t.id) {
                            onDelete(t.id);
                            setConfirmId(null);
                          } else setConfirmId(t.id);
                        }}
                      >
                        {confirmId === t.id ? "Confirm delete" : "Delete"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={() => setShowSettings(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Roleplay settings"
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-5 shadow-[var(--shadow-border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-xl">Roleplay settings</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowSettings(false)}>
                Close
              </Button>
            </div>
            <LlmSettingsPane />
          </div>
        </div>
      )}
      {showLibrary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={() => setShowLibrary(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Library"
            className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card p-5 shadow-[var(--shadow-border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-xl">Library</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowLibrary(false)}>
                Close
              </Button>
            </div>
            <LibraryPane onUseKit={useKit} />
          </div>
        </div>
      )}
    </div>
  );
}
