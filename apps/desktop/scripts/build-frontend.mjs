/**
 * Frontend production build for `tauri build` (tauri.conf beforeBuildCommand).
 *
 * The repo has no apps/desktop package.json, so before/after scripts cannot
 * rely on a local node_modules/.bin PATH. Vite is invoked through its JS API
 * with the root's dependency resolution instead.
 */

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(scriptDir, "..");
const repoRoot = resolve(scriptDir, "../../..");
const require = createRequire(join(repoRoot, "package.json"));
const { build } = require("vite");

await build({ configFile: join(desktop, "vite.config.ts") });
console.log("[frontend] vite build complete ->", join(desktop, "dist"));
