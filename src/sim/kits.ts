import type { Kit } from "./types.ts";

// Shipped generation kits (content/kits/*.json). A kit is data: what a fresh
// city builds and who lives in it. No kind/job slugs — only catalog UUIDs.
import shadowsVeil from "../../content/kits/shadows-veil.json" with { type: "json" };

const KITS: Kit[] = [shadowsVeil as unknown as Kit];

/** Default active kit (pinned UUID from content/kits/shadows-veil.json), so `new World(seed)` keeps working unchanged. */
export const DEFAULT_KIT_ID = "f3899133-abe8-490a-a1ab-57da0ecba1cf";

export function allKits(): Kit[] {
  return [...KITS];
}

/** Look up a kit by UUID or slug; falls back to the default kit. */
export function getKit(idOrSlug?: string): Kit {
  if (!idOrSlug) return KITS[0]!;
  const hit = KITS.find((k) => k.id === idOrSlug || k.slug === idOrSlug);
  if (!hit) throw new Error(`unknown kit: ${idOrSlug}`);
  return hit;
}

/** Non-throwing lookup for runtime paths (custom-kit towns fall back to shipped). */
export function getKitSafe(idOrSlug?: string): Kit {
  try {
    return getKit(idOrSlug);
  } catch {
    return KITS[0]!;
  }
}

/** Look up a kit including caller-supplied custom kits (not shipped). */
export function getKitWithCustom(idOrSlug: string | undefined, custom: Kit[]): Kit {
  if (idOrSlug) {
    const hit = custom.find((k) => k.id === idOrSlug || k.slug === idOrSlug);
    if (hit) return hit;
  }
  return getKit(idOrSlug);
}

/** Sum of roster counts — the default People value for a kit. */
export function kitPopulation(kit: Kit): number {
  return kit.roster.reduce((n, r) => n + Math.max(0, r.count), 0);
}
