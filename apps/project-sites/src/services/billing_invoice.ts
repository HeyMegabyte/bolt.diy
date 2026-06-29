/**
 * @module services/billing_invoice
 *
 * @description
 * Pure invoice-domain helpers for the billing subsystem. Creates invoices from
 * line-item arrays, computes subtotals/tax/totals, and returns a ready-to-
 * persist {@link Invoice} object. No I/O, no database, no clock dependency
 * (caller injects `nowMs` for determinism).
 *
 * Tax defaults to 0 (`DEFAULT_TAX_RATE`) — the business is responsible for
 * its own tax compliance.
 */

/** A single line on an invoice. */
export interface InvoiceLine {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly totalCents: number;
}

/** The status lifecycle of an invoice. */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue';

/** A fully-constructed invoice ready for persistence. */
export interface Invoice {
  readonly id: string;
  readonly orgId: string;
  readonly number: string;
  readonly date: string;
  readonly dueDate: string;
  readonly lines: readonly InvoiceLine[];
  readonly subtotal: number;
  readonly tax: number;
  readonly total: number;
  readonly status: InvoiceStatus;
}

/** No tax by default — the business is responsible for its own tax compliance. */
export const DEFAULT_TAX_RATE = 0;

/**
 * Compute an invoice's subtotal, tax, and total from its line items.
 *
 * @param lines - The line items on the invoice.
 * @param taxRate - Tax rate as a decimal fraction (e.g. `0.08` for 8%).
 *   Defaults to {@link DEFAULT_TAX_RATE}.
 * @returns An object with `subtotal`, `tax`, and `total` — all in cents.
 *
 * @example invoiceTotal([{ description:'Widget', quantity:2, unitPriceCents:500, totalCents:1000 }], 0.08)
 * // → { subtotal: 1000, tax: 80, total: 1080 }
 */
export function invoiceTotal(
  lines: readonly InvoiceLine[],
  taxRate: number = DEFAULT_TAX_RATE,
): { subtotal: number; tax: number; total: number } {
  const subtotal = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const tax = Math.round(subtotal * taxRate);
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

/**
 * Create a draft {@link Invoice} from an org ID and line items.
 *
 * Generates a UUIDv4-like ID (16 random hex chars — enough for uniqueness in
 * a single billing context), a human-friendly invoice number, dates relative
 * to `nowMs`, and computes all monetary fields via {@link invoiceTotal}.
 *
 * @param orgId - The owning organisation ID.
 * @param lines - The line items on the invoice.
 * @param taxRate - Tax rate as a decimal fraction. Defaults to
 *   {@link DEFAULT_TAX_RATE}.
 * @param nowMs - Timestamp in milliseconds used as the invoice date. Defaults
 *   to `Date.now()`. Accepting the parameter makes this function deterministic
 *   for testing.
 * @returns A draft {@link Invoice} ready for persistence.
 *
 * @example
 * const inv = createInvoice('org_abc', [
 *   { description:'Consulting', quantity:10, unitPriceCents:15000, totalCents:150000 },
 * ], 0.08, 1719292800000);
 * inv.status // → 'draft'
 */
export function createInvoice(
  orgId: string,
  lines: readonly InvoiceLine[],
  taxRate: number = DEFAULT_TAX_RATE,
  nowMs: number = Date.now(),
): Invoice {
  const now = new Date(nowMs);
  const id = crypto.randomUUID();
  const number = `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${id.slice(0, 8).toUpperCase()}`;
  const date = now.toISOString().slice(0, 10);
  const due = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const dueDate = due.toISOString().slice(0, 10);
  const { subtotal, tax, total } = invoiceTotal(lines, taxRate);

  return {
    date,
    dueDate,
    id,
    lines,
    number,
    orgId,
    status: 'draft',
    subtotal,
    tax,
    total,
  };
}
