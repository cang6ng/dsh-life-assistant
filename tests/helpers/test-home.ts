/**
 * Test-only isolated DSH home (Targeted Test Isolation Cleanup).
 *
 * Stateful suites that boot the real DSH runtime (agent.e2e, bridge
 * integration) used to share the repository-local `.dsh`, so under Vitest
 * file-level parallelism one suite's session.create could land inside
 * another suite's listSessions() assertions — a false failure, not a runtime
 * bug. Each such suite now provisions its own throwaway home:
 *
 *   - `mkdtemp` under os.tmpdir → unique per suite, per run;
 *   - copies the read-only business fixture (`data/chinook.db` + the memory
 *     db) and junctions the `chinook` profile the same way `pnpm bootstrap`
 *     does (profile content includes dsh-managed module dirs that must not
 *     be copied; `rmSync` removes junctions as links and never follows them
 *     into the repository);
 *   - never reads or writes the repository `.dsh`.
 *
 * The runtime binds `$DSH_HOME` when `apps/cli/src/runtime` is imported
 * (module scope), so suites must set `process.env.DSH_HOME` BEFORE that
 * dynamic import. Vitest's default `forks` pool gives each test file its own
 * worker process, so a suite-local env assignment cannot leak across files.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

/** Provision a fresh, fully isolated DSH home; returns its absolute path. */
export function provisionTestHome(): string {
  const home = mkdtempSync(join(tmpdir(), "chinook-test-home-"));
  try {
    // Business fixture + memory db (read-only usage by the offline suites).
    const dataSrc = join(REPO_ROOT, "data");
    const dataDst = join(home, "data");
    mkdirSync(dataDst, { recursive: true });
    for (const name of ["chinook.db", "memory.db", "memory.db-shm", "memory.db-wal"]) {
      const src = join(dataSrc, name);
      if (existsSync(src)) copyFileSync(src, join(dataDst, name));
    }
    // The chinook profile — junctioned, exactly like `pnpm bootstrap` installs
    // it into the repo `.dsh`. Copying is NOT an option: the profile carries
    // dsh-managed module dirs (.dsh-module-fallback, node_modules) that the
    // boot heal refuses if they are plain directories. rmSync removes the
    // junction as a link and never follows it into the repository.
    const profileSrc = join(REPO_ROOT, "profiles", "chinook");
    if (!existsSync(profileSrc)) {
      throw new Error(`profile source missing at ${profileSrc} (run pnpm bootstrap)`);
    }
    mkdirSync(join(home, "profiles"), { recursive: true });
    symlinkSync(profileSrc, join(home, "profiles", "chinook"), process.platform === "win32" ? "junction" : "dir");
    // Node resolves the profile's plugin deps (chinook-dsh-plugin) by walking
    // up from the home path — a temp home never reaches repo/node_modules,
    // so mirror the repo layout with a node_modules junction (same for the
    // profile-junction spelling; the boot heal adds the closure under it).
    symlinkSync(join(REPO_ROOT, "node_modules"), join(home, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  } catch (err) {
    rmSync(home, { recursive: true, force: true });
    throw err;
  }
  return home;
}

/** Remove a home previously returned by provisionTestHome. */
export function cleanupTestHome(home: string | undefined): void {
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
}
