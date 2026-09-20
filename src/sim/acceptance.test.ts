import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ANCESTRY, SHIPPED_JOB_IDS, SHIPPED_KIND_IDS, SYS } from "./defs.ts";
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
  assert.equal(kit.id, DEFAULT_KIT_ID, "the boot-time default is the pinned kit UUID itself");
  assert.ok(IS_UUID_V4.test(kit.id), "kit id is its own pinned UUID");
});

test("a fresh city shows its landmarks by label", () => {
  const w = new World(1742);
  assert.equal(w.townName, getKit(DEFAULT_KIT_ID).label, "town takes the kit's label");
  assert.equal(w.townName, "Shadows Veil", "the shipped city is Shadows Veil");
  const want: [string, string][] = [
    ["diner", "Diner"],
    ["parish", "Parish"],
    ["night-market", "Night market"],
    ["precinct", "Precinct"],
    ["wash", "Wash kiosk"],
    ["bar", "Bar"],
    ["shopfront", "Shopfront"],
    ["pc-home", "Player's rooms"],
  ];
  for (const [slug, label] of want) {
    const id = kindIdBySlug(w, slug);
    assert.ok(id, `no kind with slug ${slug}`);
    assert.equal(w.defs.buildingKinds[id!]?.label, label, `${slug} has the doc's label`);
    assert.ok(w.buildings.some((b) => b.kind === id), `the city has a ${label}`);
  }
});

test("saved runtime references are catalog ids, never slugs", () => {
  const w = new World(1742);
  for (const b of w.buildings) assert.match(b.kind, IS_UUID_V4, `${b.name} kind ${b.kind}`);
  for (const n of [...w.npcs, w.player]) {
    assert.ok(w.defs.jobs[n.bb.jobId], `${n.name} job ${n.bb.jobId} unknown`);
    assert.match(n.bb.jobId, IS_UUID_V4, `${n.name} job id ${n.bb.jobId}`);
    if (n.bb.workId) assert.match(n.bb.workId, IS_UUID_V4, `${n.name} workId ${n.bb.workId}`);
    assert.ok(w.defs.ancestries[n.ancestryId], `${n.name} ancestry ${n.ancestryId} unknown`);
    assert.match(n.ancestryId, IS_UUID_V4, `${n.name} ancestry id ${n.ancestryId}`);
    assert.ok(![...w.npcs].some((m) => m.id === "pc"), "instance ids are UUIDs; the player stays 'pc'");
  }
  // The kit's sys tokens are the only non-UUID references in runtime data.
  for (const row of getKit(DEFAULT_KIT_ID).roster) assert.ok(w.defs.jobs[row.jobId], `roster job ${row.jobId}`);
});

test("fresh towns roll ancestries from the catalog, no slug fallback (spec §5)", () => {
  const w = new World(1742);
  for (const n of [...w.npcs, w.player]) assert.ok(w.defs.ancestries[n.ancestryId], `${n.name} ${n.ancestryId}`);
  // The player starts as the catalog's human row; residents spread across rows by weight.
  assert.equal(w.player.ancestryId, ANCESTRY.human);
  const seen = new Set(w.npcs.map((n) => n.ancestryId));
  assert.ok(seen.size >= 2, `expected multiple ancestries in the ward, got ${[...seen]}`);
});

