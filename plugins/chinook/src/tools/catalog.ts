/**
 * Catalog tools: music discovery (spec §9–§11).
 *
 * Thin argument adapters over CatalogService — no SQL here. Limits are
 * validated by the service exactly like the original project rejected
 * out-of-range values.
 */

import { defineTool, type ToolRuntime } from "@deepseek-ai/dsh-tools";
import { CatalogService } from "../services/catalog.js";
import { failureOf, jsonValueOf, renderJson } from "./shared.js";

export function registerCatalogTools(tools: ToolRuntime, catalog: CatalogService) {
  tools.register(searchCatalogTool(catalog));
  tools.register(findSimilarAlbumsTool(catalog));
  tools.register(popularInGenreTool(catalog));
}

function searchCatalogTool(catalog: CatalogService) {
  return defineTool({
    name: "search_catalog",
    description:
      "Search the Chinook music store catalog (tracks, albums, artists, genres) with a " +
      "case-insensitive partial keyword match. Use this to find real catalog content " +
      "before recommending or describing music. Returns structured items with a type " +
      "(track|album|artist|genre), id, name and context fields.",
    parameters: {
      query: {
        type: "string",
        description: "Search keyword, e.g. \"Queen\", \"jazz\", \"rock\". Matches titles/names partially.",
        required: true,
      },
      entity_type: {
        type: "string",
        description: "What to search for: track, album, artist, genre, or all (default).",
        enum: ["track", "album", "artist", "genre", "all"],
      },
      limit: {
        type: "integer",
        description: "Maximum number of results to return (1-50, default 10).",
      },
    },
    output: {
      schema: { type: "json", description: "Structured ok/error result with items." },
      render: renderJson,
    },
    async execute(args) {
      try {
        const query = String(args.query ?? "");
        const entityType = (args.entity_type ?? "all") as "track" | "album" | "artist" | "genre" | "all";
        const limit = args.limit === undefined ? 10 : Number(args.limit);
        const items = catalog.searchCatalog(query, entityType, limit);
        return jsonValueOf({ ok: true, query: query.trim(), entity_type: entityType, count: items.length, items });
      } catch (error) {
        return jsonValueOf(failureOf(error));
      }
    },
  });
}

function findSimilarAlbumsTool(catalog: CatalogService) {
  return defineTool({
    name: "find_similar_albums",
    description:
      "Find albums similar to a given album. Similarity is genre-based: albums whose " +
      "tracks share genres with the source album, ranked by matching track count. " +
      "The album name may be a partial title.",
    parameters: {
      album_name: {
        type: "string",
        description: "Title (or partial title) of the album to match against.",
        required: true,
      },
      limit: {
        type: "integer",
        description: "Maximum number of recommendations to return (1-50, default 5).",
      },
    },
    output: {
      schema: { type: "json", description: "Structured ok/error result with album recommendations." },
      render: renderJson,
    },
    async execute(args) {
      try {
        const albumName = String(args.album_name ?? "");
        const limit = args.limit === undefined ? 5 : Number(args.limit);
        const albums = catalog.findSimilarAlbums(albumName, limit);
        return jsonValueOf({ ok: true, album_name: albumName.trim(), count: albums.length, items: albums });
      } catch (error) {
        return jsonValueOf(failureOf(error));
      }
    },
  });
}

function popularInGenreTool(catalog: CatalogService) {
  return defineTool({
    name: "popular_in_genre",
    description:
      "Return the best-selling tracks in a genre, measured by how many times each track " +
      "has been sold (InvoiceLine rows). Use this for popularity-based recommendations " +
      "within a genre (e.g. \"Jazz\", \"Rock\", \"Classical\").",
    parameters: {
      genre: {
        type: "string",
        description: "Exact genre name, e.g. \"Jazz\", \"Rock\", \"Classical\".",
        required: true,
      },
      limit: {
        type: "integer",
        description: "Maximum number of tracks to return (1-50, default 10).",
      },
    },
    output: {
      schema: { type: "json", description: "Structured ok/error result with best-selling tracks." },
      render: renderJson,
    },
    async execute(args) {
      try {
        const genre = String(args.genre ?? "");
        const limit = args.limit === undefined ? 10 : Number(args.limit);
        const tracks = catalog.popularInGenre(genre, limit);
        return jsonValueOf({ ok: true, genre: genre.trim(), count: tracks.length, items: tracks });
      } catch (error) {
        return jsonValueOf(failureOf(error));
      }
    },
  });
}
