import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { roleplayTurn, type ChatTurn } from "@/lib/roleplay";
import { buildMessages, usageLine } from "@/lib/llm/packer";
import { peekSettings } from "@/lib/llm/settings";
import { applyDeltas, snapshotNpc } from "@/sim/ai";
import type { World } from "@/sim/world";

export function Roleplay({ world, npcId, onClose }: { world: World; npcId: string; onClose: () => void }) {
  const npc = world.npc(npcId);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [debug, setDebug] = useState<{ system: string; messages: number; rawError?: string } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [npcId]);

  if (!npc) return null;
  const settings = peekSettings();
  const offline = !settings.enabled || !settings.baseUrl.trim();

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    const s = peekSettings();
    if (!s.enabled || !s.baseUrl.trim()) {
      setError("Roleplay is offline — set a provider in Settings.");
      return;
    }
    setText("");
    setBusy(true);
    setError(null);
    const snap = snapshotNpc(world, npc) as Record<string, unknown> & {
      narrative: { public: string; private: string; voice: string };
    };
    const { narrative, ...live } = snap;
    const packed = buildMessages({
      book: s.prompts,
      name: npc.name,
      setting: world.settingBible,
      narrative,
      ancestry: String(snap.ancestry ?? ""),
      job: String(snap.job ?? ""),
      liveJson: JSON.stringify(live),
      history,
      message: message.slice(0, 800),
      budget: s,
    });
    setDebug({ system: packed.messages[0]?.content ?? "", messages: packed.messages.length });
    const nextHist = [...history, { role: "user" as const, content: message }];
    setHistory(nextHist);
    const res = await roleplayTurn({
      data: {
        messages: packed.messages,
        connection: s,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      setDebug((d) => (d ? { ...d, rawError: res.error } : d));
      return;
    }
    setUsage(usageLine(packed.usedChars, s.contextTokens));
    setHistory([...nextHist, { role: "assistant" as const, content: res.speech + (res.action ? `\n(${res.action})` : "") }]);
    const rels: Record<string, Record<string, number>> = res.deltas.relationships ?? {};
    if (rels.pc && !rels[world.player.id]) rels[world.player.id] = rels.pc;
    applyDeltas(world, npc, {
      needs: res.deltas.needs,
      mood: res.deltas.mood,
      relationships: rels,
      events: res.deltas.events,
      knowledge: res.deltas.knowledge,
    });
  };

  const finish = () => {
    world.endRoleplay(npc.id);
    onClose();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <p className="font-display text-lg leading-tight">{npc.name}</p>
          <p className="text-xs text-muted">Autonomous sim paused for this person only.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={finish}>
          End
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {offline && (
          <p className="text-sm text-muted">
            Roleplay is offline — set a provider in Settings. The town keeps living either way.
          </p>
        )}
        {history.length === 0 && !offline && (
          <p className="text-sm text-muted">
            {npc.name} regards you. Mood {Math.round(npc.bb.mood)}. Goal was {npc.bb.goalId ? world.defs.goals.find((g) => g.id === npc.bb.goalId)?.label ?? "unknown" : "none"}.
          </p>
        )}
        {history.map((h, i) => (
          <p key={i} className={h.role === "user" ? "text-sm text-muted" : "text-sm"}>
            <span className="text-xs uppercase tracking-wide text-muted">{h.role === "user" ? "You" : npc.name.split(" ")[0]} · </span>
            {h.content}
          </p>
        ))}
        {busy && <p className="text-sm text-muted">Listening…</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        {usage && <p className="text-xs text-muted">This turn used {usage}.</p>}
        {debug && (
          <div className="grid gap-1">
            <button
              type="button"
              className="h-10 rounded-sm px-2 text-left text-xs text-muted hover:bg-card-2"
              onClick={() => setShowDebug((v) => !v)}
            >
              {showDebug ? "Hide debug" : "Debug"}
            </button>
            {showDebug && (
              <div className="grid gap-1 text-xs text-muted">
                <p>Packed messages: {debug.messages}</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-card-2 p-2">{debug.system}</pre>
                {debug.rawError && <p className="text-danger">{debug.rawError}</p>}
              </div>
            )}
          </div>
        )}
      </div>
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          data-roleplay-input=""
          className="h-11 min-w-0 flex-1 rounded-md bg-background px-3 text-sm text-foreground shadow-[var(--shadow-border)] placeholder:text-muted"
          value={text}
          placeholder={offline ? "Offline — see Settings" : "Say something"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          maxLength={800}
          autoFocus
        />
        <Button type="submit" disabled={busy || !text.trim()} size="md">
          Speak
        </Button>
      </form>
    </div>
  );
}
