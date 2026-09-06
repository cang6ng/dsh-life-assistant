/**
 * Tool-layer tests: the 7 registered tools, their parameter schemas, the
 * structured ok/error result contract, identity gating of account/memory
 * tools, and invoice ownership through the tool boundary.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { DemoIdentityProvider } from "../plugins/chinook/src/identity";
import { CatalogService } from "../plugins/chinook/src/services/catalog";
import { MemoryService } from "../plugins/chinook/src/services/memory";
import { OrdersService } from "../plugins/chinook/src/services/orders";
import { ChinookStorage } from "../plugins/chinook/src/storage/chinook";
import { MemoryStorage } from "../plugins/chinook/src/storage/memory";
import { registerCatalogTools } from "../plugins/chinook/src/tools/catalog";
import { registerMemoryTools } from "../plugins/chinook/src/tools/memory";
import { registerOrderTools } from "../plugins/chinook/src/tools/orders";
import { renderJson } from "../plugins/chinook/src/tools/shared";

const CHINOOK_DB = resolve(import.meta.dirname, "../data/chinook.db");

/** Temp memory-store factory whose resources are released by releaseTempStores(). */
const tempDirRoots: string[] = [];
const tempStores: MemoryStorage[] = [];

function tempMemoryService(): MemoryService {
  const dir = mkdtempSync(join(tmpdir(), "chinook-tools-"));
  tempDirRoots.push(dir);
  const store = new MemoryStorage(join(dir, "memory.db"));
  tempStores.push(store);
  return new MemoryService(store);
}

function releaseTempStores(): void {
  for (const store of tempStores) store.close();
  tempStores.length = 0;
  for (const dir of tempDirRoots) rmSync(dir, { recursive: true, force: true });
  tempDirRoots.length = 0;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown;
}

/** Minimal in-memory ToolRuntime capturing the registered definitions. */
interface ToolHarness {
  harness: ToolRuntime;
  map: Map<string, ToolDef>;
}

/** JSON text of one rendered block (renderJson emits a single text block). */
function renderedJson(value: unknown): unknown {
  const blocks = renderJson({}, value) as Array<{ type?: string; text?: string }>;
  return JSON.parse(blocks[0]?.text ?? "");
}

function toolHarness(): ToolHarness {
  const map = new Map<string, ToolDef>();
  const harness = {
    register: (def: ToolDef) => {
      map.set(def.name, def);
    },
  } as unknown as ToolRuntime;
  return { harness, map };
}

afterAll(() => {
  releaseTempStores();
});

describe("the 7 registered tools", () => {
  let all: Map<string, ToolDef>;
  let identity: DemoIdentityProvider;

  beforeAll(() => {
    const catalog = new CatalogService(new ChinookStorage(CHINOOK_DB));
    const orders = new OrdersService(new ChinookStorage(CHINOOK_DB));
    const memory = tempMemoryService();
    identity = new DemoIdentityProvider();
    const h = toolHarness();
    all = h.map;
    registerCatalogTools(h.harness, catalog);
    registerOrderTools(h.harness, orders, identity);
    registerMemoryTools(h.harness, memory, identity);
  });

  it("has exactly the spec surface, nothing more", () => {
    expect([...all.keys()].sort()).toEqual(
      [
        "search_catalog",
        "find_similar_albums",
        "popular_in_genre",
        "list_my_orders",
        "get_invoice_details",
        "remember",
        "recall",
      ].sort(),
    );
  });

  it("never asks the model for a customer id", () => {
    for (const def of all.values()) {
      const params = Object.keys(def.parameters);
      for (const key of params) expect(key).not.toContain("customer");
      expect(def.description.toLowerCase()).not.toContain("customer id is");
    }
  });

  it("search_catalog documents its query/entity_type/limit contract", () => {
    const tool = all.get("search_catalog")!;
    // defineTool normalizes the per-property DSL into a JSON Schema object.
    const parameters = tool.parameters as {
      type: string;
      properties: Record<string, { type?: string; enum?: unknown[]; required?: boolean }>;
      required?: string[];
    };
    expect(parameters.type).toBe("object");
    expect(parameters.properties).toHaveProperty("query");
    expect(parameters.required).toContain("query");
    expect(parameters.properties.entity_type!.enum).toEqual([
      "track",
      "album",
      "artist",
      "genre",
      "all",
    ]);
  });
});

