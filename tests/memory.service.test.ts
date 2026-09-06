/**
 * MemoryService tests on an isolated temp MemoryStorage: cross-session
 * remember→recall semantics, per-customer isolation, LIKE escaping and
 * limit validation.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChinookError } from "../plugins/chinook/src/errors";
import { MemoryService } from "../plugins/chinook/src/services/memory";
import { MemoryStorage } from "../plugins/chinook/src/storage/memory";

describe("MemoryService", () => {
  let dir: string;
  let memory: MemoryService;
  const stores: MemoryStorage[] = [];

  const openStore = () => {
    // Windows keeps an open SQLite file locked, so every store must be
    // closed again before the temp directory is removed.
    const store = new MemoryStorage(join(dir, "memory.db"));
    stores.push(store);
    return store;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "chinook-memsvc-"));
    memory = new MemoryService(openStore());
  });

  afterAll(() => {
    for (const store of stores) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("remembers a fact and recalls it by keyword", () => {
    const saved = memory.save(1, "User prefers jazz music");
    expect(saved.id).toBeGreaterThan(0);
    expect(saved.text).toBe("User prefers jazz music");
    const hits = memory.search(1, "jazz", 5);
    expect(hits.some((m) => m.id === saved.id)).toBe(true);
  });

  it("recalls across 'sessions': a new service over the same store sees it", () => {
    // Simulates the DoD flow: remember in one agent session, recall in a
    // later one — persistence is in the store, not the service instance.
    const fresh = new MemoryService(openStore());
    const hits = fresh.search(1, "jazz", 5);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("returns most recent memories when no query is given", () => {
    memory.save(1, "first preference");
    const recent = memory.search(1, "", 3);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent[0]!.text).toBe("first preference");
  });

  it("isolates customers: no cross-customer reads or deletes", () => {
    const saved = memory.save(1, "secret of customer one");
    // Customer 2 cannot see it...
    expect(memory.search(2, "secret", 5)).toEqual([]);
    // ...and cannot delete it.
    try {
      memory.delete(2, saved.id);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ChinookError).code).toBe("NOT_FOUND");
    }
    // The owner still has it.
    expect(memory.search(1, "secret", 5).length).toBeGreaterThan(0);
    memory.delete(1, saved.id);
    expect(memory.search(1, "secret", 5)).toEqual([]);
  });

  it("treats LIKE wildcards in saved text literally", () => {
    const saved = memory.save(1, "loves 100% organic vinyl");
    // Unescaped, "%" would match every row; escaped it matches only literal percents.
    const wildcard = memory.search(1, "%", 5);
    for (const m of wildcard) expect(m.text).toContain("%");
    const plain = memory.search(1, "organic vinyl", 5);
    expect(plain.some((m) => m.id === saved.id)).toBe(true);
  });

  it("validates input", () => {
    expect(() => memory.save(1, "   ")).toThrowError(ChinookError);
    expect(() => memory.search(1, "", 0)).toThrowError(ChinookError);
    expect(() => memory.search(1, "", 51)).toThrowError(ChinookError);
    expect(() => memory.save(null as unknown as number, "x")).toThrowError(ChinookError);
    try {
      memory.save(null as unknown as number, "x");
    } catch (error) {
      expect((error as ChinookError).code).toBe("IDENTITY_REQUIRED");
    }
  });
});
