/**
 * Unit tests for the Content Freshness publish path (feature #16).
 *
 * Focus: multi-tenant isolation on `publishRewriteDraft`. The HTTP approve route
 * (`POST /api/content/freshness/approve/:draftId`) passes the caller's org; the
 * service must refuse to publish a draft owned by another org — BEFORE any R2
 * write or status mutation — and must publish a legitimately-owned draft.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQueryOne, dbUpdate } from '../services/db.js';
import { publishRewriteDraft } from '../services/content_freshness.js';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

/** R2 bucket double that records every put so we can assert it never fires. */
function makeEnv() {
  const puts: Array<{ key: string }> = [];
  const env = {
    DB: {} as D1Database,
    SITES_BUCKET: {
      put: jest.fn(async (key: string) => {
        puts.push({ key });
        return undefined;
      }),
    } as unknown as R2Bucket,
  } as unknown as Parameters<typeof publishRewriteDraft>[0];
  return { env, puts };
}

const ownedDraft = {
  id: 'd1',
  org_id: 'org-a',
  site_id: 'site-a',
  section_key: 'hero',
  section_html_draft: '<section>fresh</section>',
  status: 'pending',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryOne.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

describe('publishRewriteDraft — tenant isolation', () => {
  it('refuses to publish a draft owned by another org (no R2 write, no status mutation)', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...ownedDraft, org_id: 'OTHER_ORG' } as never);
    const { env, puts } = makeEnv();

    const res = await publishRewriteDraft(env, 'd1', 'user_1', 'org-a');

    expect(res).toEqual({ ok: false, error: 'Draft not found' });
    expect(puts).toHaveLength(0); // never wrote to another org's section
    expect(mockUpdate).not.toHaveBeenCalled(); // never flipped status to published
  });

  it('treats a missing draft as not-found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { env, puts } = makeEnv();

    const res = await publishRewriteDraft(env, 'ghost', 'user_1', 'org-a');

    expect(res).toEqual({ ok: false, error: 'Draft not found' });
    expect(puts).toHaveLength(0);
  });

  it('publishes a draft the caller org owns', async () => {
    mockQueryOne
      .mockResolvedValueOnce(ownedDraft as never) // draft lookup (org matches)
      .mockResolvedValueOnce({ slug: 'site-a-slug' } as never); // site slug for R2 path
    const { env, puts } = makeEnv();

    const res = await publishRewriteDraft(env, 'd1', 'user_1', 'org-a');

    expect(res).toEqual({ ok: true });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toBe('sites/site-a-slug/sections/hero.html');
    // status flipped to published + sections_index touch = 2 updates
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ status: 'published', approved_by: 'user_1' }),
    );
  });

  it('rejects an already-published draft (owned) without re-writing R2', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...ownedDraft, status: 'published' } as never);
    const { env, puts } = makeEnv();

    const res = await publishRewriteDraft(env, 'd1', 'user_1', 'org-a');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('already');
    expect(puts).toHaveLength(0);
  });
});
