import { runLifecycleCheck } from '../service.js';
import type { SiteSignals } from '../service.js';

function healthySignals(overrides: Partial<SiteSignals> = {}): SiteSignals {
  return {
    slug: 'test-site', lastPublishedAt: '2026-07-14', pageCount: 5,
    pagesUpdatedAt: { '/': '2026-07-14', '/about': '2026-07-10' },
    hasMetaDescription: true, hasJsonLd: true, hasFaqSchema: true,
    imageCount: 10, imagesWithAlt: 10, internalLinkCount: 8,
    brokenLinkCount: 0, lighthouseScore: 92, lighthouseLastRun: '2026-07-14',
    lcpMs: 1800, cls: 0.03, hasSsl: true, hasSecurityTxt: true,
    hasHsts: true, hasContactPhone: true, hasContactEmail: true,
    hasBusinessHours: true, hasTestimonials: true,
    competitorContentGaps: 0, daysSinceLastUpdate: 5, ...overrides,
  };
}

describe('runLifecycleCheck', () => {
  test('healthy site scores excellent', () => {
    const r = runLifecycleCheck('s1', healthySignals());
    expect(r.overallHealth).toBe('excellent');
    expect(r.healthScore).toBeGreaterThanOrEqual(90);
    expect(r.criticalCount).toBe(0);
  });

  test('stale site triggers content warning', () => {
    const r = runLifecycleCheck('s1', healthySignals({ daysSinceLastUpdate: 120 }));
    expect(r.checks.some((c) => c.id === 'content_stale_90d')).toBe(true);
    expect(r.overallHealth).not.toBe('excellent');
  });

  test('very stale site triggers critical content alert', () => {
    const r = runLifecycleCheck('s1', healthySignals({ daysSinceLastUpdate: 200 }));
    expect(r.checks.some((c) => c.id === 'content_stale_180d')).toBe(true);
  });

  test('missing meta description is critical', () => {
    const r = runLifecycleCheck('s1', healthySignals({ hasMetaDescription: false }));
    const check = r.checks.find((c) => c.id === 'missing_meta_desc');
    expect(check?.severity).toBe('critical');
    expect(check?.autoFixable).toBe(true);
  });

  test('missing JSON-LD is critical and auto-fixable', () => {
    const r = runLifecycleCheck('s1', healthySignals({ hasJsonLd: false }));
    const check = r.checks.find((c) => c.id === 'missing_jsonld');
    expect(check?.severity).toBe('critical');
    expect(check?.autoFixable).toBe(true);
  });

  test('slow LCP triggers performance warning', () => {
    const r = runLifecycleCheck('s1', healthySignals({ lcpMs: 3200 }));
    expect(r.checks.some((c) => c.id === 'lcp_slow')).toBe(true);
  });

  test('high CLS triggers warning', () => {
    const r = runLifecycleCheck('s1', healthySignals({ cls: 0.25 }));
    expect(r.checks.some((c) => c.id === 'cls_high')).toBe(true);
  });

  test('no contact info is critical', () => {
    const r = runLifecycleCheck('s1', healthySignals({ hasContactPhone: false, hasContactEmail: false }));
    expect(r.checks.some((c) => c.id === 'no_contact')).toBe(true);
  });

  test('no business hours is warning', () => {
    const r = runLifecycleCheck('s1', healthySignals({ hasBusinessHours: false }));
    expect(r.checks.some((c) => c.id === 'no_hours')).toBe(true);
  });

  test('broken links trigger alert', () => {
    const r = runLifecycleCheck('s1', healthySignals({ brokenLinkCount: 8 }));
    const check = r.checks.find((c) => c.id === 'broken_links');
    expect(check?.severity).toBe('critical');
  });

  test('competitor gaps trigger warning', () => {
    const r = runLifecycleCheck('s1', healthySignals({ competitorContentGaps: 8 }));
    expect(r.checks.some((c) => c.id === 'competitor_gaps')).toBe(true);
  });

  test('health score degrades with more issues', () => {
    const healthy = runLifecycleCheck('s1', healthySignals());
    const sick = runLifecycleCheck('s1', healthySignals({
      hasMetaDescription: false, hasJsonLd: false, hasContactPhone: false,
      hasContactEmail: false, brokenLinkCount: 6, daysSinceLastUpdate: 200,
    }));
    expect(sick.healthScore).toBeLessThan(healthy.healthScore);
    expect(sick.overallHealth).toBe('poor');
  });

  test('summary is generated', () => {
    const r = runLifecycleCheck('s1', healthySignals());
    expect(r.summary).toBeTruthy();
    expect(r.summary.length).toBeGreaterThan(20);
  });

  test('nextCheckIn is set', () => {
    const r = runLifecycleCheck('s1', healthySignals());
    expect(r.nextCheckIn).toBe('7 days');
  });
});
