import { aggregateCosts, formatCents, type CostLineItem } from '../services/cost_aggregation.js';

describe('formatCents (AP10 cost_aggregation)', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(1234)).toBe('$12.34');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(-50)).toBe('$0.00');
  });
});

describe('aggregateCosts (AP10)', () => {
  const items: CostLineItem[] = [
    { vendor: 'cloudflare', cents: 1200, app: 'projectsites' },
    { vendor: 'neon', cents: 800, app: 'projectsites' },
    { vendor: 'cloudflare', cents: 300, app: 'chatwoot' },
    { vendor: 'ses', cents: 100 },
  ];

  it('sums the grand total + formats it', () => {
    const s = aggregateCosts(items);
    expect(s.totalCents).toBe(2400);
    expect(s.totalDisplay).toBe('$24.00');
    expect(s.lineItemCount).toBe(4);
  });

  it('rolls up per-vendor, sorted highest-first, with % share', () => {
    const s = aggregateCosts(items);
    expect(s.byVendor[0]).toEqual({ vendor: 'cloudflare', cents: 1500, pctOfTotal: 62.5 });
    expect(s.byVendor.map((v) => v.vendor)).toEqual(['cloudflare', 'neon', 'ses']);
  });

  it('rolls up per-app and keeps "unattributed" last', () => {
    const s = aggregateCosts(items);
    expect(s.byApp[0]).toEqual({ app: 'projectsites', cents: 2000 });
    expect(s.byApp[s.byApp.length - 1].app).toBe('unattributed');
    expect(s.byApp.find((a) => a.app === 'unattributed')?.cents).toBe(100);
  });

  it('clamps negative/non-finite line items to 0', () => {
    const s = aggregateCosts([
      { vendor: 'a', cents: -500 },
      { vendor: 'a', cents: NaN },
      { vendor: 'a', cents: 250 },
    ]);
    expect(s.totalCents).toBe(250);
  });

  it('skips line items with no vendor and never throws', () => {
    const s = aggregateCosts([
      { vendor: '', cents: 100 },
      undefined as unknown as CostLineItem,
      { vendor: 'ok', cents: 100 },
    ]);
    expect(s.totalCents).toBe(100);
    expect(s.byVendor).toHaveLength(1);
  });

  it('returns an all-zero summary for empty/non-array input', () => {
    expect(aggregateCosts([]).totalCents).toBe(0);
    expect(aggregateCosts(undefined as unknown as []).totalDisplay).toBe('$0.00');
  });
});
