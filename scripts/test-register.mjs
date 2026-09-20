// Registered via `node --import` from the `test` script: installs the `@/`
// alias hooks before any test file loads, and keeps the PGLite file backend
// from booting (unit tests use in-memory fakes, never the database).
process.env.SIMULITY_NO_DB_BOOT ??= "1";
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
