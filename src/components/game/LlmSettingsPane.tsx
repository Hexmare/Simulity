import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { testConnection } from "@/lib/roleplay";
import { CONTEXT_OPTIONS, loadSettings, saveSettings, type LlmSettings } from "@/lib/llm/settings";
import { DEFAULT_BOOK } from "@/lib/llm/prompts";
import { cn } from "@/lib/utils";

/** World-free LLM settings: used in-play and on the start screen. */
export function LlmSettingsPane({ onMutate }: { onMutate?: () => void }) {
  const [tab, setTab] = useState<"connection" | "prompts" | "context">("connection");
  const [settings, setSettings] = useState<LlmSettings>(() => loadSettings());

  const update = (patch: Partial<LlmSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      onMutate?.();
      return next;
    });
  };

  return (
    <div className="grid gap-3">
      <div className="flex gap-1">
        {(["connection", "prompts", "context"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={cn(
              "h-10 flex-1 rounded-sm text-xs font-medium capitalize",
              tab === t ? "bg-accent text-accent-foreground" : "text-muted hover:bg-card-2 hover:text-foreground",
            )}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "connection" && <ConnectionTab settings={settings} update={update} />}
      {tab === "prompts" && <PromptsTab settings={settings} update={update} />}
      {tab === "context" && <ContextTab settings={settings} update={update} />}
    </div>
  );
}

function ConnectionTab({ settings, update }: { settings: LlmSettings; update: (p: Partial<LlmSettings>) => void }) {
  const [result, setResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await testConnection({ data: { connection: settings } });
      setResult(res.ok ? `Connected — answered in ${res.latencyMs} ms.` : res.error);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        Roleplay enabled
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Base URL
        <Input value={settings.baseUrl} maxLength={200} onChange={(e) => update({ baseUrl: e.target.value })} />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Path
        <Input value={settings.path} maxLength={120} onChange={(e) => update({ path: e.target.value })} />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        API key (optional — empty is fine for keyless providers; never leaves your device except to the provider)
        <Input
          type="password"
          value={settings.apiKey}
          maxLength={300}
          autoComplete="off"
          onChange={(e) => update({ apiKey: e.target.value })}
        />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Model id
        <Input value={settings.model} maxLength={120} onChange={(e) => update({ model: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Temperature
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature}
            onChange={(e) => update({ temperature: Number(e.target.value) })}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Max output tokens
          <Input
            type="number"
            min={1}
            max={8000}
            value={settings.maxOutputTokens}
            onChange={(e) => update({ maxOutputTokens: Number(e.target.value) })}
          />
        </label>
      </div>
      <Button type="button" disabled={testing || !settings.baseUrl.trim()} onClick={() => void test()}>
        {testing ? "Testing…" : "Test connection"}
      </Button>
      {result && <p className="text-xs text-muted">{result}</p>}
    </div>
  );
}

function PromptsTab({ settings, update }: { settings: LlmSettings; update: (p: Partial<LlmSettings>) => void }) {
  const set = (key: keyof LlmSettings["prompts"], value: string) => {
    update({ prompts: { ...settings.prompts, [key]: value } });
  };
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted">Placeholders: {`{{name}} {{setting}} {{ancestry}} {{job}} {{voice}} {{public}} {{private}} {{narrative}} {{snapshot}}`}</p>
      {(
        [
          ["system", "System"],
          ["character", "Character"],
          ["snapshot", "Snapshot"],
          ["deltaSchema", "Delta schema"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="grid gap-1 text-xs text-muted">
          {label}
          <textarea
            className="min-h-24 rounded-md bg-card-2 px-3 py-2 text-sm leading-relaxed text-foreground shadow-[var(--shadow-border)]"
            value={settings.prompts[key]}
            maxLength={8000}
            onChange={(e) => set(key, e.target.value)}
          />
        </label>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => update({ prompts: { ...DEFAULT_BOOK } })}
      >
        Reset to shipped defaults
      </Button>
    </div>
  );
}

function ContextTab({ settings, update }: { settings: LlmSettings; update: (p: Partial<LlmSettings>) => void }) {
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-xs text-muted">
        Context window
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={settings.contextTokens}
          onChange={(e) => update({ contextTokens: Number(e.target.value) })}
        >
          {CONTEXT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {(n / 1024).toFixed(0)}k
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Max history turns
          <Input
            type="number"
            min={1}
            max={100}
            value={settings.maxHistoryTurns}
            onChange={(e) => update({ maxHistoryTurns: Number(e.target.value) })}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Max snapshot chars
          <Input
            type="number"
            min={256}
            max={20000}
            step={256}
            value={settings.maxSnapshotChars}
            onChange={(e) => update({ maxSnapshotChars: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        Roughly 4 characters per token. When a turn would overflow, the oldest history goes first — system, narrative, and live needs are always kept.
      </p>
    </div>
  );
}
