import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/ui/tabs";
import { buildDefs } from "@/sim/defs";
import { allKits } from "@/sim/kits";
import { applyLibraryDefs, blankOverlay } from "@/sim/custom";
import type { Kit } from "@/sim/types";
import { listLibrary, removeCatalogRow, removeKit, saveCatalogRows, saveKit, type LibraryCatalog } from "@/lib/library-client";
import { LibraryCatalog as LibraryCatalogEditor, type CollectionKey } from "@/components/game/CatalogForms";
import { KitBuilder } from "@/components/game/KitBuilder";

type LibraryTab = "kits" | "catalog";

/** Start-screen Library: kit builder + full catalog editors over server JSON. */
export function LibraryPane({ onUseKit }: { onUseKit: (kit: Kit) => void }) {
  const [tab, setTab] = useState<LibraryTab>("kits");
  const [kits, setKits] = useState<Kit[]>([]);
  const [catalog, setCatalog] = useState<LibraryCatalog>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const lib = await listLibrary();
      setKits(lib.kits);
      setCatalog(lib.catalog);
    } catch {
      setError("The Library is unreachable — custom kits and catalog rows are unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const defs = useMemo(() => {
    const d = buildDefs();
    try {
      applyLibraryDefs(d, blankOverlay(), catalog as Record<string, unknown[]>);
    } catch {
      /* ignore */
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const shipped = useMemo(() => allKits(), []);

  const handleSaveKit = async (kit: Kit): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveKit(kit);
      setKits(r.kits);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save that kit.";
      setError(msg);
      return msg;
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRows = async (collection: CollectionKey, rows: unknown[]): Promise<string | null> => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveCatalogRows(collection, rows as never);
      setCatalog(r.catalog);
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save those rows.";
      setError(msg);
      return msg;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-xl">Library</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()}>
          Reload
        </Button>
      </div>
      <TabBar value={tab} onChange={setTab} options={[{ id: "kits", label: "Kits" }, { id: "catalog", label: "Catalog" }]} />
      {error && <p className="text-xs text-danger">{error}</p>}
      {tab === "kits" && (
        <KitBuilder
          shipped={shipped}
          custom={kits}
          defs={defs}
          busy={busy}
          onSave={handleSaveKit}
          onDelete={(id) => removeKit(id).then((r) => setKits(r.kits))}
          onUse={onUseKit}
        />
      )}
      {tab === "catalog" && (
        <LibraryCatalogEditor
          defs={defs}
          catalog={catalog as Record<string, { id: string }[]>}
          busy={busy}
          onSaveRows={handleSaveRows}
          onDeleteRow={(collection: CollectionKey, id: string) => removeCatalogRow(collection, id).then((r) => setCatalog(r.catalog))}
        />
      )}
    </div>
  );
}
