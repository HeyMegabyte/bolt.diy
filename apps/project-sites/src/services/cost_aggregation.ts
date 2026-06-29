/**
 * @module services/cost_aggregation
 * @description AP10 — cost-per-service aggregation. Rolls per-line-item spend
 * (CF / Neon / Upstash / CloudAMQP / SES / TiDB / …) into a dashboard summary:
 * grand total, per-vendor breakdown (sorted, with % share), and per-app
 * breakdown. Pure + zero-I/O: the caller pulls line items from each provider's
 * billing API; this layer is the deterministic roll-up + formatting. Never throws.
 *
 * @packageDocumentation
 */

/** One billing line item for a vendor (optionally attributed to an app). */
export interface CostLineItem {
  /** Vendor key, e.g. `cloudflare` / `neon` / `upstash` / `ses` / `tidb`. */
  readonly vendor: string;
  /** Cost in cents (negative values clamp to 0). */
  readonly cents: number;
  /** Owning app/service, when attributable. */
  readonly app?: string | null;
}

/** A vendor's rolled-up spend + share of the total. */
export interface VendorCost {
  readonly vendor: string;
  readonly cents: number;
  /** 0–100, one decimal, of the grand total. */
  readonly pctOfTotal: number;
}

/** An app's rolled-up spend. */
export interface AppCost {
  readonly app: string;
  readonly cents: number;
}

export interface CostSummary {
  readonly totalCents: number;
  /** `"$12.34"` formatted grand total. */
  readonly totalDisplay: string;
  /** Per-vendor, sorted highest-spend first. */
  readonly byVendor: readonly VendorCost[];
  /** Per-app, sorted highest-spend first (`unattributed` bucket last when present). */
  readonly byApp: readonly AppCost[];
  readonly lineItemCount: number;
}

/** Clamp to a non-negative integer cent value. */
function cents(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Format integer cents as a `$x.xx` string. */
export function formatCents(total: number): string {
  const c = cents(total);
  return `$${(c / 100).toFixed(2)}`;
}

/**
 * Aggregate cost line items into a {@link CostSummary}.
 *
 * @param items - Billing line items across vendors/apps.
 * @returns The rolled-up summary (empty input → an all-zero summary).
 *
 * @example
 * aggregateCosts([
 *   { vendor: 'cloudflare', cents: 1200, app: 'projectsites' },
 *   { vendor: 'neon', cents: 800 },
 * ]).totalDisplay // → '$20.00'
 */
export function aggregateCosts(items: readonly CostLineItem[]): CostSummary {
  const list = Array.isArray(items) ? items : [];
  const vendorMap = new Map<string, number>();
  const appMap = new Map<string, number>();
  let totalCents = 0;

  for (const it of list) {
    if (!it || typeof it.vendor !== 'string' || !it.vendor.trim()) continue;
    const v = it.vendor.trim();
    const amount = cents(it.cents);
    totalCents += amount;
    vendorMap.set(v, (vendorMap.get(v) ?? 0) + amount);
    const app = it.app?.trim() || 'unattributed';
    appMap.set(app, (appMap.get(app) ?? 0) + amount);
  }

  const byVendor: VendorCost[] = [...vendorMap.entries()]
    .map(([vendor, c]) => ({
      vendor,
      cents: c,
      pctOfTotal: totalCents > 0 ? Math.round((c / totalCents) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.cents - a.cents || a.vendor.localeCompare(b.vendor));

  const byApp: AppCost[] = [...appMap.entries()]
    .map(([app, c]) => ({ app, cents: c }))
    .sort((a, b) => {
      // Keep the catch-all "unattributed" bucket last regardless of size.
      if (a.app === 'unattributed') return 1;
      if (b.app === 'unattributed') return -1;
      return b.cents - a.cents || a.app.localeCompare(b.app);
    });

  return {
    totalCents,
    totalDisplay: formatCents(totalCents),
    byVendor,
    byApp,
    lineItemCount: list.length,
  };
}
