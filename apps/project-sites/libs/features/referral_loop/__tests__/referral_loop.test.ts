/**
 * Unit tests for the referral_loop feature module.
 *
 * All D1 interactions are mocked via a lightweight stub so these tests never
 * touch a real database. Tests cover: get-or-create code, click tracking,
 * stats, and flag/auth guard logic.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// D1 stub helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * Minimal D1Database stub. Tests configure `_rows` before each assertion.
 */
function makeDb(rows: Row[] = []) {
  const _rows: Row[] = [...rows];
  const prepared = {
    bind: jest.fn().mockReturnThis(),
    run: jest.fn().mockResolvedValue({ success: true }),
    first: jest.fn().mockResolvedValue(_rows[0] ?? null),
    all: jest.fn().mockResolvedValue({ results: _rows }),
  };
  return {
    prepare: jest.fn().mockReturnValue(prepared),
    _prepared: prepared,
    _rows,
  };
}

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('referral_loop/schemas', () => {
  it('ReferralCodeRowSchema parses a valid row', async () => {
    const { ReferralCodeRowSchema } = await import('../schemas.js');
    // `clicks` is NOT a referral_codes column — it's derived from attributions.
    const row = {
      id: 'id-1',
      site_id: 'site-1',
      org_id: 'org-1',
      code: 'AB12CD34',
      conversions: 1,
      created_at: '2026-06-17T00:00:00.000Z',
    };
    const result = ReferralCodeRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('AB12CD34');
      expect(result.data.conversions).toBe(1);
    }
  });

  it('ReferralCodeRowSchema rejects missing org_id', async () => {
    const { ReferralCodeRowSchema } = await import('../schemas.js');
    const result = ReferralCodeRowSchema.safeParse({
      id: 'x',
      code: 'AB',
      conversions: 0,
      created_at: 'now',
    });
    expect(result.success).toBe(false);
  });

  it('TrackReferralBodySchema rejects empty code', async () => {
    const { TrackReferralBodySchema } = await import('../schemas.js');
    const result = TrackReferralBodySchema.safeParse({ code: '' });
    expect(result.success).toBe(false);
  });

  it('TrackReferralBodySchema accepts valid body', async () => {
    const { TrackReferralBodySchema } = await import('../schemas.js');
    const result = TrackReferralBodySchema.safeParse({ code: 'AB12CD34' });
    expect(result.success).toBe(true);
  });

  it('ReferralStatsResponseSchema defaults pending to nonnegative', async () => {
    const { ReferralStatsResponseSchema } = await import('../schemas.js');
    const result = ReferralStatsResponseSchema.safeParse({
      code: 'XY',
      clicks: 10,
      conversions: 2,
      pending: 0,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service: buildReferralUrl (via getOrCreateReferralCode output)
// ---------------------------------------------------------------------------

describe('referral_loop/service — getOrCreateReferralCode', () => {
  it('returns existing code when one is present', async () => {
    const db = makeDb();
    let call = 0;
    db._prepared.all.mockImplementation(() => {
      call += 1;
      // 1st = the code row (conversions is a real column); 2nd = countClicks COUNT.
      if (call === 1) return Promise.resolve({ results: [{ code: 'EXIST001', conversions: 1 }] });
      return Promise.resolve({ results: [{ n: 3 }] });
    });
    const env = { DB: db } as unknown as import('../../../../src/types/env.js').Env;

    const { getOrCreateReferralCode } = await import('../service.js');
    const result = await getOrCreateReferralCode(env, 'org-1');

    expect(result.code).toBe('EXIST001');
    expect(result.clicks).toBe(3); // derived from click attributions
    expect(result.conversions).toBe(1);
    expect(result.referral_url).toContain('ref=EXIST001');
    // Existing code → SELECT + countClicks only, no INSERT (2 prepares).
    expect(db.prepare).toHaveBeenCalledTimes(2);
  });

  it('creates a new code when none exists', async () => {
    // dbQueryOne resolves via .all() + data[0] (not .first()): the first SELECT
    // returns no rows; INSERT runs; the post-insert re-read returns the new row.
    const db = makeDb();
    let callCount = 0;
    db._prepared.all.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) return Promise.resolve({ results: [] });
      return Promise.resolve({ results: [{ code: 'NEWCODE1', clicks: 0, conversions: 0 }] });
    });

    const env = { DB: db } as unknown as import('../../../../src/types/env.js').Env;
    const { getOrCreateReferralCode } = await import('../service.js');
    const result = await getOrCreateReferralCode(env, 'org-2');

    expect(result.code).toBe('NEWCODE1');
    expect(result.clicks).toBe(0);
    expect(result.referral_url).toContain('ref=NEWCODE1');
  });

  it('throws when DB fails to return a row after insert', async () => {
    const db = makeDb();
    db._prepared.first.mockResolvedValue(null);

    const env = { DB: db } as unknown as import('../../../../src/types/env.js').Env;
    const { getOrCreateReferralCode } = await import('../service.js');

    await expect(getOrCreateReferralCode(env, 'org-3')).rejects.toThrow(
      'referral_loop: failed to create referral code',
    );
  });
});

// ---------------------------------------------------------------------------
// Service: trackReferral
// ---------------------------------------------------------------------------

describe('referral_loop/service — trackReferral', () => {
  it('returns attribution_id and click status on success', async () => {
    const db = makeDb([{ id: 'rc-1' }]);

    const env = { DB: db } as unknown as import('../../../../src/types/env.js').Env;
    const { trackReferral } = await import('../service.js');
    const result = await trackReferral(env, { code: 'EXIST001' });

    expect(result.status).toBe('click');
    expect(typeof result.attribution_id).toBe('string');
    expect(result.attribution_id.length).toBeGreaterThan(0);
  });

  it('throws 404 when code is not found', async () => {
    const db = makeDb([]);

    const env = { DB: db } as unknown as import('../../../../src/types/env.js').Env;
    const { trackReferral } = await import('../service.js');

    await expect(trackReferral(env, { code: 'UNKNOWN' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// Service: getReferralStats
// ---------------------------------------------------------------------------

describe('referral_loop/service — getReferralStats', () => {
  it('returns zero stats when org has no referral code', async () => {
    const db = makeDb([]);

    const env = { DB: db } as unknown as import('../../../../src/types/env.js').Env;
    const { getReferralStats } = await import('../service.js');
    const stats = await getReferralStats(env, 'org-no-code');

    // No code yet → null code, zero counts (honest zero-state).
    expect(stats).toEqual({ code: null, clicks: 0, conversions: 0, pending: 0 });
  });

  it('returns aggregated stats for an existing code', async () => {
    const db = makeDb([]);
    // Three lookups via dbQueryOne/dbQuery → .all(): 1st = the code row,
    // 2nd = countClicks (event_kind='click'), 3rd = pending (event_kind='signup').
    let selectCall = 0;
    db._prepared.all.mockImplementation(() => {
      selectCall += 1;
      if (selectCall === 1) {
        return Promise.resolve({ results: [{ code: 'MYCODE01', conversions: 2 }] });
      }
      if (selectCall === 2) {
        return Promise.resolve({ results: [{ n: 10 }] });
      }
      return Promise.resolve({ results: [{ count: 8 }] });
    });

    const env = { DB: db } as unknown as import('../../../../src/types/env.js').Env;
    const { getReferralStats } = await import('../service.js');
    const stats = await getReferralStats(env, 'org-1');

    expect(stats.code).toBe('MYCODE01');
    expect(stats.clicks).toBe(10); // derived from click attributions
    expect(stats.conversions).toBe(2);
    expect(stats.pending).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// FLAG_KEY constant
// ---------------------------------------------------------------------------

describe('referral_loop/service — FLAG_KEY', () => {
  it('FLAG_KEY equals the module slug', async () => {
    const { FLAG_KEY } = await import('../service.js');
    expect(FLAG_KEY).toBe('referral_loop');
  });
});
