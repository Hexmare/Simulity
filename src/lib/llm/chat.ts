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

export type CompleterOpts = { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal; json?: boolean };

/**
 * Minimal OpenAI-compatible Chat Completions call. Client-safe (global
 * fetch) so headless harnesses can exercise the error mapping.
 *
 * `json: true` requests `response_format: { type: "json_object" }`. Providers
 * that reject the field get one plain retry without it.
 */
export async function chatCompletions(
  conn: ChatConnection,
  messages: ChatMessage[],
  opts?: CompleterOpts,
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
    const baseBody = {
      model: conn.model,
      messages,
      max_tokens: opts?.maxTokens ?? conn.maxOutputTokens,
      temperature: conn.temperature,
    };
    const send = (json: boolean) =>
      fetch(url, {
        method: "POST",
        headers,
        signal: ctrl.signal,
        body: JSON.stringify(json ? { ...baseBody, response_format: { type: "json_object" } } : baseBody),
      });
    let res = await send(!!opts?.json);
    if (!res.ok && opts?.json) {
      // Provider does not speak response_format: one plain retry.
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 160);
      } catch {
        /* ignore */
      }
      if (/response_format|json_object|invalid/i.test(detail) || res.status === 400) {
        res = await send(false);
      }
    }
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
