/**
 * Order tools: current-customer invoices (spec §12–§14).
 *
 * `customer_id` is never a parameter — the schema below deliberately has no
 * place for it. The identity resolved from the environment (IdentityProvider)
 * is injected into OrdersService, whose ownership rules are the last word:
 * a foreign invoice is ACCESS_DENIED without disclosing whose it is.
 */

import { defineTool, type ToolRuntime } from "@deepseek-ai/dsh-tools";
import type { IdentityProvider } from "../identity.js";
import { OrdersService } from "../services/orders.js";
import { errorResult, failureOf, jsonValueOf, renderJson } from "./shared.js";

export function registerOrderTools(tools: ToolRuntime, orders: OrdersService, identity: IdentityProvider) {
  tools.register(listMyOrdersTool(orders, identity));
  tools.register(getInvoiceDetailsTool(orders, identity));
}

function listMyOrdersTool(orders: OrdersService, identity: IdentityProvider) {
  return defineTool({
    name: "list_my_orders",
    description:
      "List the current customer's most recent invoices/orders. The customer identity " +
      "is resolved by the system — never ask the user for a customer id.",
    parameters: {
      limit: {
        type: "integer",
        description: "Maximum number of invoices to return (1-50, default 10).",
      },
    },
    output: {
      schema: { type: "json", description: "Structured ok/error result with the customer's invoices." },
      render: renderJson,
    },
    async execute(args) {
      const customerId = identity.getCurrentCustomerId();
      if (customerId === null) {
        return jsonValueOf(errorResult("IDENTITY_REQUIRED", "No customer identity is available. Please sign in first."));
      }
      try {
        const limit = args.limit === undefined ? 10 : Number(args.limit);
        const items = orders.listMyOrders(customerId, limit);
        return jsonValueOf({ ok: true, count: items.length, items });
      } catch (error) {
        return jsonValueOf(failureOf(error));
      }
    },
  });
}

function getInvoiceDetailsTool(orders: OrdersService, identity: IdentityProvider) {
  return defineTool({
    name: "get_invoice_details",
    description:
      "Return the line items (tracks, artists, quantities, prices) of one of the current " +
      "customer's invoices. Ownership is checked by the system: invoices that do not " +
      "belong to the current customer are refused.",
    parameters: {
      invoice_id: {
        type: "integer",
        description: "Invoice.InvoiceId to fetch.",
        required: true,
      },
    },
    output: {
      schema: { type: "json", description: "Structured ok/error result with invoice line items." },
      render: renderJson,
    },
    async execute(args) {
      const customerId = identity.getCurrentCustomerId();
      if (customerId === null) {
        return jsonValueOf(errorResult("IDENTITY_REQUIRED", "No customer identity is available. Please sign in first."));
      }
      try {
        const invoiceId = Number(args.invoice_id);
        const invoice = orders.getInvoiceDetails(customerId, invoiceId);
        return jsonValueOf({ ok: true, invoice });
      } catch (error) {
        return jsonValueOf(failureOf(error));
      }
    },
  });
}
