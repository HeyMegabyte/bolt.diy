/**
 * @file
 * Unit tests for the CRM export service — pure export descriptor + filename builders.
 *
 * @see services/crm_export.ts
 */

import { EXPORT_FORMATS, buildExport, exportFilename } from '../services/crm_export.js';

import type { ExportScope } from '../services/crm_export.js';

describe('crm_export', () => {
  describe('EXPORT_FORMATS', () => {
    it('lists json first and csv last', () => {
      expect(EXPORT_FORMATS).toEqual(['json', 'csv']);
    });

    it('has exactly two formats', () => {
      expect(EXPORT_FORMATS).toHaveLength(2);
    });
  });

  describe('buildExport', () => {
    it('builds a contact export with default json format', () => {
      const result = buildExport('user_abc', 'contact');
      expect(result).toEqual({
        userId: 'user_abc',
        scope: 'contact',
        format: 'json',
        fileCount: 1,
        totalSizeBytes: 5_120,
      });
    });

    it('builds a company export as csv', () => {
      const result = buildExport('user_abc', 'company', 'csv');
      expect(result).toEqual({
        userId: 'user_abc',
        scope: 'company',
        format: 'csv',
        fileCount: 1,
        totalSizeBytes: 2_048,
      });
    });

    it('builds a deals export as json', () => {
      const result = buildExport('user_xyz', 'deals', 'json');
      expect(result).toEqual({
        userId: 'user_xyz',
        scope: 'deals',
        format: 'json',
        fileCount: 2,
        totalSizeBytes: 10_240,
      });
    });

    it('builds a full export with the largest size and highest file count', () => {
      const result = buildExport('admin_1', 'full', 'csv');
      expect(result).toEqual({
        userId: 'admin_1',
        scope: 'full',
        format: 'csv',
        fileCount: 5,
        totalSizeBytes: 51_200,
      });
    });

    it('defaults format to json when omitted', () => {
      for (const scope of ['contact', 'company', 'deals', 'full'] as ExportScope[]) {
        const result = buildExport('test', scope);
        expect(result.format).toBe('json');
      }
    });

    it('preserves the userId verbatim', () => {
      const result = buildExport('user@example.com', 'contact');
      expect(result.userId).toBe('user@example.com');
    });

    it('every scope has consistent fileCount and totalSizeBytes', () => {
      const scopes: ExportScope[] = ['contact', 'company', 'deals', 'full'];
      for (const scope of scopes) {
        const result = buildExport('x', scope);
        expect(result.fileCount).toBeGreaterThan(0);
        expect(result.totalSizeBytes).toBeGreaterThan(0);
        expect(result.scope).toBe(scope);
      }
    });
  });

  describe('exportFilename', () => {
    it('produces the expected pattern for json format', () => {
      const name = exportFilename('user_abc', 'contact', 'json');
      expect(name).toMatch(/^user-abc_contact_\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('produces the expected pattern for csv format', () => {
      const name = exportFilename('user_abc', 'full', 'csv');
      expect(name).toMatch(/^user-abc_full_\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('sanitises special characters in userId', () => {
      const name = exportFilename('user@name!', 'deals', 'json');
      expect(name).toMatch(/^user-name_deals_\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('falls back to "user" when userId is entirely non-alphanumeric', () => {
      const name = exportFilename('!!!', 'contact', 'csv');
      expect(name).toMatch(/^user_contact_\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('strips leading and trailing hyphens after sanitisation', () => {
      const name = exportFilename('-abc-', 'company', 'json');
      expect(name).toMatch(/^abc_company_\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('uses json extension when format is unknown', () => {
      const name = exportFilename('test', 'deals', 'pdf');
      expect(name).toMatch(/\.json$/);
    });

    it('uses the scope as the content descriptor', () => {
      for (const scope of ['contact', 'company', 'deals', 'full'] as ExportScope[]) {
        const name = exportFilename('user', scope, 'json');
        expect(name).toContain(`_${scope}_`);
      }
    });

    it('includes a valid ISO date segment', () => {
      const name = exportFilename('anyone', 'contact', 'csv');
      const datePart = name.match(/(\d{4}-\d{2}-\d{2})\.csv$/);
      expect(datePart).not.toBeNull();
      if (datePart) {
        const d = new Date(datePart[1]);
        expect(d.toISOString().startsWith(datePart[1])).toBe(true);
      }
    });

    it('userId with hyphens is kept as-is', () => {
      const name = exportFilename('my-user-id', 'contact', 'json');
      expect(name).toMatch(/^my-user-id_contact_\d{4}-\d{2}-\d{2}\.json$/);
    });
  });
});
