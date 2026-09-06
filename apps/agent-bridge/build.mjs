/**
 * Bridge bundle: one self-contained ESM entry at apps/agent-bridge/dist/bridge.mjs.
 *
 * All `@deepseek-ai/*`, `better-sqlite3` and node builtins stay external and
 * resolve from the shipped node_modules at runtime (dev: the repo store;
 * packaged: the `runtime/` resource tree). Only bridge + cli runtime source
 * is inlined, so the agent layer is never duplicated.
 */

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const outdir = resolve(import.meta.dirname, "dist");

mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [resolve(import.meta.dirname, "src/main.ts")],
  outfile: resolve(outdir, "bridge.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  external: ["@deepseek-ai/*", "better-sqlite3"],
  banner: {
    // esbuild bundles ESM imports of CommonJS deps with a runtime interop
    // shim that assumes __dirname/require exist when a single entry does not
    // declare them; node builtins are the only CJS-free path here.
    js: "/* chinook agent bridge bundle */",
  },
  logLevel: "info",
  absWorkingDir: root,
});

console.log("[build:bridge] dist/bridge.mjs written");
