/**
 * @file
 * Unit tests for the analytics exporter — pure filename + query builders.
 *
 * @see services/analytics_exporter.ts
 */

import {
  EXPORT_FORMATS,
  buildExportFilename,
  buildExportQuery,
} from '../services/analytics_exporter.js';

describe('analytics exporter', () => {
  describe('EXPORT_FORMATS', () => {
    it('is three formats in expected order', () => {
      expect(EXPORT_FORMATS).toEqual(['csv', 'json', 'pdf_summary']);
    });

    it('lists csv first and pdf_summary last', () => {
      expect(EXPORT_FORMATS[0]).toBe('csv');
      expect(EXPORT_FORMATS[EXPORT_FORMATS.length - 1]).toBe('pdf_summary');
    });
  });

  describe('buildExportFilename', () => {
    it('builds a csv filename from a full spec', () => {
      const name = buildExportFilename({
        format: 'csv',
        siteId: 'my-site_1',
        dateRange: { start: '2026-01-01', end: '2026-06-01' },
        metrics: ['visits', 'pageviews'],
      });
      expect(name).toBe('my-site-1_visits_pageviews_2026-01-01_to_2026-06-01.csv');
    });

    it('builds a json filename', () => {
      const name = buildExportFilename({
        format: 'json',
        siteId: 'megabytespace',
        dateRange: { start: '2026-03-01', end: '2026-03-31' },
        metrics: ['conversions', 'revenue'],
      });
      expect(name).toBe('megabytespace_conversions_revenue_2026-03-01_to_2026-03-31.json');
    });

    it('uses .json extension for json format', () => {
      const name = buildExportFilename({
        format: 'json',
        siteId: 'abc',
        dateRange: { start: '2026-01-01', end: '2026-01-31' },
        metrics: ['visits'],
      });
      expect(name).toMatch(/\.json$/);
    });

    it('uses .pdf extension for pdf_summary format', () => {
      const name = buildExportFilename({
        format: 'pdf_summary',
        siteId: 'x',
        dateRange: { start: '2026-01-01', end: '2026-01-31' },
        metrics: ['visits'],
      });
      expect(name).toMatch(/\.pdf$/);
    });

    it('sanitises special characters in siteId', () => {
      const name = buildExportFilename({
        format: 'csv',
        siteId: 'my/site@name!',
        dateRange: { start: '2026-01-01', end: '2026-01-31' },
        metrics: ['visits'],
      });
      expect(name).toMatch(/^my-site-name_visits_/);
    });

    it('falls back to "site" when siteId is entirely non-alphanumeric', () => {
      const name = buildExportFilename({
        format: 'csv',
        siteId: '@@@',
        dateRange: { start: '2026-01-01', end: '2026-01-31' },
        metrics: ['visits'],
      });
      expect(name).toMatch(/^site_visits_/);
    });

    it('handles empty metrics list', () => {
      const name = buildExportFilename({
        format: 'csv',
        siteId: 'test',
        dateRange: { start: '2026-01-01', end: '2026-01-31' },
        metrics: [],
      });
      expect(name).toBe('test__2026-01-01_to_2026-01-31.csv');
    });
  });

  describe('buildExportQuery', () => {
    it('builds a query for csv export with multiple metrics', () => {
      const q = buildExportQuery({
        format: 'csv',
        siteId: 'abc123',
        dateRange: { start: '2026-01-01', end: '2026-01-31' },
        metrics: ['visits', 'pageviews'],
      });
      expect(q).toEqual({
        table: 'analytics_daily',
        columns: ['date', 'visits', 'pageviews'],
        where: 'site_id = ? AND date BETWEEN ? AND ?',
        params: ['abc123', '2026-01-01', '2026-01-31'],
      });
    });

    it('builds a query for json export with single metric', () => {
      const q = buildExportQuery({
        format: 'json',
        siteId: 'xyz789',
        dateRange: { start: '2026-02-01', end: '2026-02-28' },
        metrics: ['conversions'],
      });
      expect(q).toEqual({
        table: 'analytics_daily',
        columns: ['date', 'conversions'],
        where: 'site_id = ? AND date BETWEEN ? AND ?',
        params: ['xyz789', '2026-02-01', '2026-02-28'],
      });
    });

    it('always returns analytics_daily as the table regardless of format', () => {
      for (const fmt of EXPORT_FORMATS) {
        const q = buildExportQuery({
          format: fmt,
          siteId: 'x',
          dateRange: { start: '2026-01-01', end: '2026-01-31' },
          metrics: ['visits'],
        });
        expect(q.table).toBe('analytics_daily');
      }
    });

    it('handles empty metrics (only date column)', () => {
      const q = buildExportQuery({
        format: 'csv',
        siteId: 'test',
        dateRange: { start: '2026-01-01', end: '2026-01-31' },
        metrics: [],
      });
      expect(q.columns).toEqual(['date']);
    });

    it('uses positional ? placeholders (D1-compatible SQL)', () => {
      const q = buildExportQuery({
        format: 'csv',
        siteId: 'site-42',
        dateRange: { start: '2026-04-01', end: '2026-04-30' },
        metrics: ['revenue', 'conversions'],
      });
      expect(q.where).toBe('site_id = ? AND date BETWEEN ? AND ?');
      expect(q.params).toEqual(['site-42', '2026-04-01', '2026-04-30']);
    });

    it('binds params in correct positional order (siteId, start, end)', () => {
      const q = buildExportQuery({
        format: 'csv',
        siteId: 'test-site',
        dateRange: { start: '2026-05-10', end: '2026-05-20' },
        metrics: ['visits'],
      });
      // The where clause has three placeholders: site_id, start, end
      const placeholders = q.where.match(/\?/g);
      expect(placeholders).toHaveLength(q.params.length);
    });
  });
});
