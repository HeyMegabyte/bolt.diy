/**
 * Unit tests for the canonical multi-tenant ownership guard.
 *
 * `assertSiteOwned(env, orgId, siteId)` is the SECURITY-CRITICAL guard every
 * flag-gated `:siteId` route uses to prevent cross-tenant reads/writes. These
 * tests lock its branch behavior:
 *   - owned site → true (caller's org matches the row's org_id)
 *   - foreign org → false (NEVER leak existence — callers 404, not 403)
 *   - missing/soft-deleted site → false
 *   - missing/empty orgId → false (short-circuits BEFORE any DB call)
 *   - the SQL filters by id AND deleted_at; org match is enforced in code
 *
 * D1 is mocked via the `../services/db.js` module mock — no real DB.
 */

// ─── Module Mocks (must be before imports) ───────────────────

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { assertSiteOwned } from '../services/site_ownership.js';
import { dbQueryOne } from '../services/db.js';
import type { Env } from '../types/env.js';

const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;

// Minimal Env stub — only `DB` is touched by the guard.
const env = { DB: { __brand: 'd1' } } as unknown as Env;

const OWNER_ORG = 'org_owner_123';
const FOREIGN_ORG = 'org_intruder_999';
const SITE_ID = 'site_abc_001';

describe('assertSiteOwned — multi-tenant ownership guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: row exists and belongs to OWNER_ORG.
    mockDbQueryOne.mockResolvedValue({ org_id: OWNER_ORG });
  });

  describe('owned site (positive path)', () => {
    it('returns true when the site belongs to the caller org', async () => {
      const result = await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      expect(result).toBe(true);
    });

    it('queries D1 exactly once when orgId is present', async () => {
      await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      expect(mockDbQueryOne).toHaveBeenCalledTimes(1);
    });

    it('passes env.DB as the binding to dbQueryOne', async () => {
      await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      expect(mockDbQueryOne).toHaveBeenCalledWith(
        env.DB,
        expect.any(String),
        expect.any(Array),
      );
    });
  });

  describe('SQL contract (filters by id + soft-delete)', () => {
    it('filters by site id AND deleted_at IS NULL', async () => {
      await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      const sql = mockDbQueryOne.mock.calls[0][1] as string;
      expect(sql).toMatch(/FROM sites/i);
      expect(sql).toMatch(/WHERE id = \?/i);
      expect(sql).toMatch(/deleted_at IS NULL/i);
      expect(sql).toMatch(/SELECT org_id/i);
    });

    it('binds the siteId as the only SQL parameter', async () => {
      await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      const params = mockDbQueryOne.mock.calls[0][2] as unknown[];
      expect(params).toEqual([SITE_ID]);
    });

    it('does NOT bind orgId into the SQL (org match is enforced in code)', async () => {
      await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      const params = mockDbQueryOne.mock.calls[0][2] as unknown[];
      expect(params).not.toContain(OWNER_ORG);
    });
  });

  describe('foreign org (existence-non-leak)', () => {
    it('returns false when the site belongs to a different org', async () => {
      mockDbQueryOne.mockResolvedValue({ org_id: OWNER_ORG });
      const result = await assertSiteOwned(env, FOREIGN_ORG, SITE_ID);
      expect(result).toBe(false);
    });

    it('returns false even though the row EXISTS — never signals existence to a foreign org', async () => {
      // Row is real (belongs to owner); intruder must get the SAME boolean
      // as a non-existent site so callers 404 (not 403) and existence stays hidden.
      mockDbQueryOne.mockResolvedValue({ org_id: OWNER_ORG });
      const intruderResult = await assertSiteOwned(env, FOREIGN_ORG, SITE_ID);

      mockDbQueryOne.mockResolvedValue(null); // truly missing
      const missingResult = await assertSiteOwned(env, FOREIGN_ORG, SITE_ID);

      // Identical observable outcome → no existence oracle.
      expect(intruderResult).toBe(missingResult);
      expect(intruderResult).toBe(false);
    });
  });

  describe('missing / soft-deleted site', () => {
    it('returns false when no row is found (missing or soft-deleted)', async () => {
      mockDbQueryOne.mockResolvedValue(null);
      const result = await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      expect(result).toBe(false);
    });

    it('returns false when the row is falsy/undefined', async () => {
      mockDbQueryOne.mockResolvedValue(undefined);
      const result = await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      expect(result).toBe(false);
    });
  });

  describe('missing / empty orgId (short-circuit before DB)', () => {
    it('returns false when orgId is undefined', async () => {
      const result = await assertSiteOwned(env, undefined, SITE_ID);
      expect(result).toBe(false);
    });

    it('returns false when orgId is an empty string', async () => {
      const result = await assertSiteOwned(env, '', SITE_ID);
      expect(result).toBe(false);
    });

    it('does NOT hit the database when orgId is missing (no query leak)', async () => {
      await assertSiteOwned(env, undefined, SITE_ID);
      await assertSiteOwned(env, '', SITE_ID);
      expect(mockDbQueryOne).not.toHaveBeenCalled();
    });
  });

  describe('row with null/empty org_id', () => {
    it('returns false when the stored org_id is null', async () => {
      mockDbQueryOne.mockResolvedValue({ org_id: null });
      const result = await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      expect(result).toBe(false);
    });

    it('returns false when the stored org_id is an empty string and caller org is non-empty', async () => {
      mockDbQueryOne.mockResolvedValue({ org_id: '' });
      const result = await assertSiteOwned(env, OWNER_ORG, SITE_ID);
      expect(result).toBe(false);
    });
  });

  describe('strict equality (no coercion / no prefix match)', () => {
    it('does not treat a prefix orgId as a match', async () => {
      mockDbQueryOne.mockResolvedValue({ org_id: OWNER_ORG });
      const result = await assertSiteOwned(env, OWNER_ORG.slice(0, -1), SITE_ID);
      expect(result).toBe(false);
    });

    it('matches only on exact org_id equality', async () => {
      mockDbQueryOne.mockResolvedValue({ org_id: OWNER_ORG });
      expect(await assertSiteOwned(env, OWNER_ORG, SITE_ID)).toBe(true);
      expect(await assertSiteOwned(env, `${OWNER_ORG} `, SITE_ID)).toBe(false);
    });
  });
});
