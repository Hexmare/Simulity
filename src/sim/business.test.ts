import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLibraryKit, validateLibraryRow, previewDefs } from "../lib/server/library.ts";
import { buildDefs } from "./defs.ts";
import { buildingsMatchingWorkplace, matchWorkplace } from "./custom.ts";
import { GOOD } from "./defs.ts";
import { getKit } from "./kits.ts";
import { DEFAULT_KIT_ID } from "./kits.ts";
import { World } from "./world.ts";

// Catalog spec §8 — business types, smart workplaces, new businesses, credits.

const kindIdBySlug = (w: World, slug: string): string | undefined =>
  Object.values(w.defs.buildingKinds).find((k) => k.slug === slug)?.id;
const typeIdBySlug = (w: World, slug: string): string | undefined =>
  Object.values(w.defs.businessTypes).find((t) => t.slug === slug)?.id;
const jobIdBySlug = (w: World, slug: string): string | undefined =>
  Object.values(w.defs.jobs).find((j) => j.slug === slug)?.id;

test("workplace is a matcher: sys, business type, building kind, tag", () => {
  const w = new World(1742);
  const barType = typeIdBySlug(w, "bar")!;
  const dinerKind = kindIdBySlug(w, "diner")!;
  assert.ok(barType && dinerKind, "bar type and diner kind exist");
  assert.equal(matchWorkplace(w.defs, "sys:home").kind, "sys");
  assert.equal(matchWorkplace(w.defs, barType).kind, "type");
  assert.equal(matchWorkplace(w.defs, dinerKind).kind, "buildingKind");
  assert.equal(matchWorkplace(w.defs, "home").kind, "tag");
  assert.equal(matchWorkplace(w.defs, "nope-not-real").kind, "invalid");
  // Bartender resolves to the Bar building, not a walk-up.
  const bar = w.buildings.find((b) => b.businessTypeId === barType)!;
  assert.ok(bar, "a Bar building stands");
  const hits = buildingsMatchingWorkplace(w.defs, w.buildings, barType);
  assert.ok(hits.length >= 1 && hits.every((b) => b.businessTypeId === barType), "type matcher names typed buildings");
  const homes = buildingsMatchingWorkplace(w.defs, w.buildings, "home");
  assert.ok(homes.length > 4 && homes.every((b) => (w.defs.buildingKinds[b.kind]?.tags ?? []).includes("home")), "home tag names residences");
});

test("two diners spawn diner-lead staff onto those buildings", () => {
  const w = new World(1742);
  const dinerType = typeIdBySlug(w, "diner")!;
  const diners = w.buildings.filter((b) => b.businessTypeId === dinerType);
  assert.equal(diners.length, 2, "two typed diners stand");
  const dinerIds = new Set(diners.map((b) => b.id));
  const leads = w.npcs.filter((n) => n.bb.jobId === jobIdBySlug(w, "diner-lead"));
  assert.equal(leads.length, 4, "2 buildings × 2 leads");
  for (const lead of leads) {
    assert.ok(dinerIds.has(lead.bb.workId ?? ""), `${lead.name} works at a diner building`);
  }
});

test("a bartender matcher fills the Bar; a housekeeper matcher fills a home", () => {
  const w = new World(1742);
  const barType = typeIdBySlug(w, "bar")!;
  const bartender = w.npcs.find((n) => n.bb.jobId === jobIdBySlug(w, "bartender"))!;
  assert.ok(bartender, "a bartender lives here");
  const work = w.building(bartender.bb.workId ?? "");
  assert.ok(work && work.businessTypeId === barType, "the bartender works at the Bar");
  const keeper = w.addVillager({ jobId: jobIdBySlug(w, "housekeeper") })!;
  const kWork = w.building(keeper.bb.workId ?? "");
  assert.ok(kWork && (w.defs.buildingKinds[kWork.kind]?.tags ?? []).includes("home"), "the housekeeper works at a home-tagged building");
  const waitress = w.addVillager({ jobId: jobIdBySlug(w, "waitress") })!;
  const wWork = w.building(waitress.bb.workId ?? "");
  assert.ok(wWork && wWork.businessTypeId === typeIdBySlug(w, "diner"), "the waitress works at the diner type");
});

test("new city generates with Bar, Tailor, Pawn, Bookshop, Clinic present and staffed", () => {
  const w = new World(1742);
  for (const slug of ["bar", "tailor", "pawn", "bookshop", "clinic"]) {
    const type = Object.values(w.defs.businessTypes).find((t) => t.slug === slug)!;
    assert.ok(type, `business type ${slug} ships`);
    const buildings = w.buildings.filter((b) => b.businessTypeId === type.id);
    assert.ok(buildings.length >= 1, `a ${type.label} stands`);
    for (const s of type.staff) {
      const job = w.defs.jobs[s.jobId];
      assert.ok(job, `staff job ${s.jobId} exists`);
      const crew = w.npcs.filter((n) => n.bb.jobId === s.jobId);
      assert.ok(
        crew.length >= buildings.length * s.countPerInstance,
        `${type.label} staffed with ${job.label} (${crew.length})`,
      );
      for (const c of crew) {
        assert.ok(buildings.some((b) => b.id === c.bb.workId), `${c.name} works at their ${type.label}`);
      }
    }
  }
});

