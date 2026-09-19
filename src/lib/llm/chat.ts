import type { ChatMessage } from "./packer";

export interface ChatConnection {
  baseUrl: string;
  path: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

export type ChatResult =
  | { ok: true; text: string; latencyMs: number }
  | { ok: false; error: string };

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function fail(prefix: string, err: unknown): ChatResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (/abort/i.test(msg)) return { ok: false, error: `${prefix}: timed out` };
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN/i.test(msg)) {
    return { ok: false, error: `${prefix}: unreachable (${msg.slice(0, 80)})` };
  }
  return { ok: false, error: `${prefix}: ${msg.slice(0, 120)}` };
}

/**
 * Minimal OpenAI-compatible Chat Completions call. Client-safe (global
 * fetch) so headless harnesses can exercise the error mapping.
 */
export async function chatCompletions(
  conn: ChatConnection,
  messages: ChatMessage[],
  opts?: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal },
): Promise<ChatResult> {
  const url = joinUrl(conn.baseUrl, conn.path);
  const started = Date.now();
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 30000);
  if (opts?.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      return { ok: false, error: "Connection failed: timed out" };
    }
    opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (conn.apiKey.trim()) headers.Authorization = `Bearer ${conn.apiKey.trim()}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model: conn.model,
        messages,
        max_tokens: opts?.maxTokens ?? conn.maxOutputTokens,
        temperature: conn.temperature,
      }),
    });
    if (!res.ok) {
      const kind = res.status === 401 || res.status === 403 ? "auth rejected" : `HTTP ${res.status}`;
      return { ok: false, error: `Provider ${kind}` };
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return { ok: false, error: "Provider returned no text" };
    return { ok: true, text, latencyMs: Date.now() - started };
  } catch (err) {
    return fail("Connection failed", err);
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
}
