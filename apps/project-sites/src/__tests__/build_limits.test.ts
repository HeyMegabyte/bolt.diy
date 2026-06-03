/**
 * Unit coverage for services/build_limits — per-org site-build quota.
 *
 * Guards the runaway-cost surface: free=3, paid=50, brian@-owned orgs=Infinity,
 * counts non-deleted `sites` rows (soft-deletes do NOT free a slot).
 *
 * NOTE: `UNLIMITED_ORGS` is a module-level per-isolate cache that persists
 * across tests in this file, so every test uses a DISTINCT orgId to avoid
 * cross-test cache pollution.
 */
jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
}));

import { dbQuery, dbQueryOne } from '../services/db.js';
import { checkBuildLimit } from '../services/build_limits.js';

const mockDbQuery = dbQuery as unknown as jest.Mock;
const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;

const db = {} as unknown as D1Database;

/** Owner lookup returns a non-unlimited email (the common path). */
function ordinaryOwner() {
  mockDbQueryOne.mockResolvedValue({ email: 'someone@example.com' } as never);
}
/** Site COUNT(*) helper. */
function siteCount(n: number) {
  mockDbQuery.mockResolvedValue({ data: [{ count: n }], error: null } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkBuildLimit — free tier (plan null / non-paid → limit 3)', () => {
  it('allows when under the free limit', async () => {
    ordinaryOwner();
    siteCount(1);
    const q = await checkBuildLimit(db, 'org-free-under', null);
    expect(q).toEqual({ allowed: true, used: 1, limit: 3, remaining: 2 });
  });

  it('blocks at the free-limit boundary (used === limit)', async () => {
    ordinaryOwner();
    siteCount(3);
    const q = await checkBuildLimit(db, 'org-free-at', null);
    expect(q.allowed).toBe(false);
    expect(q).toMatchObject({ used: 3, limit: 3, remaining: 0 });
  });

  it('clamps remaining to 0 when over limit (never negative)', async () => {
    ordinaryOwner();
    siteCount(5);
    const q = await checkBuildLimit(db, 'org-free-over', null);
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('treats an unknown plan string as free', async () => {
    ordinaryOwner();
    siteCount(0);
    const q = await checkBuildLimit(db, 'org-unknown-plan', 'enterprise-typo');
    expect(q.limit).toBe(3);
    expect(q.allowed).toBe(true);
  });
});

describe('checkBuildLimit — paid tier (limit 50)', () => {
  it('allows up to the paid limit', async () => {
    ordinaryOwner();
    siteCount(49);
    const q = await checkBuildLimit(db, 'org-paid-under', 'paid');
    expect(q).toEqual({ allowed: true, used: 49, limit: 50, remaining: 1 });
  });

  it('blocks at the paid boundary', async () => {
    ordinaryOwner();
    siteCount(50);
    const q = await checkBuildLimit(db, 'org-paid-at', 'paid');
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });
});

describe('checkBuildLimit — unlimited orgs', () => {
  it('grants Infinity to a brian@megabyte.space-owned org and never counts sites', async () => {
    mockDbQueryOne.mockResolvedValue({ email: 'brian@megabyte.space' } as never);
    const q = await checkBuildLimit(db, 'org-brian-1', 'free');
    expect(q).toEqual({ allowed: true, used: 0, limit: Infinity, remaining: Infinity });
    // unlimited path short-circuits before the COUNT query
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('caches the unlimited org so a later owner-lookup change still returns Infinity', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ email: 'brian@megabyte.space' } as never);
    const first = await checkBuildLimit(db, 'org-brian-cached', 'free');
    expect(first.limit).toBe(Infinity);
    // Second call: owner now resolves to nobody — cache must still grant Infinity.
    mockDbQueryOne.mockResolvedValue(null as never);
    const second = await checkBuildLimit(db, 'org-brian-cached', 'free');
    expect(second.limit).toBe(Infinity);
    expect(second.allowed).toBe(true);
  });
});

describe('checkBuildLimit — edge cases', () => {
  it('falls back to the plan limit when the org has no owner row', async () => {
    mockDbQueryOne.mockResolvedValue(null as never);
    siteCount(2);
    const q = await checkBuildLimit(db, 'org-no-owner', 'paid');
    expect(q.limit).toBe(50);
    expect(q.used).toBe(2);
    expect(q.allowed).toBe(true);
  });

  it('treats a missing COUNT row as used=0', async () => {
    ordinaryOwner();
    mockDbQuery.mockResolvedValue({ data: [], error: null } as never);
    const q = await checkBuildLimit(db, 'org-empty-count', null);
    expect(q.used).toBe(0);
    expect(q.allowed).toBe(true);
    expect(q.remaining).toBe(3);
  });
});
