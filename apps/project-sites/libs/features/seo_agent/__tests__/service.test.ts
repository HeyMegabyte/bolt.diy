import { runSeoHealthCheck } from '../service.js';
import type { SeoSignals } from '../service.js';

function healthy(overrides: Partial<SeoSignals> = {}): SeoSignals {
  return {
    slug: 'test', pageCount: 10, pagesWithMetaDesc: 10, pagesWithH1: 10,
    pagesWithAltText: 10, internalLinkCount: 30, indexedPages: 10,
    backlinkCount: 50, avgLcpMs: 1800, avgCls: 0.05,
    keywordRankings: [{ keyword: 'pizza', position: 3, change: -1 }, { keyword: 'restaurant', position: 5, change: -2 }],
    competitorKeywords: ['pizza', 'restaurant'], siteKeywords: ['pizza', 'restaurant', 'delivery'],
    hasSitemap: true, hasRobotsTxt: true, hasSchemaOrg: true, lastCrawledAt: '2026-07-15',
    ...overrides,
  };
}

describe('runSeoHealthCheck', () => {
  test('healthy site scores A', () => {
    const r = runSeoHealthCheck('s1', healthy());
    expect(r.grade).toBe('A');
    expect(r.criticalCount).toBe(0);
  });
  test('no sitemap is critical', () => {
    const r = runSeoHealthCheck('s1', healthy({ hasSitemap: false }));
    expect(r.checks.some((c) => c.id === 'no_sitemap')).toBe(true);
  });
  test('no structured data is critical', () => {
    const r = runSeoHealthCheck('s1', healthy({ hasSchemaOrg: false }));
    expect(r.checks.some((c) => c.id === 'no_schema')).toBe(true);
  });
  test('missing meta descs trigger warning', () => {
    const r = runSeoHealthCheck('s1', healthy({ pagesWithMetaDesc: 5 }));
    expect(r.checks.some((c) => c.id === 'meta_gap')).toBe(true);
  });
  test('keyword drops trigger warning', () => {
    const r = runSeoHealthCheck('s1', healthy({ keywordRankings: [{ keyword: 'pizza', position: 12, change: 8 }] }));
    expect(r.checks.some((c) => c.id === 'keyword_drops')).toBe(true);
    expect(r.keywordLosses).toBe(1);
  });
  test('keyword wins are tracked', () => {
    expect(runSeoHealthCheck('s1', healthy()).keywordWins).toBe(2);
  });
  test('competitor gaps trigger warning', () => {
    const r = runSeoHealthCheck('s1', healthy({ competitorKeywords: ['pizza', 'restaurant', 'catering', 'delivery', 'takeout', 'gluten-free'], siteKeywords: ['pizza'] }));
    expect(r.checks.some((c) => c.id === 'keyword_gaps')).toBe(true);
    expect(r.contentGapCount).toBeGreaterThan(3);
  });
  test('low index rate triggers warning', () => {
    const r = runSeoHealthCheck('s1', healthy({ pageCount: 10, indexedPages: 5 }));
    expect(r.checks.some((c) => c.id === 'low_index')).toBe(true);
  });
  test('summary is generated', () => {
    expect(runSeoHealthCheck('s1', healthy()).summary).toBeTruthy();
  });
});
