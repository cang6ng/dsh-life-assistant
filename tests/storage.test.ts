/**
 * Storage-layer tests: MemoryStorage CRUD/isolation on an isolated temp
 * database, and the read-only guard of ChinookStorage on the business DB.
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { ChinookError } from "../plugins/chinook/src/errors";
import { ChinookStorage, chinookDbPathFromEnv } from "../plugins/chinook/src/storage/chinook";
import { MemoryStorage } from "../plugins/chinook/src/storage/memory";

const CHINOOK_DB = resolve(import.meta.dirname, "../data/chinook.db");

describe("MemoryStorage", () => {
  let dir: string;
  let store: MemoryStorage;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "chinook-mem-"));
    store = new MemoryStorage(join(dir, "memory.db"));
  });

  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the schema and inserts rows with timestamps", () => {
    const row = store.insert(7, "likes brazilian jazz", "2026-01-01T00:00:00.000Z");
    expect(row.id).toBeGreaterThan(0);
    expect(row.customer_id).toBe(7);
    expect(row.text).toBe("likes brazilian jazz");
    expect(row.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("lists per customer, most recent first", () => {
    store.insert(7, "older note", "2026-01-02T00:00:00.000Z");
    store.insert(8, "other customer", "2026-01-03T00:00:00.000Z");
    store.insert(7, "newer note", "2026-01-04T00:00:00.000Z");
    const rows = store.listByCustomer(7, 10);
    expect(rows.map((r) => r.text)).toEqual(["newer note", "older note", "likes brazilian jazz"]);
  });

  it("keyword search is case-insensitive and scoped to the customer", () => {
    const hits = store.searchByCustomer(7, "%BRAZILIAN%", 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const hit of hits) expect(hit.customer_id).toBe(7);
  });

  it("deletes only rows owned by the customer", () => {
    const row = store.insert(8, "to delete", "2026-01-05T00:00:00.000Z");
    expect(store.deleteOwned(7, row.id)).toBe(false);
    expect(store.deleteOwned(8, row.id)).toBe(true);
    expect(store.deleteOwned(8, row.id)).toBe(false);
  });
});

describe("ChinookStorage", () => {
  it("opens the business database read-only", () => {
    expect(existsSync(CHINOOK_DB)).toBe(true);
    const store = new ChinookStorage(CHINOOK_DB);
    try {
      const row = store.get("SELECT COUNT(*) AS tracks FROM Track") as { tracks: number };
      expect(row.tracks).toBe(3503);
      // The default-path resolver points at the same repo-local database.
      expect(chinookDbPathFromEnv()).toBe(CHINOOK_DB);
    } finally {
      store.close();
    }
  });

  it("rejects writes (read-only open)", () => {
    const store = new ChinookStorage(CHINOOK_DB);
    try {
      expect(() => store.all("DELETE FROM Track")).toThrow();
    } finally {
      store.close();
    }
  });

  it("fails loudly on a missing database", () => {
    try {
      new ChinookStorage(join(CHINOOK_DB, "..", "does-not-exist.db"));
      throw new Error("expected open to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ChinookError);
      expect((error as ChinookError).code).toBe("DATABASE_ERROR");
    }
  });
});

describe("business database sanity (independent probe)", () => {
  it("has the fixture rows the agent tests rely on", () => {
    const db = new Database(CHINOOK_DB, { readonly: true });
    try {
      const c1 = db.prepare("SELECT COUNT(*) AS n FROM Invoice WHERE CustomerId = 1").get() as { n: number };
      expect(c1.n).toBe(7);
      const foreign = db.prepare("SELECT InvoiceId FROM Invoice WHERE CustomerId <> 1 LIMIT 1").get() as { InvoiceId: number };
      expect(foreign.InvoiceId).toBe(1);
      const jazz = db.prepare("SELECT COUNT(*) AS n FROM Genre WHERE Name = 'Jazz'").get() as { n: number };
      expect(jazz.n).toBe(1);
    } finally {
      db.close();
    }
  });
});
