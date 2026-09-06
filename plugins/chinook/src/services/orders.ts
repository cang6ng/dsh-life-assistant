/**
 * OrdersService: current-customer invoice queries.
 *
 * Identity is never a model-supplied parameter: every method receives the
 * customer id resolved by the IdentityProvider inside the tool layer. The
 * original project's ownership rules are kept verbatim — an invoice that
 * belongs to another customer yields ACCESS_DENIED *without disclosing
 * whose invoice it is*.
 */

import type { ChinookStorage, Row } from "../storage/chinook.js";
import { accessDenied, identityRequired, invalidArgument, notFound } from "../errors.js";

export const MAX_ORDERS_LIMIT = 50;

export interface InvoiceSummary {
  invoiceId: number;
  invoiceDate: string;
  billingCity: string | null;
  billingCountry: string | null;
  total: number;
}

export interface InvoiceDetails {
  invoiceId: number;
  invoiceDate: string;
  total: number;
  lines: InvoiceLine[];
}

export interface InvoiceLine {
  track: string;
  artist: string;
  unitPrice: number;
  quantity: number;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function asNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Resolve identity inside the service boundary; throws IDENTITY_REQUIRED. */
export function requireCustomer(customerId: number | null): number {
  if (customerId === null) {
    throw identityRequired();
  }
  return customerId;
}

export class OrdersService {
  constructor(private readonly storage: ChinookStorage) {}

  /** The current customer's invoices, most recent first (original ORDER BY). */
  listMyOrders(customerId: number, limit = 10): InvoiceSummary[] {
    requireCustomer(customerId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ORDERS_LIMIT) {
      throw invalidArgument(`limit must be an integer between 1 and ${MAX_ORDERS_LIMIT}.`);
    }
    const rows = this.storage.all(
      `SELECT InvoiceId, InvoiceDate, BillingCity, BillingCountry, Total
       FROM Invoice
       WHERE CustomerId = ?
       ORDER BY InvoiceDate DESC
       LIMIT ?`,
      [customerId, limit],
    );
    return rows.map((r: Row) => ({
      invoiceId: asNumber(r.InvoiceId),
      invoiceDate: String(r.InvoiceDate),
      billingCity: asNullableText(r.BillingCity),
      billingCountry: asNullableText(r.BillingCountry),
      total: asNumber(r.Total),
    }));
  }

  /**
   * Line items of one invoice, only when it belongs to `customerId`.
   * A missing invoice is NOT_FOUND; a foreign invoice is ACCESS_DENIED
   * with a message that does not reveal ownership or existence details
   * beyond the id the caller already supplied.
   */
  getInvoiceDetails(customerId: number, invoiceId: number): InvoiceDetails {
    requireCustomer(customerId);
    if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) {
      throw invalidArgument("invoice_id must be a positive integer.");
    }

    const invoice = this.storage.get(
      "SELECT InvoiceId, CustomerId, InvoiceDate, Total FROM Invoice WHERE InvoiceId = ?",
      [invoiceId],
    );
    if (!invoice) {
      throw notFound(`No invoice found with id ${invoiceId}.`);
    }
    if (asNumber(invoice.CustomerId) !== customerId) {
      // Deliberately do not disclose whose invoice it is (original wording).
      throw accessDenied(
        `Invoice ${invoiceId} is not associated with your account. I can only show you invoices that belong to you.`,
      );
    }

    const rows = this.storage.all(
      `SELECT t.Name AS Track, ar.Name AS Artist, il.UnitPrice, il.Quantity
       FROM InvoiceLine il
       JOIN Track  t  ON t.TrackId  = il.TrackId
       JOIN Album  a  ON a.AlbumId  = t.AlbumId
       JOIN Artist ar ON ar.ArtistId = a.ArtistId
       WHERE il.InvoiceId = ?
       ORDER BY il.InvoiceLineId`,
      [invoiceId],
    );
    return {
      invoiceId: asNumber(invoice.InvoiceId),
      invoiceDate: String(invoice.InvoiceDate),
      total: asNumber(invoice.Total),
      lines: rows.map((r: Row) => ({
        track: String(r.Track),
        artist: String(r.Artist),
        unitPrice: asNumber(r.UnitPrice),
        quantity: asNumber(r.Quantity),
      })),
    };
  }
}
