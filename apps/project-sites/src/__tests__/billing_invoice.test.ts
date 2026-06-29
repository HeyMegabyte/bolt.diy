/**
 * Pure billing-invoice helpers (§49). Locks invoice creation, total
 * computation, and default-tax semantics.
 */
import {
  DEFAULT_TAX_RATE,
  InvoiceLine,
  invoiceTotal,
  createInvoice,
} from '../services/billing_invoice.js';

describe('billing_invoice', () => {
  // ---------------------------------------------------------------------------
  // DEFAULT_TAX_RATE
  // ---------------------------------------------------------------------------
  it('defaults to 0 (business is responsible for own tax)', () => {
    expect(DEFAULT_TAX_RATE).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // invoiceTotal
  // ---------------------------------------------------------------------------
  describe('invoiceTotal', () => {
    it('sums totalCents across lines with no tax', () => {
      const lines: InvoiceLine[] = [
        { description: 'Widget', quantity: 2, unitPriceCents: 500, totalCents: 1000 },
        { description: 'Service', quantity: 1, unitPriceCents: 3000, totalCents: 3000 },
      ];
      expect(invoiceTotal(lines)).toEqual({ subtotal: 4000, tax: 0, total: 4000 });
    });

    it('applies tax rate as a decimal fraction', () => {
      const lines: InvoiceLine[] = [
        { description: 'Consulting', quantity: 10, unitPriceCents: 15000, totalCents: 150000 },
      ];
      expect(invoiceTotal(lines, 0.08)).toEqual({ subtotal: 150000, tax: 12000, total: 162000 });
    });

    it('rounds tax to nearest cent', () => {
      const lines: InvoiceLine[] = [
        { description: 'Fractional', quantity: 1, unitPriceCents: 199, totalCents: 199 },
      ];
      // 199 * 0.065 = 12.935 → Math.round → 13
      expect(invoiceTotal(lines, 0.065)).toEqual({ subtotal: 199, tax: 13, total: 212 });
    });

    it('returns 0 for an empty line array', () => {
      expect(invoiceTotal([])).toEqual({ subtotal: 0, tax: 0, total: 0 });
    });

    it('accepts a single line correctly', () => {
      const lines: InvoiceLine[] = [
        { description: 'Donation', quantity: 1, unitPriceCents: 5000, totalCents: 5000 },
      ];
      expect(invoiceTotal(lines, 0.1)).toEqual({ subtotal: 5000, tax: 500, total: 5500 });
    });
  });

  // ---------------------------------------------------------------------------
  // createInvoice
  // ---------------------------------------------------------------------------
  describe('createInvoice', () => {
    const ORG_ID = 'org_abc123';
    const FROZEN_MS = 1719292800000; // 2024-06-25T00:00:00.000Z
    const LINES: InvoiceLine[] = [
      { description: 'Setup fee', quantity: 1, unitPriceCents: 25000, totalCents: 25000 },
      { description: 'Monthly hosting', quantity: 1, unitPriceCents: 9900, totalCents: 9900 },
    ];

    it('creates a draft invoice with computed totals', () => {
      const inv = createInvoice(ORG_ID, LINES, 0.05, FROZEN_MS);

      expect(inv.orgId).toBe(ORG_ID);
      expect(inv.lines).toEqual(LINES);
      expect(inv.status).toBe('draft');
      // 25000 + 9900 = 34900 * 0.05 = 1745
      expect(inv.subtotal).toBe(34900);
      expect(inv.tax).toBe(1745);
      expect(inv.total).toBe(36645);
    });

    it('generates a unique id per call', () => {
      const a = createInvoice(ORG_ID, LINES, 0, FROZEN_MS);
      const b = createInvoice(ORG_ID, LINES, 0, FROZEN_MS);
      expect(a.id).not.toBe(b.id);
    });

    it('generates a human-friendly invoice number', () => {
      const inv = createInvoice(ORG_ID, LINES, 0, FROZEN_MS);
      // FROZEN_MS = June 2024 → INV-2024-06-XXXXXXXX
      expect(inv.number).toMatch(/^INV-2024-06-[A-F0-9]{8}$/);
    });

    it('sets date from nowMs and dueDate 30 days later', () => {
      const inv = createInvoice(ORG_ID, LINES, 0, FROZEN_MS);
      expect(inv.date).toBe('2024-06-25');
      expect(inv.dueDate).toBe('2024-07-25');
    });

    it('uses DEFAULT_TAX_RATE when taxRate is omitted', () => {
      const inv = createInvoice(ORG_ID, LINES, undefined, FROZEN_MS);
      expect(inv.tax).toBe(0);
      expect(inv.total).toBe(inv.subtotal);
    });

    it('uses Date.now() when nowMs is omitted', () => {
      const inv = createInvoice(ORG_ID, LINES);
      // date must be today (YYYY-MM-DD) — no way to drift to another day
      const today = new Date().toISOString().slice(0, 10);
      expect(inv.date).toBe(today);
    });

    it('handles a single-line invoice', () => {
      const inv = createInvoice(
        ORG_ID,
        [{ description: 'Donation', quantity: 1, unitPriceCents: 10000, totalCents: 10000 }],
        0,
        FROZEN_MS,
      );
      expect(inv.subtotal).toBe(10000);
      expect(inv.total).toBe(10000);
      expect(inv.lines).toHaveLength(1);
    });

    it('handles an empty line array', () => {
      const inv = createInvoice(ORG_ID, [], 0, FROZEN_MS);
      expect(inv.subtotal).toBe(0);
      expect(inv.tax).toBe(0);
      expect(inv.total).toBe(0);
      expect(inv.lines).toEqual([]);
    });
  });
});
