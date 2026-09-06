/**
 * CatalogService tests against the real (read-only) Chinook database.
 * Fixtures are grounded in the standard dataset: 3503 tracks, artist
 * "Queen", genre "Jazz", album "Achtung Baby".
 */

import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ChinookError } from "../plugins/chinook/src/errors";
import { CatalogService, escapeLike } from "../plugins/chinook/src/services/catalog";
import { ChinookStorage } from "../plugins/chinook/src/storage/chinook";

const CHINOOK_DB = resolve(import.meta.dirname, "../data/chinook.db");

describe("escapeLike", () => {
  it("escapes SQLite LIKE metacharacters", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("CatalogService.searchCatalog", () => {
  let catalog: CatalogService;

  beforeAll(() => {
    catalog = new CatalogService(new ChinookStorage(CHINOOK_DB));
  });

  it("finds Queen artists, albums and tracks case-insensitively", () => {
    const items = catalog.searchCatalog("queen", "all", 20);
    expect(items.length).toBeGreaterThan(0);
    const types = new Set(items.map((i) => i.type));
    expect([...types].every((t) => ["track", "album", "artist", "genre"].includes(t))).toBe(true);
    const artist = items.find((i) => i.type === "artist" && i.name === "Queen");
    expect(artist).toBeTruthy();
    // Every returned entity must actually mention Queen (name, artist or album).
    for (const item of items) {
      const haystack = `${item.name} ${item.artist ?? ""} ${item.album ?? ""} ${item.genre ?? ""}`.toLowerCase();
      expect(haystack).toContain("queen");
    }
  });

  it("respects entity_type filters", () => {
    const artists = catalog.searchCatalog("love", "artist", 10);
    for (const item of artists) expect(item.type).toBe("artist");
    const tracks = catalog.searchCatalog("love", "track", 10);
    for (const item of tracks) expect(item.type).toBe("track");
  });

  it("bounds results by limit", () => {
    const one = catalog.searchCatalog("a", "all", 1);
    expect(one.length).toBeLessThanOrEqual(1);
  });

  it("rejects empty queries and out-of-range limits", () => {
    expect(() => catalog.searchCatalog("   ", "all", 10)).toThrowError(ChinookError);
    expect(() => catalog.searchCatalog("jazz", "all", 0)).toThrowError(ChinookError);
    expect(() => catalog.searchCatalog("jazz", "all", 51)).toThrowError(ChinookError);
    try {
      catalog.searchCatalog("", "all", 10);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ChinookError).code).toBe("INVALID_ARGUMENT");
    }
  });

  it("treats LIKE wildcards as literal user text", () => {
    // "%" would match everything unescaped; with escaping only literal
    // percents match, so this must stay empty-or-literal, never everything.
    const hits = catalog.searchCatalog("100%", "track", 10);
    for (const hit of hits) expect(hit.name.toLowerCase()).toContain("100%");
  });
});

describe("CatalogService.findSimilarAlbums", () => {
  let catalog: CatalogService;

  beforeAll(() => {
    catalog = new CatalogService(new ChinookStorage(CHINOOK_DB));
  });

  it("ranks genre-sharing albums by matched track count", () => {
    const similar = catalog.findSimilarAlbums("Achtung Baby", 10);
    expect(similar.length).toBeGreaterThan(0);
    for (const entry of similar) {
      expect(entry.album).not.toBe("Achtung Baby"); // source album excluded
      expect(entry.artist.length).toBeGreaterThan(0);
      expect(entry.genreMatchTracks).toBeGreaterThan(0);
    }
    for (let i = 1; i < similar.length; i++) {
      expect(similar[i - 1]!.genreMatchTracks).toBeGreaterThanOrEqual(similar[i]!.genreMatchTracks);
    }
  });

  it("returns an empty list for an unknown album", () => {
    expect(catalog.findSimilarAlbums("No Such Album Anywhere 987654", 5)).toEqual([]);
  });

  it("matches by partial title and rejects bad limits", () => {
    const partial = catalog.findSimilarAlbums("Achtung", 5);
    expect(partial.length).toBeGreaterThan(0);
    expect(() => catalog.findSimilarAlbums("Achtung Baby", 0)).toThrowError(ChinookError);
  });
});

describe("CatalogService.popularInGenre", () => {
  let catalog: CatalogService;

  beforeAll(() => {
    catalog = new CatalogService(new ChinookStorage(CHINOOK_DB));
  });

  it("returns best-selling Jazz tracks ordered by times sold, then name", () => {
    const tracks = catalog.popularInGenre("Jazz", 3);
    expect(tracks.length).toBe(3);
    // Grounded in the dataset: the top Jazz sellers all sold twice and are
    // ordered alphabetically.
    expect(tracks[0]!.timesSold).toBeGreaterThanOrEqual(tracks[1]!.timesSold);
    expect(tracks.map((t) => t.track)).toEqual([
      "Blue Rythm Fantasy",
      "Don't Take Your Love From Me",
      "Drum Boogie",
    ]);
    for (const t of tracks) expect(t.album.length).toBeGreaterThan(0);
  });

  it("requires the exact genre name (no fuzzy match)", () => {
    expect(catalog.popularInGenre("jazz", 10)).toEqual([]);
    expect(catalog.popularInGenre("NoSuchGenre", 10)).toEqual([]);
  });
});
