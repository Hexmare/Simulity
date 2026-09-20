import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { clearLlmTraceFn, getLlmTraceFn } from "@/lib/server/debug";
import type { LlmTraceEntry } from "@/lib/server/llm-trace";

export const Route = createFileRoute("/debug")({
  component: DebugPage,
});

function fmtTime(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return String(at);
  }
}

function EntryCard({ entry, open }: { entry: LlmTraceEntry; open: boolean }) {
  const badge =
    entry.agent === "director" ? "bg-sky-500/15 text-sky-300" : entry.agent === "character" ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-300";
  return (
    <details className="rounded-md border border-border bg-card" open={open}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge}`}>{entry.agent}</span>
        <span className="font-medium">{entry.label}</span>
        <span className="text-xs text-muted">{entry.model}</span>
        <span className="text-xs text-muted">{fmtTime(entry.at)}</span>
        <span className="text-xs text-muted">{entry.latencyMs ?? "?"} ms</span>
        {entry.ok ? (
          <span className="text-xs text-emerald-400">ok</span>
        ) : (
          <span className="text-xs text-danger">{entry.error ?? "error"}</span>
        )}
        {entry.ok && entry.error ? <span className="text-xs text-amber-400">{entry.error}</span> : null}
      </summary>
      <div className="grid gap-2 border-t border-border px-3 py-2">
        <details>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">
            Request · {entry.messages.length} messages
          </summary>
          <div className="mt-1 grid gap-2">
            {entry.messages.map((m, i) => (
              <details key={i} className="rounded bg-card-2">
                <summary className="cursor-pointer px-2 py-1 text-xs text-muted">
                  [{i}] {m.role} · {m.content.length} chars
                </summary>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap px-2 pb-2 text-xs leading-relaxed">{m.content}</pre>
              </details>
            ))}
          </div>
        </details>
        <details>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">
            Full request · unbroken
          </summary>
          <div className="mt-1 grid gap-1">
            <button
              type="button"
              className="w-fit rounded border border-border px-2 py-1 text-xs hover:bg-card-2"
              onClick={() => {
                const payload = JSON.stringify(
                  {
                    model: entry.model,
                    max_tokens: entry.maxTokens,
                    temperature: entry.temperature,
                    messages: entry.messages,
                  },
                  null,
                  2,
                );
                void navigator.clipboard?.writeText(payload).catch(() => undefined);
              }}
            >
              Copy
            </button>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-card-2 p-2 text-xs leading-relaxed">
              {JSON.stringify(
                {
                  model: entry.model,
                  max_tokens: entry.maxTokens,
                  temperature: entry.temperature,
                  messages: entry.messages,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </details>
        <details open={!entry.ok}>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">Response</summary>
          <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-card-2 p-2 text-xs leading-relaxed">
            {entry.response ?? entry.error ?? "(no response)"}
          </pre>
        </details>
        {entry.parsed !== undefined && entry.parsed !== null ? (
          <details>
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">Parsed</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-card-2 p-2 text-xs leading-relaxed">
              {JSON.stringify(entry.parsed, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function DebugPage() {
  const [entries, setEntries] = useState<LlmTraceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await getLlmTraceFn({ data: {} });
      setEntries(res.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [auto, refresh]);

  const clear = async () => {
    await clearLlmTraceFn({ data: {} });
    await refresh();
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">LLM Debug</h1>
        <span className="text-xs text-muted">{entries.length} calls (last 100 kept)</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            auto-refresh
          </label>
          <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-card-2" onClick={() => void refresh()}>
            Refresh
          </button>
          <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-card-2" onClick={() => void clear()}>
            Clear
          </button>
          <a href="/" className="rounded border border-border px-2 py-1 text-xs hover:bg-card-2">
            Back
          </a>
        </div>
      </div>
      {loading ? <p className="text-sm text-muted">Loading…</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!loading && entries.length === 0 ? (
        <p className="text-sm text-muted">
          No LLM calls recorded yet. Speak to a character in a scene, then refresh. The Director and Character prompts, raw
          responses, and parsed acts/beats will appear here.
        </p>
      ) : null}
      {entries.map((e, i) => (
        <EntryCard key={e.id} entry={e} open={i === 0} />
      ))}
    </div>
  );
}