test("duplicate slugs are rejected when adding rows (uniqueness across shipped ∪ overlay)", () => {
  const w = new World(1742);
  const kindSlug = kindIdBySlug(w, "diner") ? w.defs.buildingKinds[kindIdBySlug(w, "diner")!].slug : "diner";
  assert.equal(kindSlug, "diner");
  const errKind = w.addBuildingKind({
    id: crypto.randomUUID(),
    slug: "diner",
    label: "Duplicate Diner",
    names: [],
    footprint: { w: 5, h: 4 },
    stories: 1,
    ground: [{ kind: "shop" }],
    tags: ["shop"],
  });
  assert.match(errKind ?? "", /already in use/);
  const job = Object.values(w.defs.jobs).find((j) => j.slug === "pensioner");
  assert.ok(job, "the retired trade row exists");
  const errJob = w.addJob({
    id: crypto.randomUUID(),
    slug: "pensioner",
    label: "Duplicate Pensioner",
    workplace: SYS.home,
    startHour: 8,
    endHour: 18,
    palette: 0,
  });
  assert.match(errJob ?? "", /already in use/);
  // A fresh slug still passes, and the row lands in the overlay.
  const id = crypto.randomUUID();
  assert.equal(w.addJob({ id, slug: "dew-merchant", label: "Dew Merchant", workplace: SYS.home, startHour: 6, endHour: 12, palette: 0 }), null);
  assert.ok(w.defs.jobs[id] && w.defsOverlay.jobs.rows[id]);
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
    const dinerBuildings = w.buildings.filter((b) => b.kind === dinerId).map((b) => b.id);
    assert.ok(dinerBuildings.includes(n!.bb.workId ?? ""), "workplace still resolves by id (smart pick among matches)");
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

test("every soul is an adult and the roster + staff size holds", () => {
  const w = new World(1742);
  const kit = getKit(DEFAULT_KIT_ID);
  const rosterTotal = kit.roster.reduce((sum, r) => sum + r.count, 0);
  // Staff is derived from typed buildings: count * staff per instance.
  let staffTotal = 0;
  for (const entry of kit.buildings) {
    if (!entry.typeId) continue;
    const type = w.defs.businessTypes[entry.typeId];
    if (!type) continue;
    staffTotal += entry.count * type.staff.reduce((sum, s) => sum + s.countPerInstance, 0);
  }
  assert.equal(w.npcs.length, rosterTotal + staffTotal, `expected ${rosterTotal + staffTotal} residents (roster + staff)`);
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

test("runtime TS carries no catalog slug literals (spec §11; documented exceptions allowed)", () => {
  // Every row in every shipped collection, by slug. Goal slugs are excluded: they
  // double as engine verbs (BT action vocabulary the code owns — spec §7), so
  // quoting them is data-vocabulary use, not a reference to the goal row.
  // Clothing slots are excluded for the same reason: Scene spec §7.1 defines the
  // slot union as closed engine vocabulary, and garment slugs reuse slot names.
  const goalSlugs = new Set((JSON.parse(readFileSync(path.join(here, "../../content/catalog/goals.json"), "utf8")) as { slug: string }[]).map(
    (g) => g.slug,
  ));
  const CLOTHING_SLOTS = new Set([
    "feet",
    "socks",
    "legs",
    "underwear",
    "underwearTop",
    "undershirt",
    "shirt",
    "sweater",
    "jacket",
    "coat",
    "overcoat",
    "belt",
    "hat",
    "glasses",
    "hosiery",
  ]);
  const slugs: string[] = [];
  for (const dir of ["../../content/catalog", "../../content/kits"]) {
    for (const f of readdirSync(path.join(here, dir))) {
      if (!f.endsWith(".json")) continue;
      const rows = JSON.parse(readFileSync(path.join(here, dir, f), "utf8"));
      const list = Array.isArray(rows) ? rows : [rows];
      for (const r of list) {
        if (r?.slug && !goalSlugs.has(r.slug) && !CLOTHING_SLOTS.has(r.slug)) slugs.push(r.slug);
      }
    }
  }
  // Documented exceptions — words that name an engine concept and happen to equal
  // a catalog slug, not runtime references to the row:
  const allowed: Record<string, Set<string>> = {
    "sim/ai.ts": new Set([
      "wash", // hygiene verb in the BT action vocabulary (= wash-kiosk kind slug)
      "ask", // chronicle event type for ask-outcomes
      "feed", // action tag + chronicle event type (= feed-row slug)
      "kind", // social action tag (= kind-trait slug)
      "social", // engine verb for the social-action family (= social-need slug)
    ]),
    "lib/llm/prompts.ts": new Set(["social", "chat"]), // LLM example text showing the RoleplayDeltas shape
    "sim/world.ts": new Set(["social"]), // DefsOverlay collection key for the social-actions table (= social-need slug)
    "sim/custom.ts": new Set(["social"]), // DefsOverlay collection key for the social-actions table (= social-need slug)
    "components/game/CatalogForms.tsx": new Set(["social"]), // catalog collection key for the social-actions table (= social-need slug)
    "lib/server/library.ts": new Set(["social"]), // Library collection key for the social-actions table (= social-need slug)
  };
  const srcDir = path.join(here, "..");
  const tsFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...tsFiles(p));
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  for (const file of tsFiles(srcDir)) {
    const rel = path.relative(srcDir, file).split(path.sep).join("/");
    const src = readFileSync(file, "utf8");
    for (const slug of slugs) {
      if (!new RegExp("['\"]" + slug + "['\"]").test(src)) continue;
      assert.ok(allowed[rel]?.has(slug) ?? false, `${rel} references catalog slug "${slug}" by literal`);
    }
  }
});
