import type { Kit } from "./types.ts";

// Shipped generation kits (content/kits/*.json). A kit is data: what a fresh
// town builds and who lives in it. No kind/job slugs — only catalog UUIDs.
import fenwickWard from "../../content/kits/fenwick-ward.json" with { type: "json" };

const KITS: Kit[] = [fenwickWard as unknown as Kit];

/** Default active kit, so `new World(seed)` keeps working unchanged. */
export const DEFAULT_KIT_ID = "fenwick-ward";

export function allKits(): Kit[] {
  return [...KITS];
}

/** Look up a kit by UUID or slug; falls back to the default kit. */
export function getKit(idOrSlug?: string): Kit {
  if (!idOrSlug) return KITS[0];
  const hit = KITS.find((k) => k.id === idOrSlug || k.slug === idOrSlug);
  if (!hit) throw new Error(`unknown kit: ${idOrSlug}`);
  return hit;
}
