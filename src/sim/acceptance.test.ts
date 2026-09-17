import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SHIPPED_JOB_IDS, SHIPPED_KIND_IDS } from "./defs.ts";
import { DEFAULT_KIT_ID, getKit } from "./kits.ts";
import { hydrateWorld, snapshotWorld } from "./persist.ts";
import { TICKS_PER_HOUR } from "./types.ts";
import { World } from "./world.ts";

// docs/Data_Driven_Catalog.md §11 — data-driven catalog acceptance.
const here = path.dirname(fileURLToPath(import.meta.url));
const IS_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const kindIdBySlug = (w: World, slug: string): string | undefined =>
  Object.values(w.defs.buildingKinds).find((k) => k.slug === slug)?.id;

test("shipped catalog rows carry the pinned v4 UUID ids", () => {
  for (const id of [...SHIPPED_JOB_IDS, ...SHIPPED_KIND_IDS]) assert.match(id, IS_UUID_V4, `not a v4 UUID: ${id}`);
  const kit = getKit(DEFAULT_KIT_ID);
  assert.ok(IS_UUID_V4.test(kit.defaultPcJobId), "kit default job is a catalog UUID");
  assert.ok(kit.id !== DEFAULT_KIT_ID && IS_UUID_V4.test(kit.id), "kit id is its own pinned UUID (slug resolves it)");
});

test("a fresh town shows the ward's landmarks by label", () => {
  const w = new World(1742);
  assert.equal(w.townName, getKit(DEFAULT_KIT_ID).label, "town takes the kit's label");
  const want: [string, string][] = [
    ["diner", "Diner"],
    ["parish", "Parish"],
    ["night-market", "Night market"],
    ["precinct", "Precinct"],
    ["wash", "Wash kiosk"],
  ];
  for (const [slug, label] of want) {
    const id = kindIdBySlug(w, slug);
    assert.ok(id, `no kind with slug ${slug}`);
    assert.equal(w.defs.buildingKinds[id!]?.label, label, `${slug} has the doc's label`);
    assert.ok(w.buildings.some((b) => b.kind === id), `the ward has a ${label}`);
  }
});

test("saved runtime references are catalog ids, never slugs", () => {
  const w = new World(1742);
  for (const b of w.buildings) assert.match(b.kind, IS_UUID_V4, `${b.name} kind ${b.kind}`);
  for (const n of [...w.npcs, w.player]) {
    assert.ok(w.defs.jobs[n.bb.jobId], `${n.name} job ${n.bb.jobId} unknown`);
    assert.match(n.bb.jobId, IS_UUID_V4, `${n.name} job id ${n.bb.jobId}`);
    if (n.bb.workId) assert.match(n.bb.workId, IS_UUID_V4, `${n.name} workId ${n.bb.workId}`);
    assert.ok(![...w.npcs].some((m) => m.id === "pc"), "instance ids are UUIDs; the player stays 'pc'");
  }
  // The kit's sys tokens are the only non-UUID references in runtime data.
  for (const row of getKit(DEFAULT_KIT_ID).roster) assert.ok(w.defs.jobs[row.jobId], `roster job ${row.jobId}`);
});

test("renaming a slug orphans nothing — slugs are authoring-only", () => {
  const w = new World(1742);
  const dinerId = kindIdBySlug(w, "diner")!;
  const origSlug = w.defs.buildingKinds[dinerId]!.slug;
  try {
    w.defs.buildingKinds[dinerId]!.slug = "all-nite"; // zero code changes — data only
    assert.equal(kindIdBySlug(w, "diner"), undefined, "the old slug is gone");
    const jobsThere = Object.values(w.defs.jobs).filter((j) => j.workplace === dinerId);
    assert.ok(jobsThere.length >= 1, "a trade works at the renamed kind");
    const n = w.addVillager({ jobId: jobsThere[0]!.id });
    assert.ok(n);
    const dinerB = w.buildings.find((b) => b.kind === dinerId);
    assert.equal(n!.bb.workId, dinerB?.id, "workplace still resolves by id");
    const save = snapshotWorld(w);
    assert.ok(save.buildings.some((b) => b.kind === dinerId), "instances keep their kind id");
    const again = hydrateWorld(save);
    assert.ok(again.defs.jobs[jobsThere[0]!.id]);
    assert.equal(kindIdBySlug(again, "diner"), undefined);
  } finally {
    w.defs.buildingKinds[dinerId]!.slug = origSlug;
  }
});

