/**
 * Bootstrap (spec §30): prepare the project so `pnpm chinook-agent` can boot.
 *
 *  - verifies the read-only Chinook business database (`data/chinook.db`);
 *  - creates the required directories (`data/`, the project-local DSH home);
 *  - mirrors the home data dir (`$DSH_HOME/data` -> `data/`), so the plugin's
 *    `$DSH_HOME/data/chinook.db` default resolves to the repository fixture;
 *  - initializes the agent memory database (`$DSH_HOME/data/memory.db`);
 *  - installs the `chinook` DSH profile into the project-local home
 *    (`$DSH_HOME/profiles/chinook` -> `profiles/chinook`).
 *
 * No initialization logic lives in DSH Core.
 */

import { existsSync, mkdirSync, symlinkSync, readlinkSync, lstatSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { MEMORY_SCHEMA } from "../plugins/chinook/src/storage/memory";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(REPO_ROOT, ".dsh"));
const CHINOOK_DB = join(REPO_ROOT, "data", "chinook.db");
const PROFILE_SOURCE = join(REPO_ROOT, "profiles", "chinook");
const PROFILE_INSTALL = join(DSH_HOME, "profiles", "chinook");
const HOME_DATA = join(DSH_HOME, "data");

function step(label: string, fn: () => void): void {
  process.stdout.write(`[bootstrap] ${label} ... `);
  fn();
  process.stdout.write("ok\n");
}

/** Repo-relative windows form used for link-target comparison. */
const normalized = (p: string) => resolve(p).replaceAll("/", "\\");

/** Creates a directory junction unless the target already exists there. */
function ensureJunction(target: string, link: string): void {
  mkdirSync(join(link, ".."), { recursive: true });
  if (existsSync(link)) {
    const stat = lstatSync(link);
    if (stat.isSymbolicLink()) {
      const current = readlinkSync(link);
      if (normalized(current) === normalized(target)) return; // up to date
      throw new Error(
        `Existing link at ${link} points to ${current}; remove it and re-run bootstrap.`,
      );
    }
    if (stat.isDirectory()) return; // a real directory exists — use it as is
    throw new Error(`Existing path at ${link} is neither a link nor a directory.`);
  }
  // Windows: junction links need no admin rights for directories.
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

function ensureChinookDb(): void {
  step(`checking Chinook DB (${CHINOOK_DB})`, () => {
    if (!existsSync(CHINOOK_DB)) {
      throw new Error(
        `Chinook database not found at ${CHINOOK_DB}. Place the standard Chinook SQLite file ` +
          `there (data/chinook.db) and re-run bootstrap.`,
      );
    }
    const db = new Database(CHINOOK_DB, { readonly: true });
    try {
      const { tracks } = db.prepare("SELECT COUNT(*) AS tracks FROM Track").get() as {
        tracks: number;
      };
      if (tracks !== 3503) {
        throw new Error(
          `Chinook database at ${CHINOOK_DB} looks wrong: expected 3503 tracks, found ${tracks}.`,
        );
      }
    } finally {
      db.close();
    }
  });
}

function ensureHomeData(): void {
  step(`mirroring home data (${HOME_DATA})`, () => {
    const dataDir = join(REPO_ROOT, "data");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(HOME_DATA, ".."), { recursive: true });
    if (!existsSync(HOME_DATA)) {
      symlinkSync(dataDir, HOME_DATA, process.platform === "win32" ? "junction" : "dir");
      return;
    }
    const stat = lstatSync(HOME_DATA);
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      if (stat.isSymbolicLink() && normalized(readlinkSync(HOME_DATA)) !== normalized(dataDir)) {
        throw new Error(
          `Existing home data link at ${HOME_DATA} points to ${readlinkSync(HOME_DATA)}; remove it and re-run bootstrap.`,
        );
      }
      // The junction (or a hand-made real directory) exists. A real directory
      // does not expose the repository fixture, so copy it in when missing.
      const mirrored = join(HOME_DATA, "chinook.db");
      if (!existsSync(mirrored)) {
        copyFileSync(CHINOOK_DB, mirrored);
        process.stdout.write(`(copied ${CHINOOK_DB} into home) `);
      }
      return;
    }
    throw new Error(`Existing path at ${HOME_DATA} is neither a link nor a directory.`);
  });
}

function ensureMemoryDb(): void {
  const dbPath = join(HOME_DATA, "memory.db");
  step(`initializing memory DB (${dbPath})`, () => {
    mkdirSync(resolve(dbPath, ".."), { recursive: true });
    const db = new Database(dbPath);
    try {
      db.exec(MEMORY_SCHEMA);
    } finally {
      db.close();
    }
  });
}

function ensureProfileInstalled(): void {
  step(`installing profile into DSH home (${DSH_HOME})`, () => {
    if (!existsSync(PROFILE_SOURCE)) {
      throw new Error(`Profile source missing at ${PROFILE_SOURCE}.`);
    }
    mkdirSync(join(DSH_HOME, "profiles"), { recursive: true });
    ensureJunction(PROFILE_SOURCE, PROFILE_INSTALL);
  });
}

export function bootstrap(): void {
  console.log(`[bootstrap] repo root : ${REPO_ROOT}`);
  console.log(`[bootstrap] DSH home   : ${DSH_HOME}`);
  ensureChinookDb();
  ensureHomeData();
  ensureMemoryDb();
  ensureProfileInstalled();
  console.log("[bootstrap] done. Start the agent with: pnpm chinook-agent");
  console.log(
    "[bootstrap] hint: set DEEPSEEK_API_KEY (or ANTHROPIC_AUTH_TOKEN for the DeepSeek-compatible endpoint).",
  );
}

// Run when invoked directly (`pnpm bootstrap` / `tsx scripts/bootstrap.ts`).
const argvMain = process.argv[1] !== undefined ? resolve(process.argv[1]).replaceAll("/", "\\") : "";
const selfMain = resolve(fileURLToPath(import.meta.url)).replaceAll("/", "\\");
const isMain = argvMain === selfMain || argvMain.endsWith("scripts\\bootstrap.ts");

if (isMain || process.env.CHINOOK_BOOTSTRAP === "1") {
  bootstrap();
}
