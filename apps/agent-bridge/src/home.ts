/**
 * Packaged-app home provisioning.
 *
 * The V1 dev flow provisions `$DSH_HOME` via `scripts/bootstrap.ts`
 * (junction to `data/`, junction to `profiles/chinook`, memory.db schema).
 * A packaged app has no repository to junction, so the build stamps a
 * `home-template/` image inside the boot resources; on first launch the
 * bridge copies that tree (real files — no junctions) into the writable
 * DSH_HOME the Rust host prepared. A marker file makes the copy idempotent
 * and crash-safe (partial copy is repaired by re-copying).
 *
 * Development (no CHINOOK_BOOT_RESOURCES) is a no-op: the repo bootstrap
 * already provisioned `.dsh`.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootResourcesDir, resolveDshHome } from "./env.js";

export const PROVISION_MARKER = ".desktop-provisioned";
export const TEMPLATE_DIRNAME = "home-template";

export function homeTemplateDir(): string | null {
  const base = bootResourcesDir();
  return base === null ? null : resolve(base, TEMPLATE_DIRNAME);
}

/** Copy the template image into DSH_HOME when it was never provisioned. */
export function provisionHomeIfNeeded(): void {
  const template = homeTemplateDir();
  const home = resolveDshHome();
  if (template === null) return; // dev — repo bootstrap owns the home
  const marker = join(home, PROVISION_MARKER);
  if (existsSync(marker)) return;

  // Copy every top-level entry of the template (profiles/, data/, …).
  mkdirSync(home, { recursive: true });
  for (const entry of readdirSync(template)) {
    cpSync(join(template, entry), join(home, entry), {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }
  writeFileSync(marker, new Date().toISOString(), "utf8");
}
