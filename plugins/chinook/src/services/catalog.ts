/**
 * CatalogService: music-discovery queries against the read-only Chinook DB.
 *
 * Business semantics are carried over from the original project's `tools.py`
 * and must not be changed casually:
 *
 *  - `escapeLike` escapes `\`, `%` and `_` for SQLite `LIKE ... ESCAPE '\'`;
 *  - `findSimilarAlbums` matches the source album by title (partial, escaped),
 *    derives its distinct genres and ranks other albums by how many of their
 *    tracks share those genres (original CTE pattern);
 *  - `popularInGenre` counts `InvoiceLine` rows per track within a genre,
 *    ordered by times sold then track name;
 *  - result limits are validated to 1..50 (the original `Limit` bound).
 *
 * `searchCatalog` is the V1 addition (spec §9): a case-insensitive partial
 * search over tracks / albums / artists / genres with a unified item shape.
 */

import type { ChinookStorage, Row } from "../storage/chinook.js";
import { invalidArgument } from "../errors.js";

export const MAX_CATALOG_LIMIT = 50;

export type CatalogEntityType = "track" | "album" | "artist" | "genre" | "all";

export interface CatalogSearchItem {
  type: Exclude<CatalogEntityType, "all">;
  id: number;
  name: string;
  artist?: string;
  album?: string;
  genre?: string;
}

export interface SimilarAlbum {
  album: string;
  artist: string;
  genreMatchTracks: number;
}

export interface PopularTrack {
  track: string;
  artist: string;
  album: string;
  timesSold: number;
}

/** Escape SQLite LIKE metacharacters in user-controlled input. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Shared bound: the original project rejected values outside 1..50. */
export function assertCatalogLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CATALOG_LIMIT) {
    throw invalidArgument(
      `limit must be an integer between 1 and ${MAX_CATALOG_LIMIT} (got ${String(limit)}).`,
    );
  }
}

