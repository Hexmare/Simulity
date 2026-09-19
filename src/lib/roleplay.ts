import { createServerFn } from "@tanstack/react-start";
import { chatCompletions } from "./llm/chat";
import { readBundle } from "@/lib/server/profiles";

export const testConnection = createServerFn({ method: "POST" })
  .validator((input: { profileId: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> => {
    const bundle = await readBundle();
    const id = String(data.profileId ?? "").trim();
    const profile =
      id === "default" || !id
        ? (bundle.profiles.find((p) => p.isDefault) ?? bundle.profiles[0])
        : bundle.profiles.find((p) => p.id === id);
    if (!profile) return { ok: false, error: "No such connection profile." };
    if (!profile.baseUrl.trim()) return { ok: false, error: "Base URL is empty." };
    const res = await chatCompletions(
      {
        baseUrl: profile.baseUrl,
        path: profile.path,
        apiKey: profile.apiKey,
        model: profile.model,
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
      },
      [{ role: "user", content: "ping" }],
      { maxTokens: 1, timeoutMs: 15000 },
    );
    if (!res.ok) return res;
    return { ok: true, latencyMs: res.latencyMs };
  });
