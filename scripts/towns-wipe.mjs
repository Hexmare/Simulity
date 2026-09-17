// Wipes the server-side PGLite town store (./data/pglite). The ward-era save format
// (v7) has no migration path: pre-ward towns are hard-rejected on load, so shipped
// content changes ship with a clean town store.
import { rm } from "node:fs/promises";

const dir = new URL("../data/pglite/", import.meta.url);
await rm(dir, { recursive: true, force: true });
console.log(`Wiped ${dir.pathname}`);
