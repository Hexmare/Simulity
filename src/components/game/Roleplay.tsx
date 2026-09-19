import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionClient } from "@/lib/session-client";
import type { SceneView } from "@/lib/protocol";
import type { World } from "@/sim/world";

export function Conversation({
  world,
  scene,
  client,
  error,
  onEnded,
}: {
  world: World;
  scene: SceneView;
  client: SessionClient;
  error?: string | null;
  onEnded?: () => void;
}) {
  const [text, setText] = useState("");
  const [picker, setPicker] = useState<"add" | "call" | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const here = useMemo(
    () => world.npcs.filter((n) => n.kind !== "pc" && world.isHere(n.id) && !scene.ids.includes(n.id)),
    [world, world.tickIndex, scene.ids],
  );
  const away = useMemo(
    () => world.npcs.filter((n) => n.kind !== "pc" && !world.isHere(n.id) && !scene.ids.includes(n.id)),
    [world, world.tickIndex, scene.ids],
  );

  const statusLine =
    scene.status.phase === "director"
      ? scene.status.pass === 2
        ? "Director (again)…"
        : "Director…"
      : scene.status.phase === "character"
        ? `${scene.status.name}…`
        : scene.running
          ? "Listening…"
          : null;

  const send = () => {
    const message = text.trim();
    if (!message || scene.running || scene.ids.length === 0) return;
    setText("");
    client.send({ type: "speak", text: message });
  };

  const empty = scene.ids.length === 0 && scene.history.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        {scene.ids.map((id) => {
          const n = world.npc(id);
          const called = scene.presence[id] === "called";
          return (
            <button
              key={id}
              type="button"
              className="flex h-9 items-center gap-2 rounded-full bg-card-2 pl-1 pr-2.5 text-sm hover:bg-border"
              onClick={() => client.send({ type: "sceneRemove", npcId: id })}
              title="Remove from scene"
            >
              {n?.portrait ? (
                <img src={n.portrait} alt="" className="portrait size-7 rounded-full object-cover" crossOrigin="anonymous" />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-card text-xs text-muted">{(n?.name ?? "?").slice(0, 1)}</span>
              )}
              <span className="max-w-28 truncate">{n?.name ?? id}</span>
              {called ? <span className="text-xs uppercase tracking-wide text-muted">called</span> : null}
              <span className="text-muted">×</span>
            </button>
          );
        })}
        <Button type="button" variant="ghost" size="sm" onClick={() => setPicker((p) => (p === "add" ? null : "add"))}>
          Add
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setPicker((p) => (p === "call" ? null : "call"))}>
          Call
        </Button>
        <div className="ml-auto flex gap-1">
          {scene.running && (
            <Button type="button" variant="ghost" size="sm" onClick={() => client.send({ type: "sceneCancel" })}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              client.send({ type: "sceneEnd" });
              onEnded?.();
            }}
          >
            End
          </Button>
        </div>
      </div>
      {picker && (
        <div className="mx-3 mt-2 max-h-40 overflow-y-auto rounded-md bg-card-2 p-2">
          <p className="mb-1 text-xs text-muted">{picker === "add" ? "Here" : "Not here"}</p>
          {(picker === "add" ? here : away).length === 0 && (
            <p className="text-xs text-muted">{picker === "add" ? "Nobody else is here." : "Everyone nearby is already here."}</p>
          )}
          {(picker === "add" ? here : away).map((n) => (
            <button
              key={n.id}
              type="button"
              className="flex h-10 w-full items-center rounded-sm px-2 text-left text-sm hover:bg-card"
              onClick={() => {
                client.send({ type: picker === "add" ? "sceneAdd" : "sceneCall", npcId: n.id });
                setPicker(null);
              }}
            >
              {n.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {empty && (
          <div className="grid h-full place-items-center">
            <p className="max-w-sm text-center text-sm text-muted">Add someone who is here, or Call across the ward.</p>
          </div>
        )}
        {scene.history.map((h, i) => (
          <div key={i} className={h.role === "user" ? "text-muted" : "text-foreground"}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {h.role === "user" ? (h.speaker ?? world.player.name) : h.speaker}
              {h.presence === "called" ? " · called" : ""}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed">{h.content}</p>
            {h.action ? <p className="mt-0.5 text-sm text-muted">({h.action})</p> : null}
          </div>
        ))}
        {statusLine && <p className="text-sm italic text-muted">{statusLine}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="grid gap-1">
          <button
            type="button"
            className="h-9 rounded-sm px-2 text-left text-xs text-muted hover:bg-card-2"
            onClick={() => setShowDebug((v) => !v)}
          >
            {showDebug ? "Hide debug" : "Debug"}
          </button>
          {showDebug && (
            <div className="grid gap-1 text-xs text-muted">
              <p>
                Phase {scene.status.phase}
                {scene.status.phase === "director" ? ` pass ${scene.status.pass}` : ""}
              </p>
              <p>Participants {scene.ids.length}</p>
              {scene.debug?.error ? <p className="text-danger">{scene.debug.error}</p> : null}
              {scene.debug?.raw ? (
                <details>
                  <summary className="cursor-pointer">Director raw</summary>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-card-2 p-1.5">{scene.debug.raw}</pre>
                </details>
              ) : null}
              {scene.debug?.acts?.length ? (
                <ul className="grid gap-1">
                  {scene.debug.acts.map((a) => (
                    <li key={a.id}>
                      pass {scene.debug?.pass} · {world.npc(a.id)?.name ?? a.id}
                      {a.why ? ` — ${a.why}` : ""}
                      {a.guidance ? `: ${a.guidance}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No Director acts this pass.</p>
              )}
              <a href="/debug" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                Open /debug LLM trace
              </a>
            </div>
          )}
        </div>
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
      >
        <Input
          data-roleplay-input=""
          className="min-w-0 flex-1 bg-background"
          value={text}
          placeholder={scene.ids.length === 0 ? "Add someone first" : "Say something"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          maxLength={800}
          disabled={scene.running || scene.ids.length === 0}
        />
        <Button type="submit" disabled={scene.running || scene.ids.length === 0 || !text.trim()} size="md">
          Speak
        </Button>
      </form>
    </div>
  );
}

/** @deprecated Ledger no longer hosts chat — Conversation is the scene view. */
export const Roleplay = Conversation;
