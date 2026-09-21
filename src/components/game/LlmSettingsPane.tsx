import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { testConnection } from "@/lib/roleplay";
import { CONTEXT_OPTIONS } from "@/lib/llm/settings";
import { loadBundle, saveBundle } from "@/lib/persistence-client";
import { type PromptBook } from "@/lib/llm/prompts";
import { shippedAgents, shippedBook, shippedDef, type AgentId } from "@/lib/llm/prompt-catalog";
import { defaultBundle, type ConnectionProfile, type LlmBundle } from "@/lib/llm/bundle";
import { TabBar } from "@/components/ui/tabs";

type Pane = "profiles" | "agents" | "all";

/** World-free LLM settings: used in-play and on the start screen. */
export function LlmSettingsPane({ onMutate, pane = "all" }: { onMutate?: () => void; pane?: Pane }) {
  const [bundle, setBundle] = useState<LlmBundle>(() => defaultBundle());
  const [tab, setTab] = useState<"profiles" | "agents">(pane === "agents" ? "agents" : "profiles");
  const saveTimer = useRef<number | null>(null);
  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;

  useEffect(() => {
    void loadBundle().then(setBundle);
  }, []);

  const persist = (next: LlmBundle) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveBundle(next).then(setBundle);
    }, 250);
  };

  const flush = async () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const saved = await saveBundle(bundleRef.current);
    setBundle(saved);
  };

  const update = (next: LlmBundle) => {
    setBundle(next);
    persist(next);
    onMutate?.();
  };

  const inner = pane === "all" ? tab : pane;

  return (
    <div className="grid gap-3">
      {pane === "all" && (
        <TabBar
          className="-mx-1"
          value={tab}
          onChange={setTab}
          options={[
            { id: "profiles", label: "Profiles" },
            { id: "agents", label: "Agents" },
          ]}
        />
      )}
      {inner === "profiles" && <ProfilesTab bundle={bundle} update={update} flush={flush} />}
      {inner === "agents" && <AgentsTab bundle={bundle} update={update} />}
    </div>
  );
}

function ProfilesTab({ bundle, update, flush }: { bundle: LlmBundle; update: (b: LlmBundle) => void; flush: () => Promise<void> }) {
  const [sel, setSel] = useState(bundle.profiles.find((p) => p.isDefault)?.id ?? bundle.profiles[0]?.id ?? "");
  const profile = bundle.profiles.find((p) => p.id === sel) ?? bundle.profiles[0];
  if (!profile) return null;

  const patch = (partial: Partial<ConnectionProfile>) => {
    update({
      ...bundle,
      profiles: bundle.profiles.map((p) => (p.id === profile.id ? { ...p, ...partial } : p)),
    });
  };

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <select
          className="h-11 min-w-0 flex-1 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={profile.id}
          onChange={(e) => setSel(e.target.value)}
        >
          {bundle.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? " (Default)" : ""}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const p: ConnectionProfile = {
              ...profile,
              id: crypto.randomUUID(),
              name: "New connection",
              isDefault: false,
              apiKey: "",
            };
            update({ ...bundle, profiles: [...bundle.profiles, p] });
            setSel(p.id);
          }}
        >
          Add
        </Button>
      </div>
      <label className="grid gap-1 text-xs text-muted">
        Name
        <Input value={profile.name} maxLength={48} onChange={(e) => patch({ name: e.target.value || "Default" })} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={profile.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Enabled
      </label>
      {!profile.isDefault && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            update({
              ...bundle,
              profiles: bundle.profiles.map((p) => ({ ...p, isDefault: p.id === profile.id })),
            })
          }
        >
          Make Default
        </Button>
      )}
      <ConnectionFields profile={profile} patch={patch} flush={flush} />
      {!profile.isDefault && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const rest = bundle.profiles.filter((p) => p.id !== profile.id);
            if (rest.length === 0) return;
            const agents = { ...bundle.agents };
            for (const id of Object.keys(agents) as AgentId[]) {
              if (agents[id].profileId === profile.id) agents[id] = { ...agents[id], profileId: "default" };
            }
            update({ ...bundle, profiles: rest, agents });
            setSel(rest.find((p) => p.isDefault)?.id ?? rest[0]!.id);
          }}
        >
          Delete
        </Button>
      )}
    </div>
  );
}

