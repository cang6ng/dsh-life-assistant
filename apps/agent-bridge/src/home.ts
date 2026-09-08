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

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { bootResourcesDir, resolveDshHome } from "./env.js";

export const PROVISION_MARKER = ".desktop-provisioned";
export const TEMPLATE_DIRNAME = "home-template";

export function homeTemplateDir(): string | null {
  const base = bootResourcesDir();
  return base === null ? null : resolve(base, TEMPLATE_DIRNAME);
}

/**
 * Make the profile's selected bundles reachable from the home. The dsh boot
 * heal (`healProfilesModuleFallback`) mirrors only the `@deepseek-ai/dsh`
 * installation closure into `<home>/profiles/node_modules`; a profile-owned
 * bundle such as chinook-dsh-plugin is mounted by cordis with the profile
 * directory as import parent, which in dev resolves upward through the repo
 * `node_modules` — an ancestor a packaged home under %APPDATA% does not
 * have. Junction each bundle's package from the boot-resources node_modules
 * into the shared fallback dir so ESM resolution from the profile reaches
 * it. Junctions need no admin rights and always point at the current
 * runtime copy (an app update must not leave a stale package behind).
 * Idempotent; runs every launch, harmless next to the heal (which only
 * manages its own entry list).
 */
export function linkProfileBundleFallbacks(): void {
  const base = bootResourcesDir();
  const home = resolveDshHome();
  if (base === null) return; // dev — the repo node_modules is the ancestor
  const fallbackDir = join(home, "profiles", "node_modules");
  const runtimeModules = join(base, "node_modules");
  const profileDir = join(home, "profiles", "chinook");
  if (!existsSync(profileDir) || !existsSync(runtimeModules)) return; // provisioning incomplete / heal-less home
  let bundles: string[];
  try {
    bundles = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8")).dsh?.profile?.bundles ?? [];
  } catch {
    return; // the boot heal reports a broken profile manifest
  }
  if (bundles.length === 0) return;
  mkdirSync(fallbackDir, { recursive: true });
  for (const name of bundles) {
    const link = join(fallbackDir, ...name.split("/"));
    if (existsSync(link)) continue; // heal already covers it
    const source = join(runtimeModules, ...name.split("/"));
    if (!existsSync(source)) continue; // unknown bundle — the loader reports it
    try {
      // Scoped names need their @scope/ parent inside the fallback dir.
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(source, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      // stderr only — diagnostics never enter the stdout protocol (§10).
      process.stderr.write(`[bridge] profile bundle fallback link failed for ${name}: ${String(error)}\n`);
    }
  }
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

/**
 * Ensure profile-bundle fallbacks on every launch (not only the first):
 * junctions survive the heal, but a repaired or updated home may lack them.
 */
export function ensureProvisionedHome(): void {
  if (homeTemplateDir() === null) return; // dev
  linkProfileBundleFallbacks();
}
