import { summaryToCsv } from '../service.js';
import type { SiteAnalyticsSummary } from '../schemas.js';

const SUMMARY: SiteAnalyticsSummary = {
  siteId: 'site_1',
  windowDays: 30,
  contacts: {
    total: 12,
    newInWindow: 4,
    bySource: [
      { source: 'google', count: 7 },
      { source: 'form, direct', count: 5 }, // comma → must be quoted
    ],
  },
  formSubmissions: { total: 8, newInWindow: 2 },
  newsletter: { confirmed: 30, total: 33 },
  traffic: {
    pageviews: 1234,
    uniqueSessions: 567,
    conversions: 9,
    topPaths: [],
    byType: [],
    byDevice: [],
    byChannel: [],
    byCountry: [],
    previous: { pageviews: 0, uniqueSessions: 0, conversions: 0 },
    windowDays: 30,
  },
  generatedAt: '2026-06-28T00:00:00.000Z',
};

describe('summaryToCsv (AN42 owner data export)', () => {
  it('emits a metric,value header + flattened rows for every metric', () => {
    const csv = summaryToCsv(SUMMARY);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('metric,value');
    expect(lines).toContain('contacts.total,12');
    expect(lines).toContain('traffic.pageviews,1234');
    expect(lines).toContain('traffic.unique_sessions,567');
    expect(lines).toContain('contacts.bySource.google,7');
  });

  it('RFC-4180 quotes + escapes fields containing commas (source name)', () => {
    const csv = summaryToCsv(SUMMARY);
    // The "form, direct" source must be quoted so the comma doesn't split columns.
    expect(csv).toContain('"contacts.bySource.form, direct",5');
  });

  it('uses CRLF line endings and includes the site id + window', () => {
    const csv = summaryToCsv(SUMMARY);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('site_id,site_1');
    expect(csv).toContain('window_days,30');
  });
});
