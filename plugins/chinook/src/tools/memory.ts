/**
 * Memory tools: long-term per-customer memory (spec §15–§16).
 *
 * The customer scope always comes from the IdentityProvider, never from the
 * model. `remember` saves a durable fact; `recall` keyword-searches the
 * current customer's memories (or returns the most recent ones when no
 * query is given, matching the original fallback).
 */

import { defineTool, type ToolRuntime } from "@deepseek-ai/dsh-tools";
import type { IdentityProvider } from "../identity.js";
import { MemoryService } from "../services/memory.js";
import { errorResult, failureOf, jsonValueOf, renderJson } from "./shared.js";

export function registerMemoryTools(tools: ToolRuntime, memory: MemoryService, identity: IdentityProvider) {
  tools.register(rememberTool(memory, identity));
  tools.register(recallTool(memory, identity));
}

function rememberTool(memory: MemoryService, identity: IdentityProvider) {
  return defineTool({
    name: "remember",
    description:
      "Save a durable fact or preference about the current customer into long-term memory, " +
      "e.g. \"User prefers jazz music\". Use when the user states a stable preference or fact " +
      "that should persist across conversations. The customer scope is resolved by the system.",
    parameters: {
      fact: {
        type: "string",
        description: "A short, self-contained statement of the fact/preference to remember.",
        required: true,
      },
    },
    output: {
      schema: { type: "json", description: "Structured ok/error result with the saved memory." },
      render: renderJson,
    },
    async execute(args) {
      const customerId = identity.getCurrentCustomerId();
      if (customerId === null) {
        return jsonValueOf(errorResult("IDENTITY_REQUIRED", "No customer identity is available. Please sign in first."));
      }
      try {
        const fact = String(args.fact ?? "");
        const saved = memory.save(customerId, fact);
        return jsonValueOf({ ok: true, memory: saved });
      } catch (error) {
        return jsonValueOf(failureOf(error));
      }
    },
  });
}

function recallTool(memory: MemoryService, identity: IdentityProvider) {
  return defineTool({
    name: "recall",
    description:
      "Search the current customer's saved long-term memories (e.g. favorite genres, " +
      "shipping preferences). Pass a keyword like \"genre\" or \"jazz\"; without a query, " +
      "returns the most recent memories. The customer scope is resolved by the system.",
    parameters: {
      query: {
        type: "string",
        description: "Keyword to search memories for (optional).",
      },
      limit: {
        type: "integer",
        description: "Maximum number of memories to return (1-50, default 3).",
      },
    },
    output: {
      schema: { type: "json", description: "Structured ok/error result with matching memories." },
      render: renderJson,
    },
    async execute(args) {
      const customerId = identity.getCurrentCustomerId();
      if (customerId === null) {
        return jsonValueOf(errorResult("IDENTITY_REQUIRED", "No customer identity is available. Please sign in first."));
      }
      try {
        const query = args.query === undefined ? "" : String(args.query);
        const limit = args.limit === undefined ? 3 : Number(args.limit);
        const items = memory.search(customerId, query, limit);
        return jsonValueOf({ ok: true, count: items.length, items });
      } catch (error) {
        return jsonValueOf(failureOf(error));
      }
    },
  });
}