describe("tool execution contract", () => {
  let identity: DemoIdentityProvider;
  let execs: Record<string, (args: Record<string, unknown>) => unknown>;

  const original = process.env.CHINOOK_CUSTOMER_ID;

  beforeAll(() => {
    process.env.CHINOOK_CUSTOMER_ID = "1";
    identity = new DemoIdentityProvider();
    const catalog = new CatalogService(new ChinookStorage(CHINOOK_DB));
    const orders = new OrdersService(new ChinookStorage(CHINOOK_DB));
    const memory = tempMemoryService();
    const h = toolHarness();
    registerCatalogTools(h.harness, catalog);
    registerOrderTools(h.harness, orders, identity);
    registerMemoryTools(h.harness, memory, identity);
    execs = {};
    for (const def of h.map.values()) execs[def.name] = def.execute as (a: Record<string, unknown>) => unknown;
  });

  afterAll(() => {
    if (original === undefined) delete process.env.CHINOOK_CUSTOMER_ID;
    else process.env.CHINOOK_CUSTOMER_ID = original;
  });

  it("returns {ok:true,...} payloads rendered as pretty JSON", async () => {
    const result = await execs!.search_catalog({ query: "Queen", entity_type: "all", limit: 5 });
    const parsed = renderedJson(result) as { ok: boolean; count: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.count).toBeGreaterThan(0);
  });

  it("returns structured failures instead of throwing on business errors", async () => {
    const result = await execs!.search_catalog({ query: "", limit: 10 });
    const parsed = renderedJson(result) as { ok: false; error: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("INVALID_ARGUMENT");
  });

  it("resolves identity from the provider, not from arguments", async () => {
    const own = await execs!.list_my_orders({ limit: 50 });
    const parsedOwn = renderedJson(own) as { ok: boolean; count: number };
    expect(parsedOwn.ok).toBe(true);
    expect(parsedOwn.count).toBe(7); // customer 1's invoices

    process.env.CHINOOK_CUSTOMER_ID = "2";
    try {
      const theirs = await execs!.list_my_orders({ limit: 50 });
      const parsedTheirs = renderedJson(theirs) as { ok: boolean; count: number };
      expect(parsedTheirs.ok).toBe(true);
      expect(parsedTheirs.count).toBe(7);
    } finally {
      process.env.CHINOOK_CUSTOMER_ID = "1";
    }
  });

  it("gates account tools on identity (IDENTITY_REQUIRED)", async () => {
    const old = process.env.CHINOOK_CUSTOMER_ID;
    delete process.env.CHINOOK_CUSTOMER_ID;
    try {
      const anonymous = new DemoIdentityProvider({ demoCustomerId: null });
      // Rebuild tools bound to the anonymous provider for this assertion.
      const catalog = new CatalogService(new ChinookStorage(CHINOOK_DB));
      const orders = new OrdersService(new ChinookStorage(CHINOOK_DB));
      const memory = tempMemoryService();
      const local: Record<string, (a: Record<string, unknown>) => unknown> = {};
      const anon = toolHarness();
      registerOrderTools(anon.harness, orders, anonymous);
      registerMemoryTools(anon.harness, memory, anonymous);
      for (const def of anon.map.values()) local[def.name] = def.execute as (a: Record<string, unknown>) => unknown;

      for (const name of ["list_my_orders", "get_invoice_details", "remember", "recall"]) {
        const args =
          name === "get_invoice_details"
            ? { invoice_id: 1 }
            : name === "remember"
              ? { fact: "anything" }
              : {};
        const out = renderedJson(await local[name]!(args)) as {
          ok: boolean;
          error: { code: string };
        };
        expect(out.ok).toBe(false);
        expect(out.error.code).toBe("IDENTITY_REQUIRED");
      }
    } finally {
      if (old === undefined) delete process.env.CHINOOK_CUSTOMER_ID;
      else process.env.CHINOOK_CUSTOMER_ID = old;
    }
  });

  it("surfaces invoice ownership refusal as ACCESS_DENIED", async () => {
    const out = renderedJson(await execs!.get_invoice_details({ invoice_id: 1 })) as { ok: boolean; error: { code: string; message: string } };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("ACCESS_DENIED");
  });

  it("remember→recall round-trips through the tool boundary", async () => {
    await execs!.remember({ fact: "enjoys 70s prog rock" });
    const out = renderedJson(await execs!.recall({ query: "prog", limit: 3 })) as {
      ok: boolean;
      count: number;
      items: Array<{ text: string }>;
    };
    expect(out.ok).toBe(true);
    expect(out.items.some((m) => m.text === "enjoys 70s prog rock")).toBe(true);
  });
});