function asText(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** Relevance: 0 = exact (case-insensitive) match, 1 = prefix, 2 = contains. */
const RELEVANCE = `
CASE
  WHEN lower(name) = lower(?) THEN 0
  WHEN lower(name) LIKE lower(?) || '%' THEN 1
  ELSE 2
END`;

export class CatalogService {
  constructor(private readonly storage: ChinookStorage) {}

  // ------------------------------------------------------------------
  // search_catalog
  // ------------------------------------------------------------------

  /**
   * Case-insensitive partial search over catalog entities. `entityType`
   * selects the searched namespace; `all` interleaves the per-entity
   * matches (stable round-robin) and slices to `limit`.
   */
  searchCatalog(query: string, entityType: CatalogEntityType = "all", limit = 10): CatalogSearchItem[] {
    const needle = query.trim();
    if (!needle) throw invalidArgument("query must not be empty.");
    assertCatalogLimit(limit);
    const escaped = escapeLike(needle);

    const groups: CatalogSearchItem[][] = [];
    if (entityType === "all" || entityType === "track") {
      groups.push(this.searchTracks(escaped, needle, limit));
    }
    if (entityType === "all" || entityType === "album") {
      groups.push(this.searchAlbums(escaped, needle, limit));
    }
    if (entityType === "all" || entityType === "artist") {
      groups.push(this.searchArtists(escaped, needle, limit));
    }
    if (entityType === "all" || entityType === "genre") {
      groups.push(this.searchGenres(escaped, needle, limit));
    }
    return this.interleave(groups).slice(0, limit);
  }

  private interleave(groups: CatalogSearchItem[][]): CatalogSearchItem[] {
    const out: CatalogSearchItem[] = [];
    const cursor = groups.map(() => 0);
    let remaining = groups.reduce((sum, g) => sum + g.length, 0);
    while (remaining > 0) {
      for (let g = 0; g < groups.length; g++) {
        if (cursor[g] < groups[g].length) out.push(groups[g][cursor[g]++]);
      }
      remaining = groups.reduce((sum, grp, i) => sum + (grp.length - cursor[i]), 0);
    }
    return out;
  }

  private searchTracks(escaped: string, needle: string, limit: number): CatalogSearchItem[] {
    const like = `%${escaped}%`;
    const rows = this.storage.all(
      `SELECT t.TrackId, t.Name AS Name, ar.Name AS Artist, a.Title AS Album, g.Name AS Genre
       FROM Track t
       JOIN Album  a  ON a.AlbumId  = t.AlbumId
       JOIN Artist ar ON ar.ArtistId = a.ArtistId
       JOIN Genre  g  ON g.GenreId   = t.GenreId
       WHERE t.Name LIKE ? ESCAPE '\\' OR ar.Name LIKE ? ESCAPE '\\'
             OR a.Title LIKE ? ESCAPE '\\'
       ORDER BY
         CASE
           WHEN lower(t.Name) = lower(?) OR lower(ar.Name) = lower(?) OR lower(a.Title) = lower(?)
             THEN 0
           WHEN lower(t.Name) LIKE lower(?) || '%' OR lower(ar.Name) LIKE lower(?) || '%'
             OR lower(a.Title) LIKE lower(?) || '%' THEN 1
           ELSE 2
         END,
         t.Name
       LIMIT ?`,
      [like, like, like, needle, needle, needle, escaped, escaped, escaped, limit],
    );
    return rows.map((r: Row) => ({
      type: "track" as const,
      id: asNumber(r.TrackId),
      name: asText(r.Name),
      artist: asText(r.Artist),
      album: asText(r.Album),
      genre: asText(r.Genre),
    }));
  }

  private searchAlbums(escaped: string, needle: string, limit: number): CatalogSearchItem[] {
    const like = `%${escaped}%`;
    const rows = this.storage.all(
      `SELECT a.AlbumId, a.Title AS Title, ar.Name AS Artist
       FROM Album a
       JOIN Artist ar ON ar.ArtistId = a.ArtistId
       WHERE a.Title LIKE ? ESCAPE '\\' OR ar.Name LIKE ? ESCAPE '\\'
       ORDER BY
         CASE
           WHEN lower(a.Title) = lower(?) OR lower(ar.Name) = lower(?) THEN 0
           WHEN lower(a.Title) LIKE lower(?) || '%' OR lower(ar.Name) LIKE lower(?) || '%' THEN 1
           ELSE 2
         END,
         a.Title
       LIMIT ?`,
      [like, like, needle, needle, escaped, escaped, limit],
    );
    return rows.map((r: Row) => ({
      type: "album" as const,
      id: asNumber(r.AlbumId),
      name: asText(r.Title),
      artist: asText(r.Artist),
    }));
  }

  private searchArtists(escaped: string, needle: string, limit: number): CatalogSearchItem[] {
    const like = `%${escaped}%`;
    const rows = this.storage.all(
      `SELECT ArtistId, Name
       FROM Artist
       WHERE Name LIKE ? ESCAPE '\\'
       ORDER BY ${RELEVANCE}, Name
       LIMIT ?`,
      [like, needle, escaped, limit],
    );
    return rows.map((r: Row) => ({
      type: "artist" as const,
      id: asNumber(r.ArtistId),
      name: asText(r.Name),
    }));
  }

  private searchGenres(escaped: string, needle: string, limit: number): CatalogSearchItem[] {
    const like = `%${escaped}%`;
    const rows = this.storage.all(
      `SELECT GenreId, Name
       FROM Genre
       WHERE Name LIKE ? ESCAPE '\\'
       ORDER BY ${RELEVANCE}, Name
       LIMIT ?`,
      [like, needle, escaped, limit],
    );
    return rows.map((r: Row) => ({
      type: "genre" as const,
      id: asNumber(r.GenreId),
      name: asText(r.Name),
    }));
  }

  // ------------------------------------------------------------------
  // find_similar_albums
  // ------------------------------------------------------------------

  /**
   * Original project semantics: match the source album by (partial,
   * escaped) title, collect the distinct genres of its tracks, then rank
   * other albums by how many tracks share those genres.
   */
  findSimilarAlbums(albumName: string, limit = 5): SimilarAlbum[] {
    const needle = albumName.trim();
    if (!needle) throw invalidArgument("album_name must not be empty.");
    assertCatalogLimit(limit);

    const rows = this.storage.all(
      `WITH source_album AS (
         SELECT AlbumId
         FROM Album
         WHERE Title LIKE ? ESCAPE '\\'
         ORDER BY Title
         LIMIT 1
       ),
       source_genres AS (
         SELECT DISTINCT t.GenreId
         FROM Track t
         JOIN source_album sa ON t.AlbumId = sa.AlbumId
       )
       SELECT a.Title AS Album, ar.Name AS Artist, COUNT(*) AS GenreMatchTracks
       FROM Track t
       JOIN Album  a  ON a.AlbumId  = t.AlbumId
       JOIN Artist ar ON ar.ArtistId = a.ArtistId
       WHERE t.GenreId IN (SELECT GenreId FROM source_genres)
         AND a.AlbumId NOT IN (SELECT AlbumId FROM source_album)
       GROUP BY a.AlbumId
       ORDER BY GenreMatchTracks DESC, a.Title
       LIMIT ?`,
      [`%${escapeLike(needle)}%`, limit],
    );
    return rows.map((r: Row) => ({
      album: asText(r.Album),
      artist: asText(r.Artist),
      genreMatchTracks: asNumber(r.GenreMatchTracks),
    }));
  }

  // ------------------------------------------------------------------
  // popular_in_genre
  // ------------------------------------------------------------------

  /**
   * Original project semantics: exact genre name, popularity measured by
   * the number of InvoiceLine rows referencing each track (times sold).
   */
  popularInGenre(genre: string, limit = 10): PopularTrack[] {
    const needle = genre.trim();
    if (!needle) throw invalidArgument("genre must not be empty.");
    assertCatalogLimit(limit);

    const rows = this.storage.all(
      `SELECT t.Name AS Track, ar.Name AS Artist, a.Title AS Album,
              COUNT(il.InvoiceLineId) AS TimesSold
       FROM Track t
       JOIN Genre  g  ON g.GenreId   = t.GenreId
       JOIN Album  a  ON a.AlbumId   = t.AlbumId
       JOIN Artist ar ON ar.ArtistId = a.ArtistId
       LEFT JOIN InvoiceLine il ON il.TrackId = t.TrackId
       WHERE g.Name = ?
       GROUP BY t.TrackId
       ORDER BY TimesSold DESC, t.Name
       LIMIT ?`,
      [needle, limit],
    );
    return rows.map((r: Row) => ({
      track: asText(r.Track),
      artist: asText(r.Artist),
      album: asText(r.Album),
      timesSold: asNumber(r.TimesSold),
    }));
  }
}