test("money is credits, not coin; the city is Shadows Veil", () => {
  const w = new World(1742);
  assert.ok(GOOD.credits, "the credits commodity resolves");
  assert.equal(w.defs.commodities[GOOD.credits]?.label, "Credits", "commodity label is Credits");
  assert.equal(Object.values(w.defs.commodities).some((c) => c.slug === "coin"), false, "no coin slug remains");
  const kit = getKit(DEFAULT_KIT_ID);
  assert.equal(kit.slug, "shadows-veil", "kit slug is shadows-veil");
  assert.equal(kit.label, "Shadows Veil", "kit label is Shadows Veil");
  assert.equal(w.townName, "Shadows Veil", "fresh city takes the kit label");
  assert.equal(w.defs.setting.label, "Shadows Veil", "setting label is Shadows Veil");
  const wardSpell = Object.values(w.defs.spells).find((s) => s.school === "ward");
  assert.ok(wardSpell, "spell school ward is unchanged (magic, not the place)");
});

test("live overlay adds a job for this city only; shipped JSON untouched", () => {
  const w = new World(1742);
  const id = crypto.randomUUID();
  assert.equal(
    w.addJob({
      id,
      slug: "lamp-tender",
      label: "Lamp Tender",
      workplace: "home",
      startHour: 20,
      endHour: 4,
      palette: 3,
    }),
    null,
  );
  assert.ok(w.defs.jobs[id] && w.defsOverlay.jobs.rows[id], "the job lands in this city's overlay");
  assert.equal(w.removeJob(id), null, "the custom job removes cleanly");
  assert.equal(w.defs.jobs[id], undefined);
});
test("business type overlay rows round-trip; guards hold", () => {
  const w = new World(1742);
  const id = crypto.randomUUID();
  const shell = kindIdBySlug(w, "shopfront")!;
  assert.equal(
    w.addBusinessType({
      id,
      slug: "flower-shop",
      label: "Flower Shop",
      buildingKindId: shell,
      staff: [],
      tags: ["shop"],
    }),
    null,
  );
  assert.ok(w.defs.businessTypes[id], "the type is live in this city");
  assert.equal(w.removeBusinessType(id), null, "an unused type removes cleanly");
  const dinerType = typeIdBySlug(w, "diner")!;
  assert.ok(w.removeBusinessType(dinerType), "a staffed type refuses while buildings use it");
});

test("library: duplicate Human ancestry, rename, save, generate a city that can pick it", () => {
  const defs = buildDefs();
  const human = Object.values(defs.ancestries).find((a) => a.slug === "human")!;
  const id = crypto.randomUUID();
  const custom = { ...human, id, slug: "riverfolk", label: "Riverfolk", mundane: true };
  assert.equal(validateLibraryRow(defs, "ancestries", custom), null, "the renamed duplicate validates");
  const merged = previewDefs({ ancestries: [custom] });
  assert.ok(merged.ancestries[id], "the merged defs carry it");
  const w = new World(1742, undefined, { customCatalog: { ancestries: [custom] } });
  assert.ok(w.defs.ancestries[id], "a generated city knows the custom ancestry");
  assert.ok(w.defsOverlay.ancestries.rows[id], "the row persists on the town save");
  const soul = w.addVillager({ ancestryId: id });
  assert.ok(soul && soul.ancestryId === id, "a generated city can pick it");
});

test("library: custom kit validates, generates, and round-trips through JSON", () => {
  const defs = buildDefs();
  const kit = getKit(DEFAULT_KIT_ID);
  const custom = JSON.parse(JSON.stringify({ ...kit, id: crypto.randomUUID(), slug: "test-hollow", label: "Test Hollow" }));
  custom.roster = [{ jobId: kit.defaultPcJobId, count: 6, ages: [18, 58] }];
  // No typed shops here so staff is 0 and the 6 souls are all roster extras.
  custom.buildings = kit.buildings.filter((b: { kindId: string }) => kit.homes.includes(b.kindId)).map((b: { kindId: string; count: number }) => ({ kindId: b.kindId, count: b.count }));
  // Download/upload roundtrip: share as JSON, reimport, still valid.
  const revived = JSON.parse(JSON.stringify(custom));
  const check = validateLibraryKit(revived, defs);
  assert.deepEqual(check.errors, [], "the round-tripped kit validates");
  const w = new World(1742, undefined, { population: 6, kit: revived });
  assert.equal(w.kitId, revived.id, "the city generates from the custom kit");
  assert.equal(w.npcs.length, 6, "People=6 gives 6 total souls");
  const extras = w.npcs.filter((n) => n.bb.jobId === kit.defaultPcJobId);
  assert.ok(extras.length >= 6, "roster extras generate from the custom kit");
  // Minors rejected at the gate.
  const bad = JSON.parse(JSON.stringify(revived));
  bad.roster = [{ jobId: kit.defaultPcJobId, count: 2, ages: [12, 30] }];
  const badCheck = validateLibraryKit(bad, defs);
  assert.ok(badCheck.errors.some((e) => /18\+/.test(e)), "custom kit with ages < 18 is rejected");
});

test("library: invalid workplace and duplicate slugs are rejected", () => {
  const defs = buildDefs();
  const job = {
    id: crypto.randomUUID(),
    slug: "alley-sweeper",
    label: "Alley Sweeper",
    workplace: "nope-not-real",
    startHour: 8,
    endHour: 16,
  };
  assert.match(validateLibraryRow(defs, "jobs", job) ?? "", /Workplace/, "unknown workplaces fail validation");
  const dupe = { id: crypto.randomUUID(), slug: "human", label: "Copy Human", mundane: true };
  assert.match(validateLibraryRow(defs, "ancestries", dupe) ?? "", /already in use/, "duplicate slugs fail validation");
});