test("removing a shipped job deletes it and orphans no one", () => {
  const w = new World(1742);
  const kit = getKit(DEFAULT_KIT_ID);
  const victim = SHIPPED_JOB_IDS.find((id) => id !== kit.defaultPcJobId)!;
  assert.equal(w.removeJob(victim), null);
  assert.equal(w.defs.jobs[victim], undefined, "the trade is forgotten");
  for (const n of [...w.npcs, w.player]) {
    if (!n.bb.jobId) continue;
    assert.ok(w.defs.jobs[n.bb.jobId], `${n.name} points at the deleted trade`);
  }
  const save = snapshotWorld(w);
  assert.ok(save.defsOverlay.jobs.removedIds.includes(victim));
  const again = hydrateWorld(save);
  assert.equal(again.defs.jobs[victim], undefined, "the deletion survives a roundtrip");
  for (const n of [...again.npcs, again.player]) assert.ok(again.defs.jobs[n.bb.jobId]);
});

test("shipped kinds stay; custom kinds come and go", () => {
  const w = new World(1742);
  assert.ok(w.removeBuildingKind(SHIPPED_KIND_IDS[0]), "a shipped kind refuses to be unmade");
  const id = crypto.randomUUID();
  assert.equal(
    w.addBuildingKind({
      id,
      slug: "apothecary",
      label: "Apothecary",
      names: [],
      footprint: { w: 5, h: 4 },
      stories: 1,
      ground: [{ kind: "shop" }],
      tags: ["shop"],
    }),
    null,
  );
  assert.ok(w.defs.buildingKinds[id]);
  assert.equal(w.removeBuildingKind(id), null);
  assert.equal(w.defs.buildingKinds[id], undefined, "the custom kind is gone");
});

test("no child job row exists anywhere", () => {
  const w = new World(1742);
  assert.equal(Object.values(w.defs.jobs).some((j) => j.slug === "child"), false);
  for (const row of getKit(DEFAULT_KIT_ID).roster) {
    const lo = row.ages?.[0] ?? 18; // omitted band defaults to the adult range
    assert.ok(row.count > 0 && lo >= 18, `roster band starts at ${lo} (adults only): ${row.jobId}`);
  }
});

test("every soul is an adult and the roster size holds", () => {
  const w = new World(1742);
  const kit = getKit(DEFAULT_KIT_ID);
  const total = kit.roster.reduce((sum, r) => sum + r.count, 0);
  assert.equal(w.npcs.length, total, `expected ${total} residents from the roster`);
  for (const n of [...w.npcs, w.player]) assert.ok(n.age >= 18, `${n.name} is ${n.age}`);
});

test("the ward ticks a full day cleanly (smoke)", () => {
  const w = new World(1742);
  const e0 = w.events.length;
  for (let i = 0; i < TICKS_PER_HOUR * 24; i++) w.step(); // one full sim day, past the next dawn log
  assert.ok(w.events.length > e0, "the ward logs life");
  assert.ok(Number.isFinite(w.player.px) && Number.isFinite(w.player.py), "player stays placed");
  assert.ok([...w.npcs, w.player].every((n) => n.age >= 18), "still adults-only after a full day");
});

test("defs.ts carries no ward literals (spec §7)", () => {
  const src = readFileSync(path.join(here, "defs.ts"), "utf8");
  assert.doesNotMatch(src, /Fenwick/i);
  assert.doesNotMatch(
    src,
    /["'](diner-lead|grid-tech|householder|night-baker|night-watch|parish-clerk|pensioner|runner|signwright|stall-broker|superintendent)["']/,
    "job slugs live in JSON, not code",
  );
  assert.doesNotMatch(
    src,
    /["'](walk-up|tenement|diner|bakery|night-market|parish|atelier|substation|precinct|wash)["']/,
    "kind slugs live in JSON, not code",
  );
});

test("engine modules carry no catalog slug literals (documented exceptions allowed)", () => {
  const jobSlugs = (JSON.parse(readFileSync(path.join(here, "../../content/catalog/jobs.json"), "utf8")) as { slug: string }[]).map(
    (j) => j.slug,
  );
  const kindSlugs = (
    JSON.parse(readFileSync(path.join(here, "../../content/catalog/building-kinds.json"), "utf8")) as { slug: string }[]
  ).map((k) => k.slug);
  // Documented exceptions: the retired-trade elder-band rule (world.ts) and the
  // built-in action vocabulary word "wash" (ai.ts) — not catalog references.
  const allowed: Record<string, Set<string>> = {
    "world.ts": new Set(["pensioner"]),
    "ai.ts": new Set(["wash"]),
  };
  for (const file of readdirSync(here)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const src = readFileSync(path.join(here, file), "utf8");
    for (const slug of [...jobSlugs, ...kindSlugs]) {
      const hit = new RegExp(`["']${slug}["']`).test(src);
      if (hit) assert.ok(allowed[file]?.has(slug) ?? false, `${file} references catalog slug "${slug}" by literal`);
    }
  }
});
