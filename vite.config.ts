import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { isMigrationFile } from "./scripts/migration-plan.mjs";
// @ts-expect-error JS plugin alongside the TS vite config
import { simulityWsPlugin } from "./src/lib/ws-plugin.mjs";

/** The files `src/lib/db.ts` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root: string): boolean {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

/**
 * Pre-register TanStack Start server-function IDs before the dev server
 * accepts traffic. In dev the compiler populates its ID registry as a
 * side effect of transforming each server-fn module; the client can
 * otherwise invoke a function (e.g. an early autosave) before that
 * transform has finished, and the call fails with
 * "Invalid server function ID". Loading the modules here forces the
 * transforms (and registration) to complete first.
 */
function serverFnWarmupPlugin(): Plugin {
  return {
    name: "simulity:server-fn-warmup",
    apply: "serve",
    async configureServer(server) {
      for (const id of ["/src/lib/server/persistence.ts", "/src/lib/roleplay.ts", "/src/lib/server/session.ts"]) {
        try {
          await server.ssrLoadModule(id);
        } catch (err) {
          console.error(`[simulity] server-fn warmup failed for ${id}:`, err);
        }
      }
    },
  };
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Vite awaiting the hook puts this on time-to-first-render, so an app with no
 * migrations — no schema to apply — skips it entirely rather than paying for a
 * PGLite instance it never queries.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "simulity:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[simulity] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

// `0.0.0.0:8080` — don't change host/port (the dev-server contract).
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    pgliteBootstrapPlugin(),
    serverFnWarmupPlugin(),
    simulityWsPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview ? [nitro({ preset: "node" })] : []),
    viteReact(),
  ],
}));
