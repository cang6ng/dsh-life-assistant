/**
 * ChinookStorage: read-only access to the business database
 * (`data/chinook.db`). Storage is the only layer that touches SQLite;
 * services express business rules on top of it and tools never run SQL.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { databaseError } from "../errors.js";

export type Row = Record<string, unknown>;
export type SqlValue = string | number | bigint | null | Uint8Array | Buffer;

/**
 * Default Chinook database path.
 *
 * The DSH loader resolves the plugin package through pnpm's virtual store
 * (`node_modules/.pnpm/...`), so a package-relative anchor points nowhere
 * at runtime. The DSH home is set before boot by every real launcher, so
 * `$DSH_HOME/data/chinook.db` is the canonical location (bootstrap mirrors
 * the repository fixture into it). The repository-relative anchor remains
 * as a fallback for home-less direct mounts (dev scripts, tests).
 */
export function defaultChinookDbPath(): string {
  const home = process.env.DSH_HOME;
  if (home) return resolve(home, "data", "chinook.db");
  return resolve(import.meta.dirname, "../../../../data/chinook.db");
}

export function chinookDbPathFromEnv(): string {
  const fromEnv = process.env.CHINOOK_DB_PATH;
  return fromEnv ? resolve(fromEnv) : defaultChinookDbPath();
}

export class ChinookStorage {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (!existsSync(path)) {
      throw databaseError(
        `Chinook database not found at ${path}. Run \`pnpm bootstrap\` first (or set CHINOOK_DB_PATH).`,
      );
    }
    try {
      this.db = new Database(path, { readonly: true });
      // The business database is never written by the agent; a busy lock on a
      // frozen file must not fail queries.
      this.db.pragma("busy_timeout = 3000");
    } catch (error) {
      throw databaseError(`Failed to open Chinook database at ${path}: ${String(error)}`);
    }
  }

  prepared(sql: string): Database.Statement {
    try {
      return this.db.prepare(sql);
    } catch (error) {
      throw databaseError(`Invalid SQL: ${String(error)}`);
    }
  }

  all(sql: string, params: SqlValue[] = []): Row[] {
    try {
      return this.prepared(sql).all(...params) as Row[];
    } catch (error) {
      throw databaseError(`Query failed: ${String(error)}`);
    }
  }

  get(sql: string, params: SqlValue[] = []): Row | undefined {
    try {
      return this.prepared(sql).get(...params) as Row | undefined;
    } catch (error) {
      throw databaseError(`Query failed: ${String(error)}`);
    }
  }

  close(): void {
    this.db.close();
  }
}
