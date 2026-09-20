import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  deleteLibraryCatalogRow,
  deleteLibraryKit,
  ensureLibraryMigrated,
  libraryRoot,
  putLibraryCatalogRows,
  putLibraryKit,
  readLibraryCatalog,
  readLibraryKits,
} from "./library-store.ts";
import type { Kit } from "@/sim/types";

function kit(id: string, label: string): Kit {
  return {
    id,
    slug: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label,
    buildings: [],
    homes: [],
    roster: [],
    defaultPcJobId: "105cafac-71d5-4688-80da-602226a6e5e0",
    pcAge: 30,
    unnamedHomePattern: "{surname} House",
  };
}

async function tempRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "simulity-lib-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("kits round-trip as one JSON file per kit", async () => {
  const { root, cleanup } = await tempRoot();
  try {
    const a = kit(crypto.randomUUID(), "Alpha");
    const b = kit(crypto.randomUUID(), "Beta");
    await putLibraryKit(a, root);
    await putLibraryKit(b, root);
    // The file on disk is the kit JSON itself (what Download serves).
    const onDisk = JSON.parse(await readFile(path.join(root, "kits", `${a.id}.json`), "utf8")) as Kit;
    assert.equal(onDisk.label, "Alpha");
    let kits = await readLibraryKits(root);
    assert.equal(kits.length, 2);
    await putLibraryKit({ ...a, label: "Alpha Two" }, root);
    kits = await readLibraryKits(root);
    assert.equal(kits.find((k) => k.id === a.id)?.label, "Alpha Two");
    await deleteLibraryKit(a.id, root);
    kits = await readLibraryKits(root);
    assert.deepEqual(kits.map((k) => k.id), [b.id]);
    await deleteLibraryKit(a.id, root); // deleting twice is fine
  } finally {
    await cleanup();
  }
});

test("kit files refuse non-UUID names (no path traversal)", async () => {
  const { root, cleanup } = await tempRoot();
  try {
    await assert.rejects(putLibraryKit(kit("../evil", "Evil"), root));
    await assert.rejects(putLibraryKit(kit("not-a-uuid", "Evil"), root));
    await assert.rejects(deleteLibraryKit("../../etc/passwd", root));
    assert.deepEqual(await readLibraryKits(root), []);
  } finally {
    await cleanup();
  }
});

test("catalog rows upsert by id into one JSON file per collection", async () => {
  const { root, cleanup } = await tempRoot();
  try {
    const id = crypto.randomUUID();
    await putLibraryCatalogRows("ancestries", [{ id, slug: "riverfolk", label: "Riverfolk" }], root);
    await putLibraryCatalogRows(
      "ancestries",
      [
        { id, slug: "riverfolk", label: "Riverfolk Renamed" },
        { id: crypto.randomUUID(), slug: "hillfolk", label: "Hillfolk" },
      ],
      root,
    );
    const onDisk = JSON.parse(await readFile(path.join(root, "catalog", "ancestries.json"), "utf8")) as unknown[];
    assert.equal(onDisk.length, 2, "the collection file holds the merged rows (what Download serves)");
    let catalog = await readLibraryCatalog(root);
    assert.equal((catalog.ancestries ?? []).length, 2);
    assert.equal(((catalog.ancestries?.[0] ?? {}) as { label?: string }).label, "Riverfolk Renamed");
    await deleteLibraryCatalogRow("ancestries", id, root);
    catalog = await readLibraryCatalog(root);
    assert.equal((catalog.ancestries ?? []).length, 1);
  } finally {
    await cleanup();
  }
});

test("names and setting saves replace the whole doc list", async () => {
  const { root, cleanup } = await tempRoot();
  try {
    await putLibraryCatalogRows("names", [{ firstF: ["Ada"], firstM: [], surnames: ["Ash"] }], root);
    await putLibraryCatalogRows("names", [{ firstF: ["Bo"], firstM: [], surnames: [] }], root);
    const catalog = await readLibraryCatalog(root);
    assert.equal((catalog.names ?? []).length, 1);
    assert.deepEqual(((catalog.names?.[0] ?? {}) as { firstF?: string[] }).firstF, ["Bo"]);
  } finally {
    await cleanup();
  }
});

test("unknown collections are rejected; corrupt files are tolerated", async () => {
  const { root, cleanup } = await tempRoot();
  try {
    await assert.rejects(putLibraryCatalogRows("../../../etc", [], root));
    await assert.rejects(deleteLibraryCatalogRow("nope", "x", root));
    // A hand-corrupted file must not brick the whole library read.
    await mkdir(path.join(root, "catalog"), { recursive: true });
    await writeFile(path.join(root, "catalog", "jobs.json"), "{not json", "utf8");
    const catalog = await readLibraryCatalog(root);
    assert.equal(catalog.jobs, undefined);
    assert.deepEqual(await readLibraryKits(root), []);
  } finally {
    await cleanup();
  }
});

test("SIMULITY_LIBRARY_DIR overrides the default root", async () => {
  const { root, cleanup } = await tempRoot();
  const prev = process.env.SIMULITY_LIBRARY_DIR;
  process.env.SIMULITY_LIBRARY_DIR = root;
  try {
    assert.equal(libraryRoot(), root);
    await putLibraryKit(kit(crypto.randomUUID(), "Env"), root);
    assert.equal((await readLibraryKits()).length, 1);
  } finally {
    if (prev === undefined) delete process.env.SIMULITY_LIBRARY_DIR;
    else process.env.SIMULITY_LIBRARY_DIR = prev;
    await cleanup();
  }
  assert.equal(libraryRoot(), "./data/library");
});

test("kv migration is skipped in unit tests and never needs the database", async () => {
  const { root, cleanup } = await tempRoot();
  try {
    assert.equal(process.env.SIMULITY_NO_DB_BOOT, "1");
    await ensureLibraryMigrated(root); // must not throw, must not touch the DB
    assert.deepEqual(await readLibraryKits(root), []);
    assert.deepEqual(await readLibraryCatalog(root), {});
  } finally {
    await cleanup();
  }
});
