import { createServerFn } from "@tanstack/react-start";
import { clearLlmTrace, getLlmTrace, type LlmTraceEntry } from "@/lib/server/llm-trace";

export const getLlmTraceFn = createServerFn({ method: "GET" })
  .validator(() => ({}))
  .handler(async (): Promise<{ entries: LlmTraceEntry[] }> => {
    return { entries: getLlmTrace() };
  });

export const clearLlmTraceFn = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(async (): Promise<{ ok: true }> => {
    clearLlmTrace();
    return { ok: true };
  });
