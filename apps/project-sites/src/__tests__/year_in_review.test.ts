/**
 * Year-in-review stat-rollup — pure, zero-I/O, never throws.
 *
 * Covers: full data generates all highlights, empty data minimal output,
 * formatCount for small/large/million, headline contains business name + year,
 * shareText non-empty, stats array populated, never throws.
 */
import {
  buildYearInReview,
  formatCount,
  type YearInReviewInput,
} from '../services/year_in_review.js';

function fullInput(overrides: Partial<YearInReviewInput> = {}): YearInReviewInput {
  return {
    siteName: "Vito's",
    year: 2026,
    totalVisitors: 12340,
    totalPageviews: 89000,
    topReferrers: ['google.com', 'facebook.com', 'yelp.com', 'instagram.com', 'twitter.com'],
    topPages: ['/services', '/about', '/contact', '/gallery', '/blog'],
    conversionCount: 312,
    busiestDay: { date: '2026-06-15', count: 480 },
    busiestHour: 18,
    peakSeason: 'Summer',
    ...overrides,
  };
}

describe('buildYearInReview', () => {
  it('returns a headline containing business name and year', () => {
    const r = buildYearInReview(fullInput());
    expect(r.headline).toContain("Vito's");
    expect(r.headline).toContain('2026');
  });

  it('generates fact-based highlights for every populated field', () => {
    const r = buildYearInReview(fullInput());

    expect(r.highlights.length).toBeGreaterThanOrEqual(5);
    expect(r.highlights.length).toBeLessThanOrEqual(9);

    // visitors
    expect(r.highlights.some((h) => h.includes('12.3k') && h.includes('visited'))).toBe(true);
    // pageviews
    expect(r.highlights.some((h) => h.includes('89.0k') && h.includes('viewed'))).toBe(true);
    // top page
    expect(r.highlights.some((h) => h.includes('/services') && h.includes('popular'))).toBe(true);
    // top referrer
    expect(r.highlights.some((h) => h.includes('google.com') && h.includes('referrer'))).toBe(true);
    // conversions
    expect(r.highlights.some((h) => h.includes('312') && h.includes('leads'))).toBe(true);
    // busiest day combined with hour
    expect(
      r.highlights.some((h) => h.includes('2026-06-15') && h.includes('peaking at 6 PM')),
    ).toBe(true);
    // peak season
    expect(r.highlights.some((h) => h.includes('Summer') && h.includes('peak'))).toBe(true);

    // closing
    expect(r.highlights[r.highlights.length - 1]).toContain('another great year');
  });

  it('always closes with the positive tagline', () => {
    const r = buildYearInReview(fullInput());
    expect(r.highlights[r.highlights.length - 1]).toBe("Here's to another great year ahead.");
  });

  it('produces a minimal but valid report for empty/zero data', () => {
    const input: YearInReviewInput = {
      siteName: 'Test',
      year: 2026,
      totalVisitors: 0,
      totalPageviews: 0,
      topReferrers: [],
      topPages: [],
      conversionCount: 0,
      busiestDay: null,
      busiestHour: null,
      peakSeason: null,
    };

    const r = buildYearInReview(input);

    expect(r.headline).toBe('Test — 2026 in Review');
    expect(r.highlights.length).toBe(1);
    expect(r.highlights[0]).toContain('another great year');
    expect(r.stats.length).toBe(6);
    expect(r.shareText).toBeTruthy();
  });

  it('generates a non-empty shareText with populated data', () => {
    const r = buildYearInReview(fullInput());
    expect(r.shareText.length).toBeGreaterThan(0);
    expect(r.shareText).toContain("Vito's");
    expect(r.shareText).toContain('2026');
    expect(r.shareText).toContain('12.3k visitors');
    expect(r.shareText).toContain('89.0k pageviews');
  });

  it('generates a minimal shareText for empty data', () => {
    const r = buildYearInReview({
      siteName: 'Empty',
      year: 2026,
      totalVisitors: 0,
      totalPageviews: 0,
      topReferrers: [],
      topPages: [],
      conversionCount: 0,
      busiestDay: null,
      busiestHour: null,
      peakSeason: null,
    });

    expect(r.shareText).toContain('Empty');
    expect(r.shareText).toContain('See what happened');
  });

  it('populates stats array with one entry per metric', () => {
    const r = buildYearInReview(fullInput());
    expect(r.stats).toHaveLength(6);

    const labels = r.stats.map((s) => s.label);
    expect(labels).toContain('Visitors');
    expect(labels).toContain('Pageviews');
    expect(labels).toContain('Leads');
    expect(labels).toContain('Busiest Day');
    expect(labels).toContain('Top Referrer');
    expect(labels).toContain('Peak Season');
  });

  it('formats stat values correctly', () => {
    const r = buildYearInReview(fullInput());
    const visitors = r.stats.find((s) => s.label === 'Visitors')!;
    expect(visitors.value).toBe('12.3k');

    const pageviews = r.stats.find((s) => s.label === 'Pageviews')!;
    expect(pageviews.value).toBe('89.0k');

    const leads = r.stats.find((s) => s.label === 'Leads')!;
    expect(leads.value).toBe('312');
  });

  it('uses em-dash for missing values in stats table', () => {
    const r = buildYearInReview({
      siteName: 'X',
      year: 2026,
      totalVisitors: 0,
      totalPageviews: 0,
      topReferrers: [],
      topPages: [],
      conversionCount: 0,
      busiestDay: null,
      busiestHour: null,
      peakSeason: null,
    });

    expect(r.stats.find((s) => s.label === 'Busiest Day')!.value).toBe('—');
    expect(r.stats.find((s) => s.label === 'Top Referrer')!.value).toBe('—');
    expect(r.stats.find((s) => s.label === 'Peak Season')!.value).toBe('—');
  });
});

describe('formatCount', () => {
  it('formats small numbers with commas', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1)).toBe('1');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(9999)).toBe('9,999');
  });

  it('formats medium numbers as X.Xk', () => {
    expect(formatCount(10000)).toBe('10.0k');
    expect(formatCount(12345)).toBe('12.3k');
    expect(formatCount(999999)).toBe('1000.0k');
  });

  it('formats large numbers as X.XM', () => {
    expect(formatCount(1000000)).toBe('1.0M');
    expect(formatCount(1500000)).toBe('1.5M');
    expect(formatCount(25000000)).toBe('25.0M');
  });
});

describe('never throws', () => {
  it('accepts all-zero input without throwing', () => {
    expect(() =>
      buildYearInReview({
        siteName: 'X',
        year: 2026,
        totalVisitors: 0,
        totalPageviews: 0,
        topReferrers: [],
        topPages: [],
        conversionCount: 0,
        busiestDay: null,
        busiestHour: null,
        peakSeason: null,
      }),
    ).not.toThrow();
  });

  it('accepts partial fields without throwing', () => {
    expect(() =>
      buildYearInReview({
        siteName: 'Y',
        year: 2026,
        totalVisitors: 0,
        totalPageviews: 0,
        topReferrers: [],
        topPages: [],
        conversionCount: 0,
        busiestDay: null,
        busiestHour: null,
        peakSeason: null,
      }),
    ).not.toThrow();
  });

  it('formatCount never throws on any non-negative input', () => {
    expect(() => formatCount(0)).not.toThrow();
    expect(() => formatCount(1)).not.toThrow();
    expect(() => formatCount(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });
});
