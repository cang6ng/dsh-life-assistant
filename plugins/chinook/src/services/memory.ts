/**
 * MemoryService: long-term per-customer memory.
 *
 * Every method is scoped by the caller-supplied (program-trusted) customer
 * id, so customers can never read or delete each other's memories. Search
 * is plain LIKE keyword matching today (spec §18); the API is the seam where
 * a future embedding-based backend could be plugged in without touching the
 * tools. Original project behavior: an empty query returns the most recent
 * memories; the stored text is the memory itself.
 */

import type { MemoryRow, MemoryStorage } from "../storage/memory.js";
import { invalidArgument, memoryError, notFound } from "../errors.js";
import { escapeLike } from "./catalog.js";
import { requireCustomer } from "./orders.js";

export const MAX_MEMORY_LIMIT = 50;

export interface SavedMemory {
  id: number;
  text: string;
  createdAt: string;
  updatedAt: string;
}

function assertSearchLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MEMORY_LIMIT) {
    throw invalidArgument(`limit must be an integer between 1 and ${MAX_MEMORY_LIMIT}.`);
  }
}

function assertFact(fact: string): string {
  const text = fact.trim();
  if (!text) throw invalidArgument("fact must not be empty.");
  return text;
}

export class MemoryService {
  constructor(private readonly storage: MemoryStorage) {}

  /** Save a durable fact about the current customer. */
  save(customerId: number, fact: string): SavedMemory {
    requireCustomer(customerId);
    const text = assertFact(fact);
    const now = new Date().toISOString();
    let row: MemoryRow;
    try {
      row = this.storage.insert(customerId, text, now);
    } catch (error) {
      throw memoryError(`Failed to save memory: ${String(error)}`);
    }
    return toSavedMemory(row);
  }

  /**
   * Search the current customer's memories by keyword (case-insensitive,
   * wildcard-escaped). An empty query returns the most recent memories.
   */
  search(customerId: number, query: string, limit = 3): SavedMemory[] {
    requireCustomer(customerId);
    assertSearchLimit(limit);
    const keyword = query.trim();
    let rows: MemoryRow[];
    try {
      rows = keyword
        ? this.storage.searchByCustomer(customerId, escapeLike(keyword), limit)
        : this.storage.listByCustomer(customerId, limit);
    } catch (error) {
      throw memoryError(`Failed to search memory: ${String(error)}`);
    }
    return rows.map(toSavedMemory);
  }

  /** Delete one of the current customer's memories; NOT_FOUND if absent or foreign. */
  delete(customerId: number, memoryId: number): void {
    requireCustomer(customerId);
    let owned: boolean;
    try {
      owned = this.storage.deleteOwned(customerId, memoryId);
    } catch (error) {
      throw memoryError(`Failed to delete memory: ${String(error)}`);
    }
    if (!owned) {
      // Scoped DELETE removes only the customer's own rows, so a foreign id
      // is indistinguishable from a missing one — and that is intentional.
      throw notFound(`No memory found with id ${memoryId} for this customer.`);
    }
  }
}

function toSavedMemory(row: MemoryRow): SavedMemory {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
