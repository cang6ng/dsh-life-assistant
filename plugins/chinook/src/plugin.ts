/**
 * Chinook plugin entry (spec §35).
 *
 * Responsibilities: build the layered stack
 *
 *     tools → services → storage → identity
 *
 * register the seven V1 tools through the DSH Tool Runtime and the Chinook
 * system-prompt section through the DSH System Prompt API. The CLI never
 * registers business tools; this plugin is the only Chinook entry point
 * into the DSH runtime.
 */

import { Context } from "@deepseek-ai/cordis";
import { ChinookStorage, chinookDbPathFromEnv } from "./storage/chinook.js";
import { MemoryStorage, memoryDbPathFromEnv } from "./storage/memory.js";
import { DemoIdentityProvider } from "./identity.js";
import { CatalogService } from "./services/catalog.js";
import { OrdersService } from "./services/orders.js";
import { MemoryService } from "./services/memory.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerChinookPrompt } from "./prompt.js";

export const name = "chinook";

/** The plugin activates once the tool runtime and prompt registry exist. */
export const inject = ["tools", "systemPrompt"];

export function apply(ctx: Context): () => void {
  return ctx.effect(() => {
    // Layered construction: storage at the bottom, services above it.
    const chinookDb = new ChinookStorage(chinookDbPathFromEnv());
    const memoryDb = new MemoryStorage(memoryDbPathFromEnv());
    const catalog = new CatalogService(chinookDb);
    const orders = new OrdersService(chinookDb);
    const memory = new MemoryService(memoryDb);
    const identity = new DemoIdentityProvider();

    registerCatalogTools(ctx.tools, catalog);
    registerOrderTools(ctx.tools, orders, identity);
    registerMemoryTools(ctx.tools, memory, identity);
    registerChinookPrompt(ctx.systemPrompt);

    return () => {
      chinookDb.close();
      memoryDb.close();
    };
  });
}
