import { matchCommandCatalog } from '../routes/search';

describe('matchCommandCatalog (⌘K smart-results catalog)', () => {
  it('returns [] for blank / sub-2-char queries', () => {
    expect(matchCommandCatalog('')).toEqual([]);
    expect(matchCommandCatalog('   ')).toEqual([]);
  });

  it('matches on label, case-insensitively', () => {
    const r = matchCommandCatalog('BILLING');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((c) => c.route === '/admin/billing')).toBe(true);
  });

  it('matches on route segment', () => {
    const r = matchCommandCatalog('feature-flags');
    expect(r.some((c) => c.route === '/admin/feature-flags')).toBe(true);
  });

  it('every result carries the palette command shape (id/label/icon/route)', () => {
    for (const c of matchCommandCatalog('admin', 50)) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(typeof c.icon).toBe('string');
      expect(c.route).toMatch(/^\//);
    }
  });

  it('honors the limit', () => {
    expect(matchCommandCatalog('s', 3).length).toBeLessThanOrEqual(3);
  });
});
