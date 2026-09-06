/**
 * OrdersService + identity tests. Grounded fixtures: customer 1 (Luís
 * Gonçalves) owns exactly 7 invoices; InvoiceId 1 belongs to another
 * customer; InvoiceId 98 is customer 1's first.
 */

import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ChinookError } from "../plugins/chinook/src/errors";
import { DemoIdentityProvider, type IdentityProvider } from "../plugins/chinook/src/identity";
import { OrdersService, requireCustomer } from "../plugins/chinook/src/services/orders";
import { ChinookStorage } from "../plugins/chinook/src/storage/chinook";

const CHINOOK_DB = resolve(import.meta.dirname, "../data/chinook.db");

describe("requireCustomer", () => {
  it("rejects a null identity with IDENTITY_REQUIRED", () => {
    try {
      requireCustomer(null);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as ChinookError).code).toBe("IDENTITY_REQUIRED");
    }
  });
});

describe("OrdersService.listMyOrders", () => {
  let orders: OrdersService;

  beforeAll(() => {
    orders = new OrdersService(new ChinookStorage(CHINOOK_DB));
  });

  it("lists the current customer's invoices most recent first", () => {
    const rows = orders.listMyOrders(1, 50);
    expect(rows.length).toBe(7);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.invoiceDate >= rows[i]!.invoiceDate).toBe(true);
    }
    expect(rows.every((r) => r.invoiceId >= 98 && r.invoiceId <= 382)).toBe(true);
  });

  it("honors the limit", () => {
    expect(orders.listMyOrders(1, 3).length).toBe(3);
  });

  it("never exposes another customer's invoices", () => {
    // Customer 2's invoices are invisible through customer 1's listing.
    const mine = new Set(orders.listMyOrders(1, 50).map((r) => r.invoiceId));
    const theirs = new Set(orders.listMyOrders(2, 50).map((r) => r.invoiceId));
    expect(mine.size).toBeGreaterThan(0);
    expect(theirs.size).toBeGreaterThan(0);
    for (const id of theirs) expect(mine.has(id)).toBe(false);
  });

  it("rejects invalid limits", () => {
    expect(() => orders.listMyOrders(1, 0)).toThrowError(ChinookError);
    expect(() => orders.listMyOrders(1, 51)).toThrowError(ChinookError);
  });
});

describe("OrdersService.getInvoiceDetails (invoice security)", () => {
  let orders: OrdersService;

  beforeAll(() => {
    orders = new OrdersService(new ChinookStorage(CHINOOK_DB));
  });

  it("returns line items of an owned invoice", () => {
    const details = orders.getInvoiceDetails(1, 98);
    expect(details.invoiceId).toBe(98);
    expect(details.lines.length).toBeGreaterThan(0);
    for (const line of details.lines) {
      expect(line.track.length).toBeGreaterThan(0);
      expect(line.artist.length).toBeGreaterThan(0);
      expect(line.unitPrice).toBeGreaterThan(0);
      expect(line.quantity).toBeGreaterThanOrEqual(1);
    }
  });

  it("refuses a foreign invoice with ACCESS_DENIED and no ownership leak", () => {
    try {
      orders.getInvoiceDetails(1, 1); // belongs to another customer
      throw new Error("expected rejection");
    } catch (error) {
      const e = error as ChinookError;
      expect(e.code).toBe("ACCESS_DENIED");
      expect(e.message).toContain("not associated with your account");
      // No disclosure: the refusal must not name the owning customer.
      expect(e.message).not.toMatch(/customer \d+|belongs to/i);
    }
  });

  it("reports NOT_FOUND for a missing invoice", () => {
    try {
      orders.getInvoiceDetails(1, 999999);
      throw new Error("expected rejection");
    } catch (error) {
      const e = error as ChinookError;
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toBe("No invoice found with id 999999.");
    }
  });

  it("rejects non-positive invoice ids", () => {
    expect(() => orders.getInvoiceDetails(1, 0)).toThrowError(ChinookError);
    expect(() => orders.getInvoiceDetails(1, -3)).toThrowError(ChinookError);
  });
});

describe("DemoIdentityProvider", () => {
  const original = process.env.CHINOOK_CUSTOMER_ID;

  afterEach(() => {
    if (original === undefined) delete process.env.CHINOOK_CUSTOMER_ID;
    else process.env.CHINOOK_CUSTOMER_ID = original;
  });

  it("reads the demo customer from the environment", () => {
    process.env.CHINOOK_CUSTOMER_ID = "42";
    expect(new DemoIdentityProvider().getCurrentCustomerId()).toBe(42);
  });

  it("falls back to the demo default when unset", () => {
    delete process.env.CHINOOK_CUSTOMER_ID;
    expect(new DemoIdentityProvider().getCurrentCustomerId()).toBe(1);
    expect(new DemoIdentityProvider({ demoCustomerId: null }).getCurrentCustomerId()).toBe(null);
  });

  it("treats an invalid env value as anonymous", () => {
    process.env.CHINOOK_CUSTOMER_ID = "not-a-number";
    expect(new DemoIdentityProvider().getCurrentCustomerId()).toBe(null);
    process.env.CHINOOK_CUSTOMER_ID = "";
    expect(new DemoIdentityProvider().getCurrentCustomerId()).toBe(1);
  });

  it("is an IdentityProvider", () => {
    const provider: IdentityProvider = new DemoIdentityProvider();
    expect(typeof provider.getCurrentCustomerId).toBe("function");
  });
});
