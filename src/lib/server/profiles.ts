import { withDefaults } from "@/lib/llm/settings";
import { asBundle, defaultBundle, liftSettings, type LlmBundle } from "@/lib/llm/bundle";
import { AGENT_IDS } from "@/lib/llm/prompt-catalog";
import { readKv, writeKv } from "@/lib/server/store";

export {
  asBundle,
  defaultBundle,
  liftSettings,
  maskBundle,
  resolveEffective,
  type AgentBinding,
  type AgentId,
  type ConnectionProfile,
  type LlmBundle,
} from "@/lib/llm/bundle";

const BUNDLE_KEY = "llm_bundle";

export async function readBundle(): Promise<LlmBundle> {
  const raw = await readKv(BUNDLE_KEY);
  const parsed = asBundle(raw);
  if (parsed) {
    const rawCount =
      raw && typeof raw === "object" && "agents" in (raw as object)
        ? Object.keys((raw as LlmBundle).agents ?? {}).length
        : 0;
    if (rawCount < AGENT_IDS.length) await writeKv(BUNDLE_KEY, parsed);
    return parsed;
  }
  const { readLlmSettings } = await import("@/lib/server/store");
  const legacy = await readLlmSettings();
  const lifted = Object.keys(legacy).length ? liftSettings(withDefaults(legacy)) : defaultBundle();
  await writeKv(BUNDLE_KEY, lifted);
  return lifted;
}

export async function writeBundle(bundle: LlmBundle): Promise<LlmBundle> {
  await writeKv(BUNDLE_KEY, bundle);
  return bundle;
}
