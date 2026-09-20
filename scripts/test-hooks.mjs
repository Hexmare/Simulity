// Node test-runner hooks: resolve the `@/` Vite alias to `./src/` and probe
// extensionless relative imports (the codebase is TS-first: `from "./x"`
// means `./x.ts`). Test-only; the app itself resolves these through Vite/TS.
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const here = new URL(import.meta.url);
const pathname = here.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const root = path.resolve(path.dirname(pathname), "..");

const EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs", ".json"];

function probe(base) {
  if (existsSync(base)) {
    try {
      if (!statSync(base).isDirectory()) return base;
    } catch {
      return base;
    }
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier === "@" || specifier.startsWith("@/")) {
    const rel = specifier === "@" ? "" : specifier.slice(2);
    const file = probe(path.join(root, "src", rel)) ?? path.join(root, "src", rel);
    return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    try {
      const parentPath = fileURLToPath(context.parentURL);
      const base = path.resolve(path.dirname(parentPath), specifier);
      const file = probe(base);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    } catch {
      /* fall through to default resolution */
    }
  }
  return next(specifier, context);
}
