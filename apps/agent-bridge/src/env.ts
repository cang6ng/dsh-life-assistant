/**
 * Environment + DSH home resolution shared by the bridge.
 *
 * Dev: `$DSH_HOME` env or the repository-local `.dsh` (the same default the
 * CLI runtime uses; the repo `bootstrap` provisions it). Production: the
 * Rust host always sets DSH_HOME to the per-app data directory (contract
 * §42/§43) plus CHINOOK_BOOT_RESOURCES pointing at the packaged home
 * template, which `home.ts` copies on first run.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

export function resolveDshHome(): string {
  return resolve(envOr("DSH_HOME", join(REPO_ROOT, ".dsh")));
}

/** Boot-resources dir (packaged app only): contains `home-template/`. */
export function bootResourcesDir(): string | null {
  const dir = process.env.CHINOOK_BOOT_RESOURCES;
  return dir !== undefined && dir !== "" && existsSync(dir) ? resolve(dir) : null;
}
