import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LlmSettingsPane } from "@/components/game/LlmSettingsPane";
import type { World } from "@/sim/world";

/**
 * Town settings. Roleplay connection settings and town saves live on the server.
 * The setting bible is stored with the town save.
 */
export function SettingsPane({ world, onMutate }: { world: World; onMutate: () => void }) {
  const [tab, setTab] = useState("setting");
  return (
    <div className="grid gap-4">
      <div className="flex gap-1">
        {["setting", "roleplay"].map((t) => (
          <button
            key={t}
            type="button"
            className={
              tab === t
                ? "h-10 flex-1 rounded-sm bg-accent text-xs font-medium text-accent-foreground capitalize"
                : "h-10 flex-1 rounded-sm text-xs font-medium text-muted capitalize hover:bg-card-2 hover:text-foreground"
            }
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "setting" && <BibleEditor key={world.townId} world={world} onMutate={onMutate} />}
      {tab === "roleplay" && <LlmSettingsPane onMutate={onMutate} />}
    </div>
  );
}

function BibleEditor({ world, onMutate }: { world: World; onMutate: () => void }) {
  const [text, setText] = useState(world.settingBible);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = text !== world.settingBible;
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Setting bible</p>
      <p className="text-xs text-muted">
        What the ward is. Read by roleplay when you talk to someone. Kept with this town, not exported with your keys.
      </p>
      <textarea
        className="min-h-64 rounded-md bg-card-2 px-3 py-2 text-sm leading-relaxed text-foreground shadow-[var(--shadow-border)]"
        value={text}
        maxLength={4000}
        onChange={(e) => {
          setText(e.target.value);
          setMsg(null);
        }}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={!text.trim() || !dirty}
          onClick={() => {
            world.settingBible = text.trim();
            setMsg("The ward's story is rewritten.");
            onMutate();
          }}
        >
          Save bible
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const bible = world.defs.setting.bible;
            world.settingBible = bible;
            setText(bible);
            setMsg("Back to the shipped story.");
            onMutate();
          }}
        >
          Reset
        </Button>
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
