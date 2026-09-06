/**
 * MemoryStorage: long-term per-customer memory in its own SQLite database
 * (`data/memory.db`), kept strictly separate from the Chinook business
 * database. The schema matches the V1 spec; the store is created and
 * migrated on first open.
 */

import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { memoryError } from "../errors.js";

export interface MemoryRow {
  id: number;
  customer_id: number;
  text: string;
  created_at: string;
  updated_at: string;
}

export const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_customer ON memories(customer_id);
`;

/**
 * Default memory database path: `$DSH_HOME/data/memory.db` when the DSH home
 * is set (every real launcher sets it before boot), because plugins mounted
 * through pnpm's virtual store cannot anchor on their own package. The
 * repository-relative anchor is the fallback for home-less direct mounts.
 */
export function defaultMemoryDbPath(): string {
  const home = process.env.DSH_HOME;
  if (home) return resolve(home, "data", "memory.db");
  return resolve(import.meta.dirname, "../../../../data/memory.db");
}

export function memoryDbPathFromEnv(): string {
  const fromEnv = process.env.CHINOOK_MEMORY_DB_PATH;
  return fromEnv ? resolve(fromEnv) : defaultMemoryDbPath();
}

export class MemoryStorage {
  private readonly db: Database.Database;

  constructor(path: string) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      this.db = new Database(path);
      this.db.pragma("journal_mode = WAL");
      this.db.exec(MEMORY_SCHEMA);
    } catch (error) {
      throw memoryError(`Failed to open memory database at ${path}: ${String(error)}`);
    }
  }

  /** All memories for a customer, most recent first. */
  listByCustomer(customerId: number, limit: number): MemoryRow[] {
    return this.db
      .prepare(
        "SELECT id, customer_id, text, created_at, updated_at FROM memories " +
          "WHERE customer_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?",
      )
      .all(customerId, limit) as MemoryRow[];
  }

  /** Case-insensitive keyword search over one customer's memories. */
  searchByCustomer(customerId: number, pattern: string, limit: number): MemoryRow[] {
    return this.db
      .prepare(
        "SELECT id, customer_id, text, created_at, updated_at FROM memories " +
          "WHERE customer_id = ? AND text LIKE ? ESCAPE '\\' " +
          "ORDER BY updated_at DESC, id DESC LIMIT ?",
      )
      .all(customerId, `%${pattern}%`, limit) as MemoryRow[];
  }

  insert(customerId: number, text: string, nowIso: string): MemoryRow {
    const info = this.db
      .prepare(
        "INSERT INTO memories (customer_id, text, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(customerId, text, nowIso, nowIso);
    return this.db
      .prepare("SELECT id, customer_id, text, created_at, updated_at FROM memories WHERE id = ?")
      .get(info.lastInsertRowid) as MemoryRow;
  }

  /** Delete one memory owned by the customer; returns true when a row was removed. */
  deleteOwned(customerId: number, memoryId: number): boolean {
    const info = this.db
      .prepare("DELETE FROM memories WHERE id = ? AND customer_id = ?")
      .run(memoryId, customerId);
    return info.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
