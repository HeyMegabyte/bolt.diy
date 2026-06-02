/**
 * Regression guard for the conversational_editing cross-tenant gap (logged in
 * FEATURE_CATALOG fire 36): handlers gated auth + flag but NOT org-ownership of
 * the :siteId / changeset, so a caller whose org has the flag ON could read or
 * write ANOTHER org's changesets by guessing an id. `assertSiteOwned` is the
 * guard the route applies to every handler — it must return true ONLY when the
 * site exists AND belongs to the caller's org (else the handler 404s).
 */

jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
}));

import { dbQueryOne } from '../services/db.js';
import { assertSiteOwned } from '../routes/conversational_edits.js';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const env = { DB: {} as D1Database } as never;

beforeEach(() => jest.clearAllMocks());

describe('assertSiteOwned — conversational_edits cross-tenant guard', () => {
  it('true when the site belongs to the caller org', async () => {
    mockQueryOne.mockResolvedValue({ org_id: 'org_A' } as never);
    expect(await assertSiteOwned(env, 'org_A', 'site_1')).toBe(true);
  });

  it('false when the site belongs to a different org (cross-tenant read/write blocked)', async () => {
    mockQueryOne.mockResolvedValue({ org_id: 'org_B' } as never);
    expect(await assertSiteOwned(env, 'org_A', 'site_1')).toBe(false);
  });

  it('false when the site does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await assertSiteOwned(env, 'org_A', 'missing')).toBe(false);
  });

  it('false (and no DB hit) when the caller has no org', async () => {
    expect(await assertSiteOwned(env, undefined, 'site_1')).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('queries sites by id, scoped to not-deleted', async () => {
    mockQueryOne.mockResolvedValue({ org_id: 'org_A' } as never);
    await assertSiteOwned(env, 'org_A', 'site_1');
    const sql = mockQueryOne.mock.calls[0][1] as string;
    expect(sql).toMatch(/FROM sites WHERE id = \? AND deleted_at IS NULL/);
    expect(mockQueryOne.mock.calls[0][2]).toEqual(['site_1']);
  });
});
