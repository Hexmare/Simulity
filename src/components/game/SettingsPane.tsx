import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { TabBar } from "@/components/ui/tabs";
import { LlmSettingsPane } from "@/components/game/LlmSettingsPane";
import type { World } from "@/sim/world";
import type { Send } from "@/components/game/Editors";

/**
 * City settings. Connection profiles and agent bindings live on the server.
 * The setting bible is stored with the city save.
 */
export function SettingsPane({ world, onMutate, send }: { world: World; onMutate: () => void; send?: Send }) {
  const [tab, setTab] = useState<"setting" | "profiles" | "agents">("setting");
  return (
    <div className="grid gap-4">
      <TabBar
        className="-mx-4"
        value={tab}
        onChange={setTab}
        options={[
          { id: "setting", label: "Setting" },
          { id: "profiles", label: "Profiles" },
          { id: "agents", label: "Agents" },
        ]}
      />
      {tab === "setting" && <BibleEditor key={world.townId} world={world} onMutate={onMutate} send={send} />}
      {tab === "profiles" && <LlmSettingsPane onMutate={onMutate} pane="profiles" />}
      {tab === "agents" && <LlmSettingsPane onMutate={onMutate} pane="agents" />}
    </div>
  );
}

function BibleEditor({ world, onMutate, send }: { world: World; onMutate: () => void; send?: Send }) {
  const [text, setText] = useState(world.settingBible);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = text !== world.settingBible;
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Setting bible</p>
      <p className="text-xs text-muted">
        What the city is. Read by roleplay when you talk to someone. Kept with this city, not exported with your keys.
      </p>
      <Textarea
        className="min-h-64"
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
            if (send) send({ type: "setBible", text: text.trim() });
            else world.settingBible = text.trim();
            setMsg("The city's story is rewritten.");
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
            if (send) send({ type: "setBible", text: bible });
            else world.settingBible = bible;
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