function ConnectionFields({
  profile,
  patch,
  flush,
}: {
  profile: ConnectionProfile;
  patch: (p: Partial<ConnectionProfile>) => void;
  flush: () => Promise<void>;
}) {
  const [result, setResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      await flush();
      const res = await testConnection({ data: { profileId: profile.id } });
      setResult(res.ok ? `Connected — answered in ${res.latencyMs} ms.` : res.error);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setTesting(false);
    }
  };
  return (
    <>
      <label className="grid gap-1 text-xs text-muted">
        Base URL
        <Input value={profile.baseUrl} maxLength={200} onChange={(e) => patch({ baseUrl: e.target.value })} />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Path
        <Input value={profile.path} maxLength={120} onChange={(e) => patch({ path: e.target.value })} />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        API key (optional — last four shown; stored on this server)
        <Input type="password" value={profile.apiKey} maxLength={300} autoComplete="off" onChange={(e) => patch({ apiKey: e.target.value })} />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Model id
        <Input value={profile.model} maxLength={120} onChange={(e) => patch({ model: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Temperature
          <Input type="number" min={0} max={2} step={0.1} value={profile.temperature} onChange={(e) => patch({ temperature: Number(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Max output tokens
          <Input type="number" min={1} max={32000} value={profile.maxOutputTokens} onChange={(e) => patch({ maxOutputTokens: Number(e.target.value) })} />
        </label>
      </div>
      <label className="grid gap-1 text-xs text-muted">
        Context window
        <select className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]" value={profile.contextTokens} onChange={(e) => patch({ contextTokens: Number(e.target.value) })}>
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
          <Input type="number" min={1} max={100} value={profile.maxHistoryTurns} onChange={(e) => patch({ maxHistoryTurns: Number(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Max snapshot chars
          <Input type="number" min={256} max={20000} step={256} value={profile.maxSnapshotChars} onChange={(e) => patch({ maxSnapshotChars: Number(e.target.value) })} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Timeout (ms)
          <Input type="number" min={1000} max={300000} step={1000} value={profile.timeoutMs ?? 45000} onChange={(e) => patch({ timeoutMs: Number(e.target.value) || 45000 })} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Auto-retries
          <Input type="number" min={0} max={5} value={profile.maxRetries ?? 2} onChange={(e) => patch({ maxRetries: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} />
        </label>
      </div>
      <Button type="button" disabled={testing || !profile.baseUrl.trim()} onClick={() => void test()}>
        {testing ? "Testing…" : "Test connection"}
      </Button>
      {result && <p className="text-xs text-muted">{result}</p>}
    </>
  );
}

function AgentsTab({ bundle, update }: { bundle: LlmBundle; update: (b: LlmBundle) => void }) {
  const [agent, setAgent] = useState<AgentId>("director");
  const binding = bundle.agents[agent] ?? {
    agentId: agent,
    profileId: "default" as const,
    overrides: {},
    prompts: shippedBook(agent),
  };
  const def = shippedDef(agent);
  const setBinding = (partial: Partial<typeof binding>) => {
    update({ ...bundle, agents: { ...bundle.agents, [agent]: { ...binding, ...partial } } });
  };
  const ov = binding.overrides;
  const setOv = (key: keyof typeof ov, value: string) => {
    const next = { ...ov };
    if (!value.trim()) delete next[key];
    else if (key === "temperature") next[key] = Number(value);
    else if (key === "maxOutputTokens" || key === "contextTokens" || key === "maxHistoryTurns" || key === "maxSnapshotChars" || key === "timeoutMs" || key === "maxRetries")
      next[key] = Number(value);
    else (next as Record<string, string>)[key] = value;
    setBinding({ overrides: next });
  };
  const setPrompt = (key: keyof PromptBook, value: string) => {
    setBinding({ prompts: { ...binding.prompts, [key]: value } });
  };
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-xs text-muted">
        Agent
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={agent}
          onChange={(e) => setAgent(e.target.value as AgentId)}
        >
          {shippedAgents().map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.status === "registered" ? " (registered)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">{def.description}</p>
      <label className="grid gap-1 text-xs text-muted">
        Profile
        <select
          className="h-11 rounded-md bg-card-2 px-3 text-sm text-foreground shadow-[var(--shadow-border)]"
          value={binding.profileId}
          onChange={(e) => setBinding({ profileId: e.target.value })}
        >
          <option value="default">Default (follows)</option>
          {bundle.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">Overrides (blank = inherit from the profile)</p>
      <label className="grid gap-1 text-xs text-muted">
        Max output tokens
        <Input
          placeholder="inherit"
          value={ov.maxOutputTokens != null ? String(ov.maxOutputTokens) : ""}
          onChange={(e) => setOv("maxOutputTokens", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Temperature
        <Input placeholder="inherit" value={ov.temperature != null ? String(ov.temperature) : ""} onChange={(e) => setOv("temperature", e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-muted">
          Timeout (ms)
          <Input
            placeholder="inherit"
            value={ov.timeoutMs != null ? String(ov.timeoutMs) : ""}
            onChange={(e) => setOv("timeoutMs", e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Auto-retries
          <Input
            placeholder="inherit"
            value={ov.maxRetries != null ? String(ov.maxRetries) : ""}
            onChange={(e) => setOv("maxRetries", e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-muted">Placeholders: {def.placeholders.map((k) => `{{${k}}}`).join(" ")}</p>
      {(["system", "character", "snapshot", "deltaSchema"] as const).map((key) => (
        <label key={key} className="grid gap-1 text-xs text-muted">
          {key}
          <textarea
            className="min-h-24 rounded-md bg-card-2 px-3 py-2 text-sm leading-relaxed text-foreground shadow-[var(--shadow-border)]"
            value={binding.prompts[key]}
            maxLength={16000}
            onChange={(e) => setPrompt(key, e.target.value)}
          />
        </label>
      ))}
      <Button type="button" variant="ghost" onClick={() => setBinding({ prompts: { ...shippedBook(agent) }, overrides: {} })}>
        Reset to shipped defaults
      </Button>
    </div>
  );
}
